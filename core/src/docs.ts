import { MOD } from './layout'
import { frontmatter } from './markdown'
import type { DocsSettings } from './settings'
import type { Store } from './store'

// The map of the project's documents the mod keeps in SHIFT.md: per folder, each document's path, its `description:`
// and its `##` sections, so the agent knows what the docs hold without opening one. Built from the files every time,
// so it cannot go stale; the mod rewrites only the block between its markers.

export const MAP_START = `<!-- ${MOD}:docs — written by the mod from each document's description and ## headings; edit those, not this -->`
export const MAP_END = `<!-- /${MOD}:docs -->`

export type Doc = { path: string; description: string | null; sections: string[] }

// Every .md file under the folders, sorted by path; a missing folder has none.
export async function readDocs(store: Store, root: string, dirs: readonly string[]): Promise<Doc[]> {
  const docs: Doc[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const name of await store.list(`${root}/${dir}`, 'file')) {
      if (!name.endsWith('.md')) continue
      const text = (await store.read(`${root}/${dir}/${name}`)) ?? ''
      docs.push({ path: `${dir}/${name}`, description: frontmatter(text).get('description') ?? null, sections: headings(text) })
    }
    for (const name of await store.list(`${root}/${dir}`, 'dir')) {
      if (!name.startsWith('.')) await walk(`${dir}/${name}`)
    }
  }
  for (const dir of dirs) await walk(dir.replace(/\/+$/, ''))

  return docs.sort((a, b) => a.path.localeCompare(b.path))
}

// `##` headings outside code fences.
function headings(text: string): string[] {
  let fenced = false
  const found: string[] = []
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) fenced = !fenced
    else if (!fenced && line.startsWith('## ')) found.push(line.slice(3).trim())
  }

  return found
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
    .map(dir => dir.replace(/\/+$/, ''))
    .filter(dir => !docs.some(doc => doc.path.startsWith(`${dir}/`)))
    .map(dir => `- \`${dir}/\` — ${missing.includes(dir) ? 'no such folder' : 'no documents'}`)
  if (docs.length === 0) return [MAP_START, '', `## Documents`, '', 'none:', ...empty, '', MAP_END].join('\n')
  const folders = new Map<string, Doc[]>()
  for (const doc of docs) {
    const folder = doc.path.slice(0, doc.path.lastIndexOf('/'))
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
                `- \`${folder}/\` — ${inside.length} docs: ${inside.map(doc => doc.path.slice(folder.length + 1)).join(', ')}`,
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

// Writes the map into SHIFT.md when it changed; nothing when there are no documents and no SHIFT.md yet.
export async function refreshMap(store: Store, root: string, shiftPath: string, settings: DocsSettings): Promise<void> {
  const dirs = settings.dirs
  const docs = await readDocs(store, root, dirs)
  const missing: string[] = []
  for (const dir of dirs.map(each => each.replace(/\/+$/, ''))) {
    if (!(await store.exists(`${root}/${dir}`))) missing.push(dir)
  }
  const path = `${root}/${shiftPath}`
  const current = await store.read(path)
  if (docs.length === 0 && current === null) return
  const next = withMap(current, renderMap(docs, settings, missing))
  if (next !== current) await store.write(path, next)
}
