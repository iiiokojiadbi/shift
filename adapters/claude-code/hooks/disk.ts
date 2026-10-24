import type { EngineInterface } from 'claude-code'
import type { KnowledgeFile, Recent, Snapshot, TaskFiles, Work } from './core/index'
import { DIR, RECENT_SHIFTS } from './core/index'

export async function readOrNull($: EngineInterface, path: string): Promise<string | null> {
  return $.fs.read(path).then(
    text => (typeof text === 'string' ? text : null),
    () => null,
  )
}

async function names($: EngineInterface, path: string, kind: 'dir' | 'file'): Promise<string[]> {
  const entries = await $.fs.list(path).catch(() => [])

  return entries
    .filter(entry => entry.kind === kind)
    .map(entry => entry.name)
    .sort()
}

function dirNames($: EngineInterface, path: string): Promise<string[]> {
  return names($, path, 'dir')
}

// The records under `base` (the project's `.infinity-shift/` or a shift's snapshot); null without a board.
export async function readWork($: EngineInterface, base: string): Promise<Work | null> {
  const board = await readOrNull($, `${base}/board.md`)
  if (board === null) return null
  const tasks: TaskFiles[] = await Promise.all(
    (await dirNames($, `${base}/tasks`)).map(async name => ({
      name,
      task: await readOrNull($, `${base}/tasks/${name}/task.md`),
      track: await readOrNull($, `${base}/tasks/${name}/track.md`),
    })),
  )

  const knowledge: KnowledgeFile[] = await Promise.all(
    (await names($, `${base}/knowledge`, 'file'))
      .filter(name => name.endsWith('.md'))
      .map(async name => ({ name, text: (await readOrNull($, `${base}/knowledge/${name}`)) ?? '' })),
  )

  return { board, owner: await readOrNull($, `${base}/owner.md`), tasks, knowledge }
}

export async function readSnapshot($: EngineInterface, base: string, index: string): Promise<Snapshot | null> {
  const work = await readWork($, base)

  return work === null ? null : { work, index: await readOrNull($, index) }
}

// Shift folder names, oldest first: they are UTC stamps, so they sort by time.
export async function shiftNames($: EngineInterface, root: string): Promise<string[]> {
  return dirNames($, `${root}/${DIR}/shifts`)
}

// The newest earlier shift folder, whose snapshots the new state is checked against.
export async function previousShift($: EngineInterface, root: string): Promise<string | null> {
  const last = (await shiftNames($, root)).at(-1)

  return last === undefined ? null : `${root}/${DIR}/shifts/${last}`
}

// The last shifts' about.md, oldest first, for the message after a shift.
export async function recentShifts($: EngineInterface, root: string): Promise<Recent> {
  const names = await shiftNames($, root)
  const entries = await Promise.all(
    names.slice(-RECENT_SHIFTS).map(async name => ({ name, about: await readOrNull($, `${root}/${DIR}/shifts/${name}/about.md`) })),
  )

  return { entries, total: names.length }
}
