import { ARCHIVE_TOOL, CLOSED, DIR, TASK_LIST, TASKS, taskFile } from './layout'
import { formatItem, itemsOf } from './markdown'
import type { Project } from './project'
import type { Store } from './store'
import { formatTaskLine, taskLine } from './tasks'
import type { Item, ItemChange, TrackInput } from './types'

// Statuses set by a tool instead of an edit by hand: a track item found by its id, or a task's own line in TASKS.md.
// An id is the item's `#<n>`, given by the mod when the item is added and never reused in the track: a call names an
// item in a few characters, not by the words of its name.

export async function updateTrack(project: Project, input: TrackInput): Promise<{ deny: string } | { result: string }> {
  const { store, root } = project
  const done: string[] = []
  if (input.items.length > 0) {
    const items = await setItems(store, root, input.task, input.items)
    if ('deny' in items) return items
    done.push(items.result)
  }
  if (input.own !== null) {
    const own = await setTaskStatus(store, root, input.task, input.own)
    if ('deny' in own)
      return done.length === 0 ? own : { deny: `${done.join('\n')}\n\nThe items are set, the task's line is not: ${own.deny}` }
    done.push(own.result)
  }

  return { result: done.join('\n') }
}

async function setTaskStatus(
  store: Store,
  root: string,
  task: string,
  own: { status: string; note: string | null },
): Promise<{ deny: string } | { result: string }> {
  const path = `${root}/${TASK_LIST}`
  const lines = ((await store.read(path)) ?? '').split('\n')
  const at = lines.findIndex(line => taskLine(line)?.name === task)
  const found = taskLine(lines[at] ?? '')
  if (found === null) return { deny: `No line for ${task} in ${TASK_LIST}: open the task there first.` }
  lines[at] = formatTaskLine(own.status, found.label, found.name, own.note ?? found.about)
  await store.write(path, lines.join('\n'))

  return { result: `${TASK_LIST}: ${lines[at]}` }
}

// Every change applied to the track in order, then written once: one that finds no item writes nothing.
async function setItems(
  store: Store,
  root: string,
  task: string,
  changes: readonly ItemChange[],
): Promise<{ deny: string } | { result: string }> {
  const path = taskFile(`${root}/${DIR}`, task, 'track')
  const read = await store.read(path)
  if (read === null) return { deny: `No ${TASKS}/${task}/track.md: the task is not open.` }
  let text = numberItems(read)
  const lines: string[] = []
  for (const [n, change] of changes.entries()) {
    const applied = applyItem(text, task, change)
    if ('deny' in applied) return { deny: changes.length === 1 ? applied.deny : `items[${n}]: ${applied.deny}\nNothing was written.` }
    text = applied.text
    lines.push(`${task}/track.md: ${applied.line}`)
  }
  await store.write(path, text)
  const closed = itemsOf(text).every(each => each.status === '' || CLOSED.has(each.status))
  if (closed) lines.push(`Every item of ${task} is closed: archive it with ${ARCHIVE_TOOL} when the task is over.`)

  return { result: lines.join('\n') }
}

function applyItem(text: string, task: string, change: ItemChange): { deny: string } | { text: string; line: string } {
  const lines = text.split('\n')
  const items = itemsOf(text).filter(item => item.status !== '')

  if ('item' in change) {
    const wanted = change.item.toLowerCase()
    const same = items.find(each => each.name.toLowerCase() === wanted)
    if (same !== undefined) return { deny: `"${change.item}" is already an item of ${task}: #${same.id}.` }
    const line = formatItem(change.status, nextId(items), change.item, change.note)
    const body = text.trimEnd()

    return { text: `${body === '' ? '' : `${body}\n`}${line}\n`, line }
  }

  const found = items.find(each => each.id === change.id)
  if (found === undefined) {
    return { deny: `No item #${change.id} in ${task}. Its items:\n${items.map(each => each.line).join('\n')}` }
  }
  lines[found.index] = formatItem(change.status, change.id, found.name, change.note ?? found.note)

  return { text: lines.join('\n'), line: lines[found.index] ?? '' }
}

// Ids for the track items without one, or with one an earlier item took — added by hand, or written before items had
// ids — numbered on from the highest; the text as it was when every item has its own.
export function numberItems(text: string): string {
  const items = itemsOf(text).filter(item => item.status !== '')
  let next = nextId(items)
  const lines = text.split('\n')
  const seen = new Set<number>()
  for (const item of items) {
    if (item.id !== null && !seen.has(item.id)) {
      seen.add(item.id)
      continue
    }
    lines[item.index] = formatItem(item.status, next++, item.name, item.note)
  }

  return lines.join('\n')
}

// Every open task's track numbered where it has items without ids: done at a shift, so the tracks it hands back
// carry an id on every item.
export async function numberTracks(project: Project): Promise<void> {
  const { store, root } = project
  for (const task of await store.list(`${root}/${TASKS}`, 'dir')) {
    const path = taskFile(`${root}/${DIR}`, task, 'track')
    const text = await store.read(path)
    if (text === null) continue
    const numbered = numberItems(text)
    if (numbered !== text) await store.write(path, numbered)
  }
}

function nextId(items: readonly Item[]): number {
  return Math.max(0, ...items.map(item => item.id ?? 0)) + 1
}
