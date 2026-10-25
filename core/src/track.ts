import { ARCHIVE_TOOL, CLOSED, DIR, TASK_LIST, TASKS, taskFile } from './layout'
import { formatItem, itemsOf } from './markdown'
import type { Project } from './project'
import type { Store } from './store'
import { formatTaskLine, taskLine } from './tasks'
import type { Item, ItemChange, TrackInput } from './types'

// Statuses set by a tool instead of an edit by hand: a track item found by the words of its name, or a task's own
// line in TASKS.md. Items carry no ids — the records stay clean, and the agent knows the words it wrote; a fragment
// that finds no item or several is refused with the items listed, so the wrong one is never changed.

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

// Every change applied to the track in order, then written once: one that finds no item or several writes nothing.
async function setItems(
  store: Store,
  root: string,
  task: string,
  changes: readonly ItemChange[],
): Promise<{ deny: string } | { result: string }> {
  const path = taskFile(`${root}/${DIR}`, task, 'track')
  let text = await store.read(path)
  if (text === null) return { deny: `No ${TASKS}/${task}/track.md: the task is not open.` }
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
  const listed = (found: readonly Item[]) => found.map((each, n) => `${n + 1}. ${each.line}`).join('\n')
  const wanted = change.item.toLowerCase()

  if (change.add) {
    if (items.some(each => each.name.toLowerCase() === wanted)) return { deny: `"${change.item}" is already an item of ${task}.` }
    const line = formatItem(change.status, change.item, change.note)
    const body = text.trimEnd()

    return { text: `${body === '' ? '' : `${body}\n`}${line}\n`, line }
  }

  const exact = items.filter(each => each.name.toLowerCase() === wanted)
  const found = exact.length === 1 ? exact : items.filter(each => each.name.toLowerCase().includes(wanted))
  if (found.length > 1) {
    return { deny: `"${change.item}" is in ${found.length} items of ${task}:\n${listed(found)}\nCall again with words that find one.` }
  }
  const only = found[0]
  if (only === undefined) {
    return {
      deny: `No item of ${task} has "${change.item}" in its name. Its items:\n${listed(items)}\nCall again with words of one of them, or add: true for a new item.`,
    }
  }
  lines[only.index] = formatItem(change.status, only.name, change.note ?? only.note)

  return { text: lines.join('\n'), line: lines[only.index] ?? '' }
}
