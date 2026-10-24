import { DIR, RECENT_SHIFTS } from './layout'
import type { HistoryEntry, KnowledgeFile, Recent, Snapshot, TaskFiles, Work } from './types'

// The files the mod works on, as a harness gives them; paths are absolute.
export type Store = {
  // The file's text; null when it is missing or unreadable.
  read(path: string): Promise<string | null>
  // Names of the folders or files right under `path`, sorted; none when it is missing.
  list(path: string, kind: 'dir' | 'file'): Promise<string[]>
  // Writes the file whole, making its folders.
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  // Moves a folder, making the target's parent; null on success, else what went wrong.
  move(from: string, to: string): Promise<string | null>
  // Whether the project's version control keeps `path` out; true when there is none, so nothing to keep out of.
  isIgnored(root: string, path: string): Promise<boolean>
}

// The records under `base` (the project's `.infinity-shift/` or a shift's snapshot); null without a board.
export async function readWork(store: Store, base: string): Promise<Work | null> {
  const board = await store.read(`${base}/board.md`)
  if (board === null) return null
  const tasks: TaskFiles[] = await Promise.all(
    (await store.list(`${base}/tasks`, 'dir')).map(async name => ({
      name,
      task: await store.read(`${base}/tasks/${name}/task.md`),
      track: await store.read(`${base}/tasks/${name}/track.md`),
    })),
  )

  const knowledge: KnowledgeFile[] = await Promise.all(
    (await store.list(`${base}/knowledge`, 'file'))
      .filter(name => name.endsWith('.md'))
      .map(async name => ({ name, text: (await store.read(`${base}/knowledge/${name}`)) ?? '' })),
  )

  return { board, owner: await store.read(`${base}/owner.md`), tasks, knowledge }
}

export async function readSnapshot(store: Store, base: string, index: string): Promise<Snapshot | null> {
  const work = await readWork(store, base)

  return work === null ? null : { work, index: await store.read(index) }
}

// Shift folder names, oldest first: they are UTC stamps, so they sort by time.
export function shiftNames(store: Store, root: string): Promise<string[]> {
  return store.list(`${root}/${DIR}/shifts`, 'dir')
}

// The newest earlier shift folder, whose snapshots the new state is checked against.
export async function previousShift(store: Store, root: string): Promise<string | null> {
  const last = (await shiftNames(store, root)).at(-1)

  return last === undefined ? null : `${root}/${DIR}/shifts/${last}`
}

// The last `count` shifts' about.md, oldest first, and how many shifts the project has in all.
export async function lastShifts(store: Store, root: string, count: number): Promise<Recent> {
  const names = await shiftNames(store, root)
  const entries: HistoryEntry[] = await Promise.all(
    names.slice(-count).map(async name => ({ name, about: await store.read(`${root}/${DIR}/shifts/${name}/about.md`) })),
  )

  return { entries, total: names.length }
}

// The shifts the message after a shift recalls.
export function recentShifts(store: Store, root: string): Promise<Recent> {
  return lastShifts(store, root, RECENT_SHIFTS)
}
