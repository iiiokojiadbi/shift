import { DIR, MOD } from './layout'
import { frontmatter, type Heading, headings, lineCount } from './markdown'
import type { Project } from './project'
import type { DocsSettings } from './settings'
import type { Store } from './store'

// The project's documents the mod keeps, the ones `[docs] dirs` names — folders, or a single document such as
// AGENTS.md at the root: a map of them in SHIFT.md, a toc inside each, checks after the agent writes a file, a
// document's sections with line numbers, and the documents that mention a file. With none named the mod touches no
// document. Every document is read by one reader: its description and its headings outside code fences.

export const TOC_START = '<!-- toc -->'
export const TOC_END = '<!-- /toc -->'

// `##` and `###` outside code fences, each with the `> ` line right under it as its note.
export function outline(text: string): Heading[] {
  return headings(text).filter(heading => heading.level === 2 || heading.level === 3)
}

// The text with its toc block written from its headings: in place of the old block, else right under the `# ` title;
// null when there is neither.
export function withToc(text: string): string | null {
  const rows = outline(text).map(
    heading => `${'  '.repeat(heading.level - 2)}- ${heading.title}${heading.note === '' ? '' : ` - ${heading.note}`}`,
  )
  const block = [TOC_START, ...rows, TOC_END].join('\n')
  const start = text.indexOf(TOC_START)
  const end = start === -1 ? -1 : text.indexOf(TOC_END, start)
  if (end !== -1) return `${text.slice(0, start)}${block}${text.slice(end + TOC_END.length)}`
  const title = headings(text).find(heading => heading.level === 1)
  if (title === undefined) return null
  const lines = text.split('\n')

  return [...lines.slice(0, title.line), '', block, ...lines.slice(title.line)].join('\n')
}

export function isDoc(path: string, dirs: readonly string[]): boolean {
  return path.endsWith('.md') && dirs.map(trimDir).some(entry => (isFile(entry) ? path === entry : path.startsWith(`${entry}/`)))
}

function description(text: string): string | null {
  const found = frontmatter(text).get('description') ?? ''

  return found === '' ? null : found
}

// What a document breaks of the settings: its description and its length.
export function docRemarks(text: string, docs: DocsSettings): string[] {
  const remarks: string[] = []
  const about = description(text)
  if (about === null) remarks.push(NO_DESCRIPTION)
  else if (docs.maxDescription !== null && about.length > docs.maxDescription) {
    remarks.push(`a description of ${about.length} characters, over \`[docs] max_description = ${docs.maxDescription}\``)
  }
  const lines = lineCount(text)
  if (docs.maxLines !== null && lines > docs.maxLines) {
    remarks.push(`${lines} lines, over \`[docs] max_lines = ${docs.maxLines}\` — split it by topic`)
  }
  if (docs.toc && withToc(text) === null) remarks.push('no `# ` title line for the toc to go under')

  return remarks
}

// Links to documents that are not there: a `<folder>/….md` path anywhere in the text, from the project's root, and in
// a Markdown file a `[text](file.md)` from the file's own folder. A path with `<` or `*` is a pattern, not a link.
export async function brokenLinks(store: Store, root: string, path: string, text: string, dirs: readonly string[]): Promise<string[]> {
  const targets = new Map<string, string | null>()
  for (const dir of dirs.map(trimDir).filter(entry => !isFile(entry))) {
    const pattern = new RegExp(`(?<![\\w./-])${escapeRegExp(dir)}/[^\\s\`'"()\\[\\],:;»<>*]+?\\.md(?![\\w-])`, 'g')
    for (const found of text.matchAll(pattern)) targets.set(found[0], found[0])
  }
  if (path.endsWith('.md')) {
    for (const found of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
      const link = found[1] ?? ''
      if (/^[a-z]+:/i.test(link) || link.includes('*') || targets.has(link)) continue
      targets.set(link, joinPath(path.slice(0, path.lastIndexOf('/') + 1), link))
    }
  }
  const missing: string[] = []
  for (const [link, target] of targets) {
    if (target === null || !(await store.exists(`${root}/${target}`))) missing.push(link)
  }

  return missing
}

// After the agent wrote a file: a document gets its toc rewritten and the map follows it; a document's remarks and any
// file's broken links come back as one note. Null when all is well: a check that speaks on every edit is noise.
export async function afterWrite(project: Project, file: string): Promise<string | null> {
  const { store, root, settings } = project
  const docs = settings.docs
  if (!settings.enabled || docs.dirs.length === 0 || !file.startsWith(`${root}/`)) return null
  const path = file.slice(root.length + 1)
  if (path.startsWith(`${DIR}/`)) return null
  let text = await store.read(file)
  if (text === null) return null

  const lines: string[] = []
  const doc = isDoc(path, docs.dirs)
  if (doc && docs.toc) {
    const next = withToc(text)
    if (next !== null && next !== text) {
      await store.write(file, next)
      text = next
      lines.push(`The mod rewrote the toc of \`${path}\`: read the file before editing it again.`)
    }
  }
  if (doc) await refreshDocs(project)
  const remarks = [
    ...(doc ? docRemarks(text, docs) : []),
    ...(await brokenLinks(store, root, path, text, docs.dirs)).map(link => `a link to \`${link}\` that is not there`),
  ]
  if (remarks.length > 0) lines.push(`\`${path}\`: ${remarks.join('; ')}.`)

  return lines.length === 0 ? null : `<${MOD} note="the mod's check of the file just written">\n${lines.join('\n')}\n</${MOD}>`
}

// The documents with remarks and the root's Markdown files with a broken link, short enough to read after a shift:
// documents without a description as one line with a count, the other remarks for the first few documents and a count
// of the rest. Null when there are none.
export async function docsReport(project: Project): Promise<string | null> {
  const { store, root, settings } = project
  const docs = settings.docs
  if (!settings.enabled || docs.dirs.length === 0) return null
  const rootFiles = (await store.list(root, 'file')).filter(name => name.endsWith('.md'))
  const undescribed: string[] = []
  const lines: string[] = []
  for (const path of [...(await docPaths(store, root, docs.dirs)), ...rootFiles]) {
    const text = (await store.read(`${root}/${path}`)) ?? ''
    const own = isDoc(path, docs.dirs) ? docRemarks(text, docs) : []
    if (own.includes(NO_DESCRIPTION)) undescribed.push(path)
    const remarks = [
      ...own.filter(remark => remark !== NO_DESCRIPTION),
      ...(await brokenLinks(store, root, path, text, docs.dirs)).map(link => `a link to \`${link}\` that is not there`),
    ]
    if (remarks.length > 0) lines.push(`- \`${path}\`: ${remarks.join('; ')}`)
  }
  const shown = lines.slice(0, REPORT_DOCS)
  const report = [
    ...(undescribed.length === 0
      ? []
      : [
          `- ${undescribed.length} ${undescribed.length === 1 ? 'document' : 'documents'} without \`description:\`: ${undescribed
            .slice(0, 3)
            .map(path => `\`${path}\``)
            .join(', ')}${undescribed.length > 3 ? ' and the rest the map marks' : ''}`,
        ]),
    ...shown,
    ...(lines.length > shown.length
      ? [`- and ${lines.length - shown.length} more documents with remarks: each comes after its next edit`]
      : []),
  ]

  return report.length === 0 ? null : report.join('\n')
}

const NO_DESCRIPTION = 'no `description:` in its frontmatter'

// How many documents the report after a shift names one by one.
const REPORT_DOCS = 10

// A document's description and its `##` and `###` with line numbers, so the agent reads only the section it needs.
export async function docOutline({ store, root }: Project, file: string): Promise<string> {
  const path = fromRoot(root, file)
  const text = await store.read(`${root}/${path}`)
  if (text === null) return `No file at ${path}.`
  const rows = outline(text).map(
    heading =>
      `${'  '.repeat(heading.level - 2)}${String(heading.line).padStart(5)}  ${heading.title}${heading.note === '' ? '' : ` - ${heading.note}`}`,
  )

  return [`${path} — ${lineCount(text)} lines`, `  ${description(text) ?? 'no description'}`, ...rows].join('\n')
}

// The documents that name a file — its name without the folder, as a whole word — to check them against a change.
export async function docsMentioning({ store, root, settings }: Project, file: string): Promise<string> {
  const dirs = settings.docs.dirs
  if (dirs.length === 0) return 'The owner turned the docs off: `[docs] dirs = []`.'
  const name =
    file
      .split('/')
      .filter(part => part !== '')
      .at(-1) ?? ''
  if (name === '') return 'Name a file.'
  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`)
  const found: string[] = []
  for (const path of await docPaths(store, root, dirs)) {
    if (path === fromRoot(root, file)) continue
    if (pattern.test((await store.read(`${root}/${path}`)) ?? '')) found.push(path)
  }
  const where = dirs.map(dir => entryName(trimDir(dir))).join(', ')

  return found.length === 0
    ? `No document in ${where} mentions \`${name}\`.`
    : [`\`${name}\` is mentioned in:`, ...found.map(path => `- ${path}`)].join('\n')
}

function fromRoot(root: string, file: string): string {
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file.replace(/^\.\//, '')
}

// A path from the project's root for `link` written in a file under `base`; null when it climbs out of the project.
function joinPath(base: string, link: string): string | null {
  const parts: string[] = []
  for (const part of `${base}${link}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.pop() === undefined) return null
  }

  return parts.join('/')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The map in SHIFT.md: per folder, each document's path, its `description:` and its `##` sections, so the agent knows
// what the docs hold without opening one. Built from the files every time, so it cannot go stale; the mod rewrites only
// the block between its markers.

export const MAP_START = `<!-- ${MOD}:docs — written by the mod from each document's description and ## headings; edit those, not this -->`
export const MAP_END = `<!-- /${MOD}:docs -->`

export type Doc = { path: string; description: string | null; sections: string[] }

// Every document the settings name, from the project's root, sorted: each .md file under a folder — a missing folder
// has none, a hidden one is skipped — and a named document that is there.
export async function docPaths(store: Store, root: string, dirs: readonly string[]): Promise<string[]> {
  const paths = new Set<string>()
  const walk = async (dir: string): Promise<void> => {
    for (const name of await store.list(`${root}/${dir}`, 'file')) if (name.endsWith('.md')) paths.add(`${dir}/${name}`)
    for (const name of await store.list(`${root}/${dir}`, 'dir')) if (!name.startsWith('.')) await walk(`${dir}/${name}`)
  }
  for (const entry of dirs.map(trimDir)) {
    if (!isFile(entry)) await walk(entry)
    else if ((await store.read(`${root}/${entry}`)) !== null) paths.add(entry)
  }

  return [...paths].sort((a, b) => a.localeCompare(b))
}

export function trimDir(dir: string): string {
  return dir.replace(/\/+$/, '')
}

// An entry of `[docs] dirs` that names one document rather than a folder.
function isFile(entry: string): boolean {
  return entry.endsWith('.md')
}

// An entry as the mod names it to the agent: a folder with its slash, a document as it is.
function entryName(entry: string): string {
  return isFile(entry) ? `\`${entry}\`` : `\`${entry}/\``
}

// The block itself; past `[docs] max_chars` first without the sections, then only folders and file names, so it never
// crowds the session and loses the descriptions last. A map cut down says so, and what this level dropped, so the
// agent knows what it does not see. A folder of the
// settings with nothing to list is named with why — no such folder, or no documents in it — so the agent knows the
// project has no docs there and does not go searching. `[docs] dirs = []` is the owner turning the map off — the
// project's docs may be shared with people and not the agent's to describe — and the block says just that.
export function renderMap(docs: readonly Doc[], settings: DocsSettings, missing: readonly string[]): string {
  const { dirs, maxChars } = settings
  if (dirs.length === 0) {
    const off =
      "off: the owner set `[docs] dirs = []` in the settings. No map of the documents; do not add descriptions, headings or anything else to the project's docs for it."

    return [MAP_START, '', `## Documents`, '', off, '', MAP_END].join('\n')
  }
  const empty = dirs
    .map(trimDir)
    .filter(entry => !docs.some(doc => isDoc(doc.path, [entry])))
    .map(entry => `- ${entryName(entry)} — ${isFile(entry) ? 'no such file' : missing.includes(entry) ? 'no such folder' : 'no documents'}`)
  if (docs.length === 0) return [MAP_START, '', `## Documents`, '', 'none:', ...empty, '', MAP_END].join('\n')
  const folders = new Map<string, Doc[]>()
  for (const doc of docs) {
    const folder = doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/')) : '.'
    folders.set(folder, [...(folders.get(folder) ?? []), doc])
  }
  // A folder before the folders inside it.
  const sorted = [...folders].sort(([a], [b]) => a.localeCompare(b))
  const listed = (sections: boolean): string[] =>
    sorted.map(([folder, inside]) =>
      [
        `### ${folder}/`,
        '',
        ...inside.flatMap(doc => [
          `- \`${doc.path}\` — ${doc.description ?? 'no description: add `description:` to its frontmatter'}`,
          ...(!sections || doc.sections.length === 0 ? [] : [`  sections: ${doc.sections.join(' · ')}`]),
        ]),
      ].join('\n'),
    )
  const size = (body: string[]): number => body.join('\n\n').length
  const full = listed(true)
  const described = listed(false)
  const over = `the full map is ${size(full)} characters, over \`[docs] max_chars = ${maxChars}\` in the settings`
  const back =
    'Tell the owner: they may raise `[docs] max_chars`; shorter descriptions and fewer `##` sections also bring the map back whole.'
  const [body, note] =
    size(full) <= maxChars
      ? [full, 'Open a document for numbers, commands and names: the map only points.']
      : size(described) <= maxChars
        ? [
            described,
            `Cut down: ${over}. Dropped at this level: the \`sections:\` line of every document — open a document for its \`##\` sections. Whole: every document with its description. ${back}`,
          ]
        : [
            sorted.map(
              ([folder, inside]) =>
                `- \`${folder}/\` — ${inside.length} docs: ${inside.map(doc => doc.path.slice(doc.path.lastIndexOf('/') + 1)).join(', ')}`,
            ),
            `Cut down: ${over}, and ${size(described)} without the sections. Dropped at this level: the description and the sections of every document — read a document's frontmatter \`description:\` for what it holds. Whole: every folder with its file names. ${back}`,
          ]
  const nothing = empty.length === 0 ? [] : ['', 'Nothing to list:', ...empty]

  return [MAP_START, '', `## Documents`, '', note, '', body.join('\n\n'), ...nothing, '', MAP_END].join('\n')
}

// SHIFT.md with its map block replaced, or added at the end; a new file starts with a heading and a line on what it is.
export function withMap(shift: string | null, map: string): string {
  if (shift === null) {
    return `# Shift\n\nHow this project keeps its knowledge. The rules are written on the owner's word; the map below is the mod's.\n\n${map}\n`
  }
  const start = shift.indexOf(MAP_START.slice(0, MAP_START.indexOf(' — ')))
  const end = shift.indexOf(MAP_END)
  if (start === -1 || end === -1) return `${shift.trimEnd()}\n\n${map}\n`

  return `${shift.slice(0, start)}${map}${shift.slice(end + MAP_END.length)}`
}

// Every document read once: its toc rewritten when the settings ask for one, then the map in SHIFT.md written when it
// changed — nothing when there are no documents and no SHIFT.md yet. At the session's start, a shift and a write.
export async function refreshDocs(project: Project): Promise<void> {
  const { store, root } = project
  const settings = project.settings.docs
  const docs: Doc[] = []
  for (const path of await docPaths(store, root, settings.dirs)) {
    let text = (await store.read(`${root}/${path}`)) ?? ''
    const next = settings.toc ? withToc(text) : null
    if (next !== null && next !== text) {
      await store.write(`${root}/${path}`, next)
      text = next
    }
    docs.push(readDoc(path, text))
  }
  const missing: string[] = []
  for (const entry of settings.dirs.map(trimDir)) {
    if (!(await store.exists(`${root}/${entry}`))) missing.push(entry)
  }
  const shift = `${root}/${project.settings.files.shift}`
  const current = await store.read(shift)
  if (docs.length === 0 && current === null) return
  const map = withMap(current, renderMap(docs, settings, missing))
  if (map !== current) await store.write(shift, map)
}

// What the map shows of a document.
function readDoc(path: string, text: string): Doc {
  return {
    path,
    description: description(text),
    sections: outline(text)
      .filter(h => h.level === 2)
      .map(h => h.title),
  }
}
