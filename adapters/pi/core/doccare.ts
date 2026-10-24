// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { docPaths, refreshMap, trimDir } from './docs'
import { DIR, MOD } from './layout'
import { frontmatter } from './markdown'
import { type DocsSettings, readSettings } from './settings'
import type { Store } from './store'

// The project's documents the mod keeps beside the map: a toc inside each document, checks after the agent writes a
// file, a document's sections with line numbers, and the documents that mention a file. Only in the folders of
// `[docs] dirs`; with none the mod touches no document.

export const TOC_START = '<!-- toc -->'
export const TOC_END = '<!-- /toc -->'

export type Heading = { level: number; title: string; note: string; line: number }

// `##` and `###` outside code fences, each with the `> ` line right under it as its note.
export function outline(text: string): Heading[] {
  const lines = text.split('\n')
  const found: Heading[] = []
  let fenced = false
  for (const [index, line] of lines.entries()) {
    if (line.trimStart().startsWith('```')) fenced = !fenced
    if (fenced) continue
    const heading = /^(#{2,3}) (.+)$/.exec(line)
    if (heading === null) continue
    const under = lines[index + 1] ?? ''
    found.push({
      level: heading[1]?.length ?? 2,
      title: (heading[2] ?? '').trim(),
      note: under.startsWith('> ') ? under.slice(2).trim() : '',
      line: index + 1,
    })
  }

  return found
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
  const title = /^# .+\n/m.exec(text)
  if (title === null) return null
  const at = title.index + title[0].length

  return `${text.slice(0, at)}\n${block}\n${text.slice(at)}`
}

export function isDoc(path: string, dirs: readonly string[]): boolean {
  return path.endsWith('.md') && dirs.some(dir => path.startsWith(`${trimDir(dir)}/`))
}

function description(text: string): string | null {
  const found = frontmatter(text).get('description') ?? ''

  return found === '' ? null : found
}

function lineCount(text: string): number {
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

// What a document breaks of the settings: its description and its length.
export function docRemarks(text: string, docs: DocsSettings): string[] {
  const remarks: string[] = []
  const about = description(text)
  if (about === null) remarks.push('no `description:` in its frontmatter')
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
  for (const dir of dirs.map(trimDir)) {
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
export async function afterWrite(store: Store, root: string, file: string): Promise<string | null> {
  const { settings } = await readSettings(store, root)
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
  if (doc) await refreshMap(store, root, settings.files.shift, docs)
  const remarks = [
    ...(doc ? docRemarks(text, docs) : []),
    ...(await brokenLinks(store, root, path, text, docs.dirs)).map(link => `a link to \`${link}\` that is not there`),
  ]
  if (remarks.length > 0) lines.push(`\`${path}\`: ${remarks.join('; ')}.`)

  return lines.length === 0 ? null : `<${MOD} note="the mod's check of the file just written">\n${lines.join('\n')}\n</${MOD}>`
}

// Every document's toc written from its headings, when the settings ask for one; at the session's start and a shift.
export async function refreshTocs(store: Store, root: string, docs: DocsSettings): Promise<void> {
  if (!docs.toc) return
  for (const path of await docPaths(store, root, docs.dirs)) {
    const text = await store.read(`${root}/${path}`)
    const next = text === null ? null : withToc(text)
    if (next !== null && next !== text) await store.write(`${root}/${path}`, next)
  }
}

// Every document with a remark, and the root's Markdown files with a broken link; null when there are none.
export async function docsReport(store: Store, root: string): Promise<string | null> {
  const { settings } = await readSettings(store, root)
  const docs = settings.docs
  if (!settings.enabled || docs.dirs.length === 0) return null
  const rootFiles = (await store.list(root, 'file')).filter(name => name.endsWith('.md'))
  const lines: string[] = []
  for (const path of [...(await docPaths(store, root, docs.dirs)), ...rootFiles]) {
    const text = (await store.read(`${root}/${path}`)) ?? ''
    const remarks = [
      ...(isDoc(path, docs.dirs) ? docRemarks(text, docs) : []),
      ...(await brokenLinks(store, root, path, text, docs.dirs)).map(link => `a link to \`${link}\` that is not there`),
    ]
    if (remarks.length > 0) lines.push(`- \`${path}\`: ${remarks.join('; ')}`)
  }

  return lines.length === 0 ? null : lines.join('\n')
}

// A document's description and its `##` and `###` with line numbers, so the agent reads only the section it needs.
export async function docOutline(store: Store, root: string, file: string): Promise<string> {
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
export async function docsMentioning(store: Store, root: string, file: string): Promise<string> {
  const { settings } = await readSettings(store, root)
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
  const where = dirs.map(dir => `\`${trimDir(dir)}/\``).join(', ')

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
