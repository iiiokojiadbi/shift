// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { ARCHIVE_TOOL, FOCUS, NAME, STATUSES, TASK_LIST, TASKS } from './layout'
import { findDate } from './markdown'
import type { Store } from './store'

// Statuses set by a tool instead of an edit by hand: a track item found by the words of its name, or a task's own
// line in TASKS.md. Items carry no ids — the records stay clean, and the agent knows the words it wrote; a fragment
// that finds no item or several is refused with the items listed, so the wrong one is never changed.

export type TrackInput = { task: string; item: string | null; status: string; note: string | null; add: boolean }

export function parseTrackInput(raw: Record<string, unknown>): TrackInput | string {
  const task = typeof raw.task === 'string' ? raw.task.trim() : ''
  if (!NAME.test(task)) return `task is a task folder name in ${TASKS}/: lowercase latin, digits and dashes.`
  const item = typeof raw.item === 'string' && raw.item.trim() !== '' ? raw.item.trim() : null
  const note = typeof raw.note === 'string' && raw.note.trim() !== '' ? raw.note.trim() : null
  const add = raw.add === true
  const status = typeof raw.status === 'string' ? raw.status.trim() : ''
  const allowed: readonly string[] = item === null ? FOCUS : STATUSES
  if (!allowed.includes(status)) {
    return `status for ${item === null ? `a task in ${TASK_LIST}` : 'a track item'} is one of ${allowed.map(each => `"${each}"`).join(', ')}.`
  }
  if (add && item === null) return "add needs item: the new item's name."
  for (const [what, text] of [
    ['item', item],
    ['note', note],
  ] as const) {
    if (text?.includes('\n')) return `${what} is one line.`
    const date = text === null ? null : findDate(text)
    if (date !== null) return `A date in ${what}: "${date}". Records have no dates.`
  }
  if (item === null && status !== 'in progress' && note === null) {
    return `A ${status} task carries its reason in its line: pass note.`
  }

  return { task, item, status, note, add }
}

const TASK_LINE = /^- \[([^\]]+)\] (\[([^\]]+)\]\(tasks\/([^)/]+)\/?\)) — (.+)$/

export async function updateTrack(store: Store, root: string, input: TrackInput): Promise<{ deny: string } | { result: string }> {
  return input.item === null ? setTaskStatus(store, root, input) : setItem(store, root, { ...input, item: input.item })
}

async function setTaskStatus(store: Store, root: string, input: TrackInput): Promise<{ deny: string } | { result: string }> {
  const path = `${root}/${TASK_LIST}`
  const lines = ((await store.read(path)) ?? '').split('\n')
  const at = lines.findIndex(line => TASK_LINE.exec(line.trimEnd())?.[4] === input.task)
  if (at === -1) return { deny: `No line for ${input.task} in ${TASK_LIST}: open the task there first.` }
  const [, , link = '', , , about = ''] = TASK_LINE.exec(lines[at]?.trimEnd() ?? '') ?? []
  lines[at] = `- [${input.status}] ${link} — ${input.note ?? about}`
  await store.write(path, lines.join('\n'))

  return { result: `${TASK_LIST}: ${lines[at]}` }
}

async function setItem(store: Store, root: string, input: TrackInput & { item: string }): Promise<{ deny: string } | { result: string }> {
  const path = `${root}/${TASKS}/${input.task}/track.md`
  const text = await store.read(path)
  if (text === null) return { deny: `No ${TASKS}/${input.task}/track.md: the task is not open.` }
  const lines = text.split('\n')
  const items = lines
    .map((line, index) => ({ index, match: /^- \[([^\]]+)\] (.*)$/.exec(line.trimEnd()) }))
    .filter((each): each is { index: number; match: RegExpExecArray } => each.match !== null)
    .map(({ index, match }) => {
      const rest = match[2] ?? ''
      const cut = rest.indexOf(' — ')

      return { index, name: cut === -1 ? rest : rest.slice(0, cut), tail: cut === -1 ? '' : rest.slice(cut) }
    })
  const listed = (found: typeof items) => found.map((each, n) => `${n + 1}. ${lines[each.index]?.trim()}`).join('\n')
  const wanted = input.item.toLowerCase()

  if (input.add) {
    if (items.some(each => each.name.toLowerCase() === wanted)) return { deny: `"${input.item}" is already an item of ${input.task}.` }
    const line = `- [${input.status}] ${input.item}${input.note === null ? '' : ` — ${input.note}`}`
    const body = text.trimEnd()
    await store.write(path, `${body === '' ? '' : `${body}\n`}${line}\n`)

    return { result: `${input.task}/track.md: ${line}` }
  }

  const exact = items.filter(each => each.name.toLowerCase() === wanted)
  const found = exact.length === 1 ? exact : items.filter(each => each.name.toLowerCase().includes(wanted))
  if (found.length > 1) {
    return { deny: `"${input.item}" is in ${found.length} items of ${input.task}:\n${listed(found)}\nCall again with words that find one.` }
  }
  const only = found[0]
  if (only === undefined) {
    return {
      deny: `No item of ${input.task} has "${input.item}" in its name. Its items:\n${listed(items)}\nCall again with words of one of them, or add: true for a new item.`,
    }
  }
  lines[only.index] = `- [${input.status}] ${only.name}${input.note === null ? only.tail : ` — ${input.note}`}`
  await store.write(path, lines.join('\n'))
  const open = items.filter(each => each.index !== only.index && /^- \[(in progress|open)\]/.test(lines[each.index] ?? ''))
  const closed = open.length === 0 && (input.status === 'done' || input.status === 'dropped')

  return {
    result: `${input.task}/track.md: ${lines[only.index]}${closed ? `\nEvery item of ${input.task} is closed: archive it with ${ARCHIVE_TOOL} when the task is over.` : ''}`,
  }
}
