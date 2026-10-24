// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { MAX_AUTO_STREAK } from '../layout'

// The owner's rows in the transcript: what became of a shift. Short, one line each.

export const NOT_MADE = (name: string, why: string) => `shift ${name} not made — ${why}`

export const CONTINUING = (name: string, shrank: string, dir: string) =>
  `shift ${name} done (${shrank}), continuing from the letter — ${dir}/letter.md`

export const WAITING = (name: string, shrank: string, capped: boolean) =>
  `shift ${name} done (${shrank})${capped ? `, ${MAX_AUTO_STREAK} in a row without you` : ''} — waiting for you, the letter goes with your next message`
