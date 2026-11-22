// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { DIR, DOCS_MAX_DEPTH, KNOWLEDGE, MOD, NAMES } from './layout'
import {
  frontmatter,
  type Heading,
  headings,
  lineCount,
  lineOutside,
  linkTargets,
  type Pin,
  pinned,
  sectionRange,
  unfenced,
} from './markdown'
import { basename, dirname, fromRoot, isInside, normalize, resolvePath } from './paths'
import { keepRecordsOut } from './privacy'
import type { Project } from './project'
import { knowledgeMap } from './records'
import type { DocsSettings, Settings } from './settings'
import { readKnowledge, type Store } from './store'

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

// The text with its toc block written from its headings: in place of the old block — its markers on lines of their own,
// outside code fences — else right under the `# ` title; null when there is neither.
export function withToc(text: string): string | null {
  const rows = outline(text).map(
    heading => `${'  '.repeat(heading.level - 2)}- ${heading.title}${heading.note === '' ? '' : ` - ${heading.note}`}`,
  )
  const lines = text.split('\n')
  const start = lineOutside(lines, line => line.trim() === TOC_START)
  const end = start === -1 ? -1 : lineOutside(lines, line => line.trim() === TOC_END, start + 1)
  const eol = lines[0]?.endsWith('\r') ? '\r' : ''
  const block = [TOC_START, ...rows, TOC_END].map(line => `${line}${eol}`)
  if (end !== -1) return [...lines.slice(0, start), ...block, ...lines.slice(end + 1)].join('\n')
  const title = headings(text).find(heading => heading.level === 1)
  if (title === undefined) return null

  return [...lines.slice(0, title.line), eol, ...block, ...lines.slice(title.line)].join('\n')
}

export function isDoc(path: string, dirs: readonly string[], maxDepth = DOCS_MAX_DEPTH): boolean {
  return (
    path.endsWith('.md') &&
    dirs.map(trimDir).some(entry => {
      if (isFile(entry)) return path === entry
      if (!path.startsWith(`${entry}/`)) return false
      const parts = path.slice(entry.length + 1).split('/')
      return parts.length - 1 <= maxDepth && !parts.slice(0, -1).some(folder => folder.startsWith('.'))
    })
  )
}

function excludedDoc(settings: Settings, path: string): boolean {
  return path === settings.files.legacyMap || settings.docs.exclude.includes(path)
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

// Links to documents that are not there: in a Markdown file, outside code fences, a link — `[text](file.md)` or a
// reference's `[ref]: file.md` — from the file's own folder (from the root with a leading `/`); then a bare
// `<folder>/….md` path anywhere else in the text, from the project's root. A path with `<` or `*` is a pattern, a URL
// is not the project's, and a link's `?query` and `#fragment` are not part of its file.
export async function brokenLinks(store: Store, root: string, path: string, text: string, dirs: readonly string[]): Promise<string[]> {
  const targets = new Map<string, string | null>()
  let bare = text
  if (path.endsWith('.md')) {
    bare = unfenced(text)
    for (const { link, file } of linkTargets(text)) {
      if (!link.endsWith('.md') || /^[a-z][\w+.-]*:|^\/\//i.test(link) || link.includes('*')) continue
      targets.set(link, file === null ? null : normalize(file.startsWith('/') ? file.slice(1) : `${dirname(path)}/${file}`))
    }
    bare = bare.replace(/\]\([^)]*\)/g, ']()').replace(/^ {0,3}\[[^\]]+\]:.*$/gm, '')
  }
  for (const dir of dirs.map(trimDir).filter(entry => !isFile(entry))) {
    const pattern = new RegExp(`(?<![\\w./-])${escapeRegExp(dir)}/[^\\s\`'"()\\[\\],:;»<>*]+?\\.md(?![\\w-])`, 'g')
    for (const found of bare.matchAll(pattern)) if (!targets.has(found[0])) targets.set(found[0], found[0])
  }
  const missing: string[] = []
  for (const [link, target] of targets) {
    if (target === null || !(await store.exists(`${root}/${target}`))) missing.push(link)
  }

  return missing
}

// After the agent wrote a file: a document puts the map in step at once; the file itself is settled by `settleDocs`
// once the run is over. The file's path from the root, or null when the docs do not follow it.
export async function followWrite(project: Project, file: string): Promise<string | null> {
  const { root, settings } = project
  if (!settings.enabled || settings.docs.dirs.length === 0 || !file.startsWith(`${root}/`)) return null
  const path = file.slice(root.length + 1)
  if (path.startsWith(`${DIR}/`) || excludedDoc(settings, path)) return null
  if (isDoc(path, settings.docs.dirs, settings.docs.maxDepth)) await refreshDocs(project, { tocs: false })

  return path
}

// The files written in a run, once it is over: each document's toc, and the remarks — a document's own, any file's
// links still not there — as lines of one note. Not after each write: a document written before the one it links to
// has no remark to make, and a toc written mid-run would make the agent read the file again before each next edit.
// The tocs are written by `write`, once the note went: a note that did not go finds them still to write. None when all
// is well: a check that speaks on every run is noise.
export async function settleDocs(project: Project, paths: readonly string[]): Promise<{ lines: string[]; write(): Promise<string[]> }> {
  const { store, root, settings } = project
  const docs = settings.docs
  const read = new Map<string, string>()
  const tocs = new Map<string, string>()
  // A file changed since it was read keeps its change and is settled again with the next prompt: its toc is not written
  // over it, and its remarks are of the text before. The files skipped come back.
  const write = async () => {
    const skipped: string[] = []
    for (const [path, was] of read) {
      const next = tocs.get(path)
      if ((await store.read(`${root}/${path}`)) !== was) skipped.push(path)
      else if (next !== undefined) await store.write(`${root}/${path}`, next)
    }

    return skipped
  }
  if (project.problem || !settings.enabled || docs.dirs.length === 0) return { lines: [], write }
  const remarked: string[] = []
  let pins = false
  for (const path of paths) {
    if (excludedDoc(settings, path)) continue
    let text = await store.read(`${root}/${path}`)
    if (text === null) continue
    read.set(path, text)
    const doc = isDoc(path, docs.dirs, docs.maxDepth)
    if (doc && docs.toc) {
      const next = withToc(text)
      if (next !== null && next !== text) {
        tocs.set(path, next)
        text = next
      }
    }
    if (doc && pinned(text).length > 0) pins = true
    const remarks = [
      ...(doc ? docRemarks(text, docs) : []),
      ...(await brokenLinks(store, root, path, text, docs.dirs)).map(link => `a link to \`${link}\` that is not there`),
    ]
    if (remarks.length > 0) remarked.push(`\`${path}\`: ${remarks.join('; ')}.`)
  }
  const rewritten = [...tocs.keys()]
  const named = rewritten.map(path => `\`${path}\``).join(', ')
  // Pinned blocks past the limit are told when a document written has some: the write may be what passed it.
  const over = pins ? pinnedOver(await refreshDocs(project, { tocs: false }), docs) : null
  const lines = [
    ...(rewritten.length === 0
      ? []
      : [
          rewritten.length === 1
            ? `The mod wrote the toc of ${named}: read the file before editing it again.`
            : `The mod wrote the tocs of ${named}: read each before editing it again.`,
        ]),
    ...(over === null ? [] : [over]),
    ...remarked,
  ]

  return { lines, write }
}

// The documents with remarks and the root's Markdown files with a broken link, short enough to read after a shift:
// documents without a description as one line with a count, the other remarks for the first few documents and a count
// of the rest. Null when there are none.
export async function docsReport(project: Project): Promise<string | null> {
  const { store, root, settings } = project
  const docs = settings.docs
  if (!settings.enabled || docs.dirs.length === 0) return null
  const rootFiles = (await store.list(root, 'file')).filter(name => name.endsWith('.md'))
  const paths = new Set([...(await docPaths(store, root, docs.dirs, docs.maxDepth)), ...rootFiles])
  const undescribed: string[] = []
  const lines: string[] = []
  const kept: Doc[] = []
  for (const path of paths) {
    if (excludedDoc(settings, path) || path === settings.files.shift) continue
    const text = (await store.read(`${root}/${path}`)) ?? ''
    if (isDoc(path, docs.dirs, docs.maxDepth)) kept.push(readDoc(path, text))
    const own = isDoc(path, docs.dirs, docs.maxDepth) ? docRemarks(text, docs) : []
    if (own.includes(NO_DESCRIPTION)) undescribed.push(path)
    const remarks = [
      ...own.filter(remark => remark !== NO_DESCRIPTION),
      ...(await brokenLinks(store, root, path, text, docs.dirs)).map(link => `a link to \`${link}\` that is not there`),
    ]
    if (remarks.length > 0) lines.push(`- \`${path}\`: ${remarks.join('; ')}`)
  }
  const shown = lines.slice(0, REPORT_DOCS)
  const pins = pinnedOver(kept, docs)
  const report = [
    ...(pins === null ? [] : [`- ${pins}`]),
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
  const text = await store.read(resolvePath(root, path))
  if (text === null) return `No file at ${path}.`
  const rows = outline(text).map(
    heading =>
      `${'  '.repeat(heading.level - 2)}${String(heading.line).padStart(5)}  ${heading.title}${heading.note === '' ? '' : ` - ${heading.note}`}`,
  )

  return [`${path} — ${lineCount(text)} lines`, `  ${description(text) ?? 'no description'}`, ...rows].join('\n')
}

// A logical knowledge name is shorthand for the path printed in the session map.
export function readingPath(input: string, dirs: readonly string[], maxDepth = DOCS_MAX_DEPTH): string {
  if (input.startsWith(`${NAMES.knowledge}/`) && !isDoc(input, dirs, maxDepth)) return `${DIR}/${input}`
  return input.replace(/^\.\//, '')
}

export async function readMapped(project: Project, input: string, section?: string): Promise<string> {
  const path = readingPath(input, project.settings.docs.dirs, project.settings.docs.maxDepth)
  if (
    !isInside(path) ||
    /[\\:]/.test(path) ||
    path.includes('\0') ||
    !path.endsWith('.md') ||
    (dirname(path) !== KNOWLEDGE &&
      (excludedDoc(project.settings, path) || !isDoc(path, project.settings.docs.dirs, project.settings.docs.maxDepth)))
  ) {
    throw new Error('Use a local knowledge file or a document path from the project map.')
  }
  const text = await project.store.read(`${project.root}/${path}`)
  if (text === null) throw new Error(`No file at ${path}.`)
  if (section === undefined) return text
  const { first, after } = sectionRange(text, section)
  return text.split('\n').slice(first, after).join('\n').trimEnd()
}

// The documents that name a file — its name without the folder, as a whole word — to check them against a change.
export async function docsMentioning({ store, root, settings }: Project, file: string): Promise<string> {
  const dirs = settings.docs.dirs
  if (dirs.length === 0) return 'The owner turned the docs off: `[docs] dirs = []`.'
  const name = basename(file)
  if (name === '') return 'Name a file.'
  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`)
  const found: string[] = []
  for (const path of await docPaths(store, root, dirs, settings.docs.maxDepth)) {
    if (excludedDoc(settings, path) || path === fromRoot(root, file)) continue
    if (pattern.test((await store.read(`${root}/${path}`)) ?? '')) found.push(path)
  }
  const where = dirs.map(dir => entryName(trimDir(dir))).join(', ')

  return found.length === 0
    ? `No document in ${where} mentions \`${name}\`.`
    : [`\`${name}\` is mentioned in:`, ...found.map(path => `- ${path}`)].join('\n')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The map in SHIFT.md: per folder, each document's path, its `description:` and its `##` sections, so the agent knows
// what the docs hold without opening one. Built from the files every time, so it cannot go stale; the mod rewrites only
// the block between its markers.

export const MAP_START = `<!-- ${MOD}:docs — written by the mod from each document's description and ## headings; edit those, not this -->`
export const MAP_END = `<!-- /${MOD}:docs -->`

export type Doc = { path: string; description: string | null; archived?: boolean; sections: string[]; pins: Pin[] }

// A directory link can lead back to an ancestor. Track physical paths on this branch
// so an independently listed alias can still appear under its configured name.
async function walkDocDirs(
  store: Store,
  root: string,
  dir: string,
  remaining: number,
  visit: (dir: string) => Promise<void>,
  ancestors = new Set<string>(),
): Promise<void> {
  const path = `${root}/${dir}`
  const identity = store.directoryIdentity ? await store.directoryIdentity(path) : path
  if (identity === null || ancestors.has(identity)) return
  ancestors.add(identity)
  await visit(dir)
  if (remaining > 0) {
    for (const name of await store.list(path, 'dir')) {
      if (!name.startsWith('.')) await walkDocDirs(store, root, `${dir}/${name}`, remaining - 1, visit, ancestors)
    }
  }
  ancestors.delete(identity)
}

// Every document the settings name, from the project's root, sorted: each .md file under a folder — a missing folder
// has none, a hidden one is skipped — and a named document that is there.
export async function docPaths(store: Store, root: string, dirs: readonly string[], maxDepth = DOCS_MAX_DEPTH): Promise<string[]> {
  const paths = new Set<string>()
  const visit = async (dir: string): Promise<void> => {
    for (const name of await store.list(`${root}/${dir}`, 'file')) if (name.endsWith('.md')) paths.add(`${dir}/${name}`)
  }
  for (const entry of dirs.map(trimDir)) {
    if (!isFile(entry)) await walkDocDirs(store, root, entry, maxDepth, visit)
    else if ((await store.read(`${root}/${entry}`)) !== null) paths.add(entry)
  }

  return [...paths].sort((a, b) => a.localeCompare(b))
}

// Every document the settings name with its stamp, from one listing per folder and no reads: what the next prompt
// compares to find the documents a script changed, which no Edit or Write told the mod of. The map is the mod's own.
export async function docStamps(project: Project): Promise<Record<string, string>> {
  const { store, root, settings } = project
  const found: Record<string, string> = {}
  if (!settings.enabled) return found
  const visit = async (dir: string): Promise<void> => {
    for (const [name, stamp] of Object.entries(await store.stamps(`${root}/${dir}`)))
      if (name.endsWith('.md') && `${dir}/${name}` !== settings.files.shift) found[`${dir}/${name}`] = stamp
  }
  for (const entry of settings.docs.dirs.map(trimDir)) {
    if (!isFile(entry)) await walkDocDirs(store, root, entry, settings.docs.maxDepth, visit)
    else {
      const folder = dirname(entry)
      const stamp = (await store.stamps(folder === '.' ? root : `${root}/${folder}`))[basename(entry)]
      if (stamp !== undefined && entry !== settings.files.shift) found[entry] = stamp
    }
  }

  for (const path of Object.keys(found)) if (excludedDoc(settings, path)) delete found[path]
  for (const [name, stamp] of Object.entries(await store.stamps(`${root}/${KNOWLEDGE}`))) {
    if (name.endsWith('.md')) found[`${KNOWLEDGE}/${name}`] = stamp
  }
  return found
}

// An entry of `[docs] dirs` as paths from the root are written: `./docs/` is `docs`.
export function trimDir(dir: string): string {
  return dir.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
}

// An entry of `[docs] dirs` that names one document rather than a folder.
function isFile(entry: string): boolean {
  return entry.endsWith('.md')
}

// An entry as the mod names it to the agent: a folder with its slash, a document as it is.
function entryName(entry: string): string {
  return isFile(entry) ? `\`${entry}\`` : `\`${entry}/\``
}

// Each active entry keeps its sections regardless of the size of its siblings.
export function renderMap(docs: readonly Doc[], settings: DocsSettings, missing: readonly string[], knowledge = ''): string {
  const { dirs } = settings
  const end = [...(knowledge ? ['', '## Knowledge', '', knowledge] : []), '', MAP_END]
  if (dirs.length === 0) {
    const off =
      "off: the owner set `[docs] dirs = []` in the settings. No map of the documents; do not add descriptions, headings or anything else to the project's docs for it."

    return [MAP_START, '', `## Documents`, '', off, ...end].join('\n')
  }
  const empty = dirs
    .map(trimDir)
    .filter(entry => !settings.exclude.includes(entry) && !docs.some(doc => isDoc(doc.path, [entry], settings.maxDepth)))
    .map(entry => `- ${entryName(entry)} — ${isFile(entry) ? 'no such file' : missing.includes(entry) ? 'no such folder' : 'no documents'}`)
  if (docs.length === 0) return [MAP_START, '', `## Documents`, '', 'none:', ...empty, ...end].join('\n')
  const folders = new Map<string, Doc[]>()
  for (const doc of docs) {
    const folder = dirname(doc.path)
    folders.set(folder, [...(folders.get(folder) ?? []), doc])
  }
  // A folder before the folders inside it.
  const sorted = [...folders].sort(([a], [b]) => a.localeCompare(b))
  const body = sorted.map(([folder, inside]) =>
    [
      `### ${folder}/`,
      '',
      ...inside.flatMap(doc => [
        `- \`${doc.path}\` — ${doc.archived ? '[archived] ' : ''}${doc.description ?? 'no description: add `description:` to its frontmatter'}`,
        ...(doc.archived || doc.sections.length === 0 ? [] : [`  sections: ${doc.sections.join(' · ')}`]),
        ...pinRows(doc.pins),
      ]),
    ].join('\n'),
  )
  const nothing = empty.length === 0 ? [] : ['', 'Nothing to list:', ...empty]
  const pins = pinnedOver(docs, settings)

  return [
    MAP_START,
    '',
    `## Documents`,
    '',
    'Open a document for numbers, commands and names: the map only points.',
    ...(pins === null ? [] : ['', pins]),
    '',
    body.join('\n\n'),
    ...nothing,
    ...end,
  ].join('\n')
}

// SHIFT.md with its map block replaced, or added at the end; a new file starts with a heading and a line on what it is.
export function withMap(shift: string | null, map: string): string {
  if (shift === null) {
    return `# Shift\n\nHow this project keeps its knowledge. The rules are written on the owner's word; the map below is the mod's.\n\n${map}\n`
  }
  const lines = shift.split('\n')
  const { start, end } = mapBounds(lines)
  if (end === -1) return `${shift.trimEnd()}\n\n${map}\n`

  return [...lines.slice(0, start), map, ...lines.slice(end + 1)].join('\n')
}

export function mapBounds(lines: readonly string[]) {
  // The markers on lines of their own, outside code fences: a sentence or an example that names them is the owner's.
  // The opener as any version of the mod wrote it: one comment, the whole line, that starts as the mod's does.
  const opener = `${MAP_START.slice(0, MAP_START.indexOf(' — '))} — `
  const start = lineOutside(lines, line => {
    const trimmed = line.trim()
    return trimmed.startsWith(opener) && trimmed.indexOf('-->') === trimmed.length - 3
  })
  const end = start === -1 ? -1 : lineOutside(lines, line => line.trim() === MAP_END, start + 1)
  return { start, end }
}

// Group the rendered map by its actual entries, including the sections and pins under each.
// Older maps can contain folder entries. Rules and map-level notices can be refreshed by path.
export function mapParts(text: string) {
  const lines = text.split('\n')
  const { start, end } = mapBounds(lines)
  const entries = new Map<string, string>()
  if (end < 0) return { other: '', entries }
  const other: string[] = []
  let key: string | undefined
  for (const line of lines.slice(start + 1, end)) {
    if (!line.trim() || line.startsWith('### ')) continue
    if (!line.startsWith(' ')) key = /^- `([^`]+)`/.exec(line)?.[1]
    if (!key) other.push(line)
    else entries.set(key, entries.has(key) ? `${entries.get(key)}\n${line}` : line)
  }
  return { other: other.join('\n'), entries }
}

// Every document read once: its toc rewritten when the settings ask for one, then the map in SHIFT.md written when it
// changed — nothing when there are no documents and no SHIFT.md yet. At the session's start and a shift; after a write
// mid-run only the map, `tocs: false`: a toc the agent is not told of would fail its next edit.
export async function refreshDocs(project: Project, { tocs = true }: { tocs?: boolean } = {}): Promise<Doc[]> {
  const { store, root } = project
  const settings = project.settings.docs
  const docs: Doc[] = []
  if (project.problem) return docs
  for (const path of await docPaths(store, root, settings.dirs, settings.maxDepth)) {
    if (path === project.settings.files.shift || excludedDoc(project.settings, path)) continue
    let text = (await store.read(`${root}/${path}`)) ?? ''
    const next = tocs && settings.toc ? withToc(text) : null
    if (next !== null && next !== text) {
      await store.write(`${root}/${path}`, next)
      text = next
    }
    docs.push(readDoc(path, text))
  }
  const missing: string[] = []
  for (const entry of settings.dirs.map(trimDir)) {
    if (!excludedDoc(project.settings, trimDir(entry)) && !(await store.exists(`${root}/${entry}`))) missing.push(entry)
  }
  const shift = `${root}/${project.settings.files.shift}`
  const current = await store.read(shift)
  // A file there that cannot be read is not written over: the owner's text in it would be lost.
  const knowledge = knowledgeMap(await readKnowledge(project))
  if (current === null && (await store.exists(shift))) return docs
  // Only session initialization publishes a legacy import. An ordinary refresh
  // must not promote a staged or newly selected external map between retries.
  const legacy = project.settings.files.legacyMap
  if (legacy && current === null && (await store.exists(`${root}/${legacy}`, 'checked').catch(() => true))) return docs
  if (current === null && !docs.length && !knowledge) return docs
  const map = withMap(current, renderMap(docs, settings, missing, knowledge))
  if (map !== current && !('deny' in (await keepRecordsOut(project)))) await store.write(shift, map)

  return docs
}

// A document's pinned blocks under its entry, each with the section it is in: the label on a line of its own, then
// every line of the block under it starting with " · ", a list item's own marker replaced.
function pinRows(pins: readonly Pin[]): string[] {
  return pins.flatMap(pin => [
    `  pinned${pin.section === null ? '' : ` (${pin.section})`}:`,
    ...pin.text
      .split('\n')
      .map(line => line.trim().replace(/^[-*+] +/, ''))
      .filter(line => line !== '')
      .map(line => `    · ${line}`),
  ])
}

// The note when the pinned blocks together pass `[docs] max_pinned`; null within it. Never a refusal: they all show.
export function pinnedOver(docs: readonly Doc[], settings: DocsSettings): string | null {
  const size = docs.reduce((sum, doc) => sum + doc.pins.reduce((each, pin) => each + pin.text.length, 0), 0)

  return size <= settings.maxPinned
    ? null
    : `Pinned: ${size} characters, over \`[docs] max_pinned = ${settings.maxPinned}\` in the settings — every block still shows. Unpin what is not needed in every task, or tell the owner to raise the limit.`
}

// What the map shows of a document.
function readDoc(path: string, text: string): Doc {
  const meta = frontmatter(text)
  return {
    path,
    description: meta.get('description') || null,
    archived: meta.get('archived') === 'true',
    sections: outline(text)
      .filter(h => h.level === 2)
      .map(h => h.title),
    pins: pinned(text),
  }
}
