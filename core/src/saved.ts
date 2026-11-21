import { DIR, NAMES } from './layout'
import type { Project } from './project'
import type { Work } from './types'

export const ARCHIVE_DB = `${DIR}/history.db`
// Native IDs start at one. Reserve zero for the size report's prospective shift.
export const NEXT_SAVED = 's-0000000000000000'
export const isSaved = (id: string) => /^s-[a-f0-9]{16}$/.test(id)
export const hasArchive = (p: Project) => p.store.exists(`${p.root}/${ARCHIVE_DB}`)

export type SavedEntry = { id: string; about: string; state: string; files: Record<string, string> }
export async function archiveCall<T>(p: Project, request: Record<string, unknown>): Promise<T> {
  if (!p.store.beads) throw new Error('This adapter has no bundled history runtime.')
  return JSON.parse(await p.store.beads(p.root, ['shift-history'], JSON.stringify(request)))
}
export async function savedEntries(p: Project, current?: string, session?: string): Promise<SavedEntry[]> {
  if (!(await hasArchive(p))) return []
  if (!current) return archiveCall(p, { action: 'list' })
  const selection = current === NEXT_SAVED ? { upcoming: true } : { id: current }
  return archiveCall(p, { action: 'list', ...selection, session, limit: p.settings.historyLimit })
}
export function readSaved(p: Project, id: string, file?: string): Promise<SavedEntry> {
  if (!isSaved(id)) throw new Error('Pass a saved shift ID from shift_history.')
  return archiveCall(p, { action: 'read', id, file })
}

export function savedFiles(work: Work, letter: string, settings: string | null) {
  const files: Record<string, string> = { [NAMES.board]: work.board, [NAMES.letter]: letter }
  for (const [name, text] of [
    [NAMES.owner, work.owner],
    [NAMES.glossary, work.glossary],
    [NAMES.shift, work.shift],
    [NAMES.settings, settings],
  ] as const) {
    if (text !== null) files[name] = text
  }
  for (const file of work.knowledge) files[`${NAMES.knowledge}/${file.name}`] = file.text
  return files
}

export async function historyAction(p: Project, raw: Record<string, unknown>): Promise<string> {
  if (raw.action === 'search') {
    const text = typeof raw.query === 'string' ? raw.query.trim() : ''
    if (!text) throw new Error('Pass nonempty search text.')
    const limit = raw.count ?? 10
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('count must be between 1 and 50.')
    const shifts = (await hasArchive(p)) ? await archiveCall<string[]>(p, { action: 'search', query: text, limit }) : []
    return shifts.map(hit => `shift · ${hit}`).join('\n') || 'No matches.'
  }
  const id = String(raw.id ?? '')
  if (!isSaved(id)) throw new Error('Pass a saved shift ID from shift_history.')
  if (raw.action === 'delete') {
    await archiveCall(p, { action: 'delete', id })
    return `Deleted saved shift ${id}.`
  }
  if (raw.action === 'read') {
    const file = String(raw.file ?? NAMES.letter)
    const entry = await readSaved(p, id, file)
    const content = file === NAMES.about ? entry.about : entry.files[file]
    if (typeof content !== 'string') throw new Error(`No record ${file} in ${id}.`)
    return content
  }
  const entry = await readSaved(p, id)
  if (raw.action === 'export') return JSON.stringify({ id, files: { ...entry.files, [NAMES.about]: entry.about } }, null, 2)
  if (raw.action === 'compare') {
    const other = await readSaved(p, String(raw.other ?? ''))
    const delta: string[] = []
    const before: Record<string, string> = { ...entry.files, [NAMES.about]: entry.about },
      after: Record<string, string> = { ...other.files, [NAMES.about]: other.about }
    for (const file of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if (before[file] === after[file]) continue
      const a = before[file]?.split('\n') ?? [],
        b = after[file]?.split('\n') ?? []
      let start = 0,
        end = 0
      while (start < a.length && start < b.length && a[start] === b[start]) start++
      while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++
      delta.push(
        `--- ${id}/${file}\n+++ ${other.id}/${file}\n@@ -${start + Number(a.length > start + end)},${a.length - start - end} +${start + Number(b.length > start + end)},${b.length - start - end} @@`,
        ...a.slice(start, a.length - end).map(s => `-${s}`),
        ...b.slice(start, b.length - end).map(s => `+${s}`),
      )
    }
    return delta.join('\n') || 'Identical records.'
  }
  throw new Error('Choose list, read, compare, export or delete.')
}
