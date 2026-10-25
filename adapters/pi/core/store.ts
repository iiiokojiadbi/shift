// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { DIR, NAMES, RECENT_SHIFTS, SHIFTS, taskFile } from './layout'
import type { Project } from './project'
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
  // Runs git with `args` in `root`: its exit code and what it printed; null when there is no git to run.
  git(root: string, args: readonly string[]): Promise<{ code: number; stdout: string } | null>
}

// Where the files loaded into every session are, absolute.
export type Places = { owner: string; glossary: string; shift: string }

// The records under `base` (the project's `.shift/` or a shift's snapshot); null without a board.
// A snapshot keeps every file under its own name; a project's places come from its settings.
export async function readWork(store: Store, base: string, places?: Places): Promise<Work | null> {
  const board = await store.read(`${base}/${NAMES.board}`)
  if (board === null) return null
  const at = places ?? { owner: `${base}/${NAMES.owner}`, glossary: `${base}/${NAMES.glossary}`, shift: `${base}/${NAMES.shift}` }
  const tasks: TaskFiles[] = await Promise.all((await store.list(`${base}/${NAMES.tasks}`, 'dir')).map(name => readTask(store, base, name)))

  const knowledge: KnowledgeFile[] = await Promise.all(
    (await store.list(`${base}/${NAMES.knowledge}`, 'file'))
      .filter(name => name.endsWith('.md'))
      .map(async name => ({ name, text: (await store.read(`${base}/${NAMES.knowledge}/${name}`)) ?? '' })),
  )
  const oldOwner = `${base}/${NAMES.oldOwner}`
  // Snapshots taken before OWNER.md keep owner.md.
  const owner = (await store.read(at.owner)) ?? (places === undefined ? await store.read(oldOwner) : null)

  return {
    board,
    owner,
    tasks,
    knowledge,
    taskList: await store.read(`${base}/${NAMES.taskList}`),
    glossary: await store.read(at.glossary),
    shift: await store.read(at.shift),
    archived: await store.list(`${base}/${NAMES.archive}`, 'dir'),
    oldOwner: places !== undefined && places.owner !== oldOwner && (await store.exists(oldOwner)),
  }
}

// A task's folder under `base`.
export async function readTask(store: Store, base: string, name: string): Promise<TaskFiles> {
  const notes = `${base}/${NAMES.tasks}/${name}/${NAMES.notes}`

  return {
    name,
    task: await store.read(taskFile(base, name, 'task')),
    track: await store.read(taskFile(base, name, 'track')),
    notes: await Promise.all(
      (await store.list(notes, 'file'))
        .filter(file => file.endsWith('.md'))
        .map(async file => ({ name: file, text: (await store.read(`${notes}/${file}`)) ?? '' })),
    ),
  }
}

// A shift's folder: the records as they are, each under its own name — the inverse of `readWork` over a snapshot —
// and the letter, the archive's index and the settings beside them.
export async function writeSnapshot(
  store: Store,
  dir: string,
  snapshot: { work: Work; letter: string; index: string | null; settings: string | null },
): Promise<void> {
  const { work } = snapshot
  const files: [string, string | null][] = [
    [NAMES.letter, snapshot.letter],
    [NAMES.board, work.board],
    [NAMES.index, snapshot.index],
    [NAMES.owner, work.owner],
    [NAMES.taskList, work.taskList],
    [NAMES.glossary, work.glossary],
    [NAMES.shift, work.shift],
    [NAMES.settings, snapshot.settings],
    ...work.knowledge.map((file): [string, string] => [`${NAMES.knowledge}/${file.name}`, file.text]),
  ]
  for (const [name, text] of files) if (text !== null) await store.write(`${dir}/${name}`, text)
  for (const task of work.tasks) {
    if (task.task !== null) await store.write(taskFile(dir, task.name, 'task'), task.task)
    if (task.track !== null) await store.write(taskFile(dir, task.name, 'track'), task.track)
    for (const note of task.notes) await store.write(`${dir}/${NAMES.tasks}/${task.name}/${NAMES.notes}/${note.name}`, note.text)
  }
}

// The project's records at the places its settings give.
export function readRecords(project: Project): Promise<Work | null> {
  const { root, settings } = project

  return readWork(project.store, `${root}/${DIR}`, {
    owner: `${root}/${settings.files.owner}`,
    glossary: `${root}/${settings.files.glossary}`,
    shift: `${root}/${settings.files.shift}`,
  })
}

export async function readSnapshot(store: Store, base: string, index: string): Promise<Snapshot | null> {
  const work = await readWork(store, base)

  return work === null ? null : { work, index: await store.read(index) }
}

// Shift folder names, oldest first: they are UTC stamps, so they sort by time.
export function shiftNames({ store, root }: Project): Promise<string[]> {
  return store.list(`${root}/${SHIFTS}`, 'dir')
}

// The newest earlier shift folder, whose snapshots the new state is checked against.
export async function previousShift(project: Project): Promise<string | null> {
  const { root } = project
  const last = (await shiftNames(project)).at(-1)

  return last === undefined ? null : `${root}/${SHIFTS}/${last}`
}

// The last `count` shifts' about.md, oldest first, and how many shifts the project has in all.
export async function lastShifts(project: Project, count: number): Promise<Recent> {
  const { store, root } = project
  const names = await shiftNames(project)
  const entries: HistoryEntry[] = await Promise.all(
    names.slice(-count).map(async name => ({ name, about: await store.read(`${root}/${SHIFTS}/${name}/${NAMES.about}`) })),
  )

  return { entries, total: names.length }
}

// The shifts the message after a shift recalls.
export function recentShifts(project: Project): Promise<Recent> {
  return lastShifts(project, RECENT_SHIFTS)
}
