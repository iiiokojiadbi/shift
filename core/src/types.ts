import type { AFTER, KINDS } from './layout'
import type { Placement } from './settings'

export type ShiftAfter = (typeof AFTER)[number]

// The fill the stretch started from, the fill at the last hint, a harness-made let-go the agent is not told of yet,
// the characters the stretch's history grew by, per source, and whether the count holds the whole stretch:
// a fresh process starts with none of it and restores it once from the last shift and the history.
export type Gauge = { base: number | null; hinted: number | null; unassisted: boolean; growth: Record<string, number>; whole: boolean }

export type ShiftInput = { letter: string; after: ShiftAfter; about?: string }

export type Kind = keyof typeof KINDS

// A file of `knowledge/`: its name with `.md` and its text.
export type KnowledgeFile = { name: string; text: string }

// A file loaded into every session, its path from the project's root.
export type SessionFile = { path: string; text: string }

export type Work = {
  board: string
  owner: string | null
  knowledge: KnowledgeFile[]
  glossary: string | null
  // SHIFT.md: the project's rules and the map of its documents.
  shift: string | null
}

// What a shift hands back beside the letter: the records as they are now, where new knowledge goes, the last shifts,
// the saved shift ID and the documents with remarks.
export type HandedBack = {
  work: Work | null
  knowledge: Placement | null
  // OWNER.md from the project's root, where its settings put it.
  owner: string
  recent: Recent
  dir: string
  remarks: string | null
}

export type AboutMeta = {
  about: string
  sessionId: string
  at: number
  after: ShiftAfter
  tokensBefore?: number | undefined
  tokensAfter?: number | undefined
  summaryChars?: number | undefined
  result: string
}

export type HintTargets = { soft: number | null; final: number }
export type Reading = {
  tokens: number | undefined
  window: number
  threshold: number | undefined
  hintTargets?: HintTargets
  softHints?: boolean
}

export type HistoryEntry = { name: string; about: string | null; letter?: string }
// The last shifts' about.md, oldest first, and how many shifts the project has in all.
export type Recent = { entries: HistoryEntry[]; total: number }

// A shift accepted and waiting for the turn to end: what the let-go and the message after it need.
export type PendingShift = {
  after: ShiftAfter
  letter: string
  hold: string
  dir: string
  board: string
  // OWNER.md, absolute, where the project's settings put it.
  owner: string
  sessionId: string
  about: string
  at: number
}

// The letter waiting for the owner's next message, its saved shift ID and the files that go with it.
export type WaitNote = {
  context: string
  dir: string
  files: string[]
  held?: readonly { text: string; attachments?: readonly unknown[] }[]
}

// What follows a let-go: the agent goes on from the prompt, or the note waits for the owner; the row tells the owner.
// `note`, for a continue: the same letter as a wait note, kept for the owner's next message when the turn does not start.
export type Settled = { after: 'continue'; prompt: string; note: WaitNote; row: string } | { after: 'wait'; note: WaitNote; row: string }
