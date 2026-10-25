// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import type { AFTER, KINDS, OUTCOMES } from './layout'
import type { Placement } from './settings'

export type ShiftAfter = (typeof AFTER)[number]

// The fill the stretch started from, the fill at the last hint, a harness-made let-go the agent is not told of yet,
// the characters the stretch's history grew by, per source, and whether the count holds the whole stretch:
// a fresh process starts with none of it and restores it once from the last shift and the history.
export type Gauge = { base: number | null; hinted: number | null; unassisted: boolean; growth: Record<string, number>; whole: boolean }

export type ShiftInput = { letter: string; after: ShiftAfter; about: string }

// What task_track asks for: an item of a task's track by words of its name, or the task's own line in TASKS.md.
export type TrackInput = { task: string; item: string | null; status: string; note: string | null; add: boolean }

// A task to open: its folder name, its title, goal and done-when for task.md, its first items, and its line with
// the links under it for TASKS.md.
export type OpenInput = {
  name: string
  title: string
  goal: string
  doneWhen: string
  status: string
  about: string
  items: { name: string; note: string | null }[]
  links: { kind: 'needs' | 'after' | 'continues'; name: string; why: string | null }[]
}

export type ArchiveInput = { name: string; outcome: (typeof OUTCOMES)[number]; about: string }

// A `- [status] name — note` line of a block: `rest` is all after the status, `index` the line's place in the text.
export type Item = { status: string; name: string; note: string | null; rest: string; line: string; index: number }

// The board's tasks: status, folder name and the note after the dash.
export type FocusTask = { status: string; name: string; line: string }

// A task's folder: task.md, track.md and the notes in its notes/ folder, each a file name with `.md` and its text.
export type TaskFiles = { name: string; task: string | null; track: string | null; notes: { name: string; text: string }[] }

export type Kind = keyof typeof KINDS

// A file of `knowledge/`: its name with `.md` and its text.
export type KnowledgeFile = { name: string; text: string }

// A file loaded into every session, its path from the project's root.
export type SessionFile = { path: string; text: string }

export type Work = {
  board: string
  owner: string | null
  tasks: TaskFiles[]
  knowledge: KnowledgeFile[]
  // TASKS.md: the open tasks and their links.
  taskList: string | null
  glossary: string | null
  // SHIFT.md: the project's rules and the map of its documents.
  shift: string | null
  // Folder names in the archive.
  archived: string[]
  // owner.md is still there under its old name.
  oldOwner: boolean
}

// What a shift hands back beside the letter: the records as they are now, where new knowledge goes, the last shifts,
// the shift's folder and the documents with remarks.
export type HandedBack = {
  work: Work | null
  knowledge: Placement | null
  // OWNER.md from the project's root, where its settings put it.
  owner: string
  recent: Recent
  dir: string
  remarks: string | null
  // Tasks whose files went unchanged through many shifts, with how many.
  stuck: Stuck[]
}

export type Stuck = { name: string; status: string; shifts: number }

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
  // OWNER.md, absolute, where the project's settings put it.
  owner: string
  sessionId: string
  about: string
  at: number
  segment: Segment
}

// The letter waiting for the owner's next message, the shift folder it came from and the files that go with it.
export type WaitNote = { context: string; dir: string; files: string[] }

// What follows a let-go: the agent goes on from the prompt, or the note waits for the owner; the row tells the owner.
export type Settled = { after: 'continue'; streak: number; prompt: string; row: string } | { after: 'wait'; note: WaitNote; row: string }
