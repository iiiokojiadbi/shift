// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
// The owner's rows in the transcript: what became of a shift. Short, one line each.

// A note the agent got — a hint, a check — shown to the owner too: the owner sees what the agent is told, and it is
// not their message. One line, however many the note has.
export const TOLD = (body: string) => `to the agent — ${body.split('\n').join(' ')}`

export const NOT_MADE = (name: string, why: string) => `shift ${name} not made — ${why}`

export const CONTINUING = (name: string, shrank: string, dir: string) =>
  `shift ${name} done (${shrank}), continuing from the letter — shift_history ${dir}`

export const WAITING = (name: string, shrank: string) =>
  `shift ${name} done (${shrank}) — waiting for you, the letter goes with your next message`

export const UNSETTLED = (name: string, why: string) =>
  `shift ${name}: the history was let go, but the message after it failed — ${why}; the accepted letter is in shift history`

export const DELIVERED = (files: readonly string[], dir: string) => `went with your message: ${files.join(', ')} — shift_history ${dir}`

export const HELD = 'your message waits for the shift: it goes to the agent after its letter, once the history is let go'

export const NOT_CONTINUED = (why: string, carried = 'the letter') =>
  `the next turn did not start after the shift — ${why}; send any message to go on, ${carried} goes with it`
