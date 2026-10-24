// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import type { KINDS } from './layout'

export type ShiftAfter = 'continue' | 'wait'

// The fill the stretch started from, the fill at the last hint, a harness-made let-go the agent is not told of yet,
// the characters the stretch's history grew by, per source, and whether the count holds the whole stretch:
// a fresh process starts with none of it and restores it once from the last shift and the history.
export type Gauge = { base: number | null; hinted: number | null; unassisted: boolean; growth: Record<string, number>; whole: boolean }

export type ShiftInput = { letter: string; after: ShiftAfter; about: string }

export type ArchiveInput = { name: string; outcome: 'done' | 'dropped'; about: string }

// `- [status] rest` lines of a block.
export type Item = { status: string; rest: string; line: string }

// The board's tasks: status, folder name and the note after the dash.
export type FocusTask = { status: string; name: string; line: string }

export type TaskFiles = { name: string; task: string | null; track: string | null }

export type Kind = keyof typeof KINDS

// A file of `knowledge/`: its name with `.md` and its text.
export type KnowledgeFile = { name: string; text: string }

export type Work = { board: string; owner: string | null; tasks: TaskFiles[]; knowledge: KnowledgeFile[]; settings: string | null }

// What one stretch of work did, from the files against the previous shift's snapshot.
export type Segment = { done: string[]; dropped: string[]; archived: string[]; open: string[] }

export type Snapshot = { work: Work; index: string | null }

export type AboutMeta = {
  about: string
  sessionId: string
  at: number
  after: ShiftAfter
  segment: Segment
  tokensBefore?: number | undefined
  tokensAfter?: number | undefined
  summaryChars?: number | undefined
  result: string
}

export type Reading = { tokens: number | undefined; window: number; threshold: number | undefined }

export type HistoryEntry = { name: string; about: string | null }
// The last shifts' about.md, oldest first, and how many shifts the project has in all.
export type Recent = { entries: HistoryEntry[]; total: number }

// A shift accepted and waiting for the turn to end: what the let-go and the message after it need.
export type PendingShift = {
  after: ShiftAfter
  letter: string
  hold: string
  dir: string
  board: string
  sessionId: string
  about: string
  at: number
  segment: Segment
}

// The letter waiting for the owner's next message, the shift folder it came from and the files that go with it.
export type WaitNote = { context: string; dir: string; files: string[] }

// What follows a let-go: the agent goes on from the prompt, or the note waits for the owner; the row tells the owner.
export type Settled = { after: 'continue'; streak: number; prompt: string; row: string } | { after: 'wait'; note: WaitNote; row: string }
