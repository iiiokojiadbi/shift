// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { MAX_AUTO_STREAK, NAMES, TASK_LIST } from '../layout'

// The owner's rows in the transcript: what became of a shift. Short, one line each.

// A note the agent got — a hint, a check — shown to the owner too: the owner sees what the agent is told, and it is
// not their message. One line, however many the note has.
export const TOLD = (body: string) => `to the agent — ${body.split('\n').join(' ')}`

export const NOT_MADE = (name: string, why: string) => `shift ${name} not made — ${why}`

export const CONTINUING = (name: string, shrank: string, dir: string) =>
  `shift ${name} done (${shrank}), continuing from the letter — ${dir}/${NAMES.letter}`

export const WAITING = (name: string, shrank: string, capped: boolean) =>
  `shift ${name} done (${shrank})${capped ? `, ${MAX_AUTO_STREAK} in a row without you` : ''} — waiting for you, the letter goes with your next message`

export const UNSETTLED = (name: string, why: string) =>
  `shift ${name}: the history was let go, but the message after it failed — ${why}; the letter is in the shift's folder`

export const DELIVERED = (files: readonly string[], dir: string) => `went with your message: ${files.join(', ')} — ${dir}/${NAMES.letter}`

export const NOT_CONTINUED = (why: string) => `the next turn did not start after the shift — ${why}; send any message to go on`

// What /shift-tasks shows the owner: every open task, and under one in progress its items not closed yet.
export type TaskView = {
  status: string
  name: string
  about: string
  items: { status: string; name: string }[] | null
  closed: number
  total: number
}

export function renderTasks(tasks: readonly TaskView[]): string {
  if (tasks.length === 0) return `No open tasks in ${TASK_LIST}.`
  return tasks
    .map(task => {
      const head = `[${task.status}] ${task.name} — ${task.about}`
      const count = task.total === 0 ? '' : ` (${task.closed} of ${task.total} items closed)`
      const items = (task.items ?? []).map(item => `    [${item.status}] ${item.name}`)

      return [head + count, ...items].join('\n')
    })
    .join('\n')
}
