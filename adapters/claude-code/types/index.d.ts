// The contract must be self-contained: ShiftAfter, Gauge, PendingShift, Looks, WaitNote and LoopState mirror the core's types of the same name.
export type ShiftAfter = 'continue' | 'wait'
export type Gauge = { base: number | null; hinted: number | null; unassisted: boolean; growth: Record<string, number>; whole: boolean }

export type PendingShift = {
  after: ShiftAfter
  letter: string
  hold: string
  dir: string
  board: string
  owner: string
  sessionId: string
  about: string
  at: number
  segment: { done: string[]; dropped: string[]; archived: string[]; open: string[] }
  focus?: string[]
}

export type Looks = { seen: Record<string, string> | null; running: number; written?: readonly string[]; docs?: Record<string, string> }

// A let-go in flight, and whether the owner spoke during it.
export type LetGo = { heard: boolean }

// The letter waiting for the owner's next message, and the shift folder it came from.
export type WaitNote = { context: string; dir: string; files: string[] }

// The shift loop's state, as the core's LoopState: one atom, so a change of it is one update.
export type LoopState = { pending: PendingShift | null; note: WaitNote | null; letting?: LetGo | null }

declare module 'claude-code' {
  // The mod's own tools, as `tools/list` gives them. The generated MCP entry is left out of tsconfig: it is a snapshot of whatever servers were connected at its last save.
  interface McpToolInputs {
    mcp__shift__shift: { letter: string; after: ShiftAfter; about: string }
    mcp__shift__shift_guide: Record<never, never>
    mcp__shift__shift_history: { count?: number }
    mcp__shift__shift_status: Record<never, never>
    mcp__shift__shift_setup: Record<never, never>
    mcp__shift__task_open: {
      name: string
      title: string
      goal: string
      done_when: string
      status?: string
      about: string
      items?: string[]
      needs?: string[]
      after?: string[]
      continues?: string[]
    }
    mcp__shift__task_archive: { name: string; outcome: 'done' | 'dropped'; about: string }
    mcp__shift__task_track: {
      task: string
      id?: number
      item?: string
      status?: string
      note?: string
      items?: { id?: number; item?: string; status: string; note?: string }[]
    }
    mcp__shift__doc_outline: { path: string }
    mcp__shift__docs_mentioning: { file: string }
  }

  interface PluginState {
    shift: {
      // The shift accepted this turn, the letter waiting for the owner, a let-go in flight: one atom, changed whole.
      loop: LoopState
      // true from a bare /unshift until its own prompt goes, or the owner's message comes first and makes it needless.
      resumeKick: boolean
      gauge: Gauge
      // The harness's own let-go threshold and the window it was read for; a null limit when it lets nothing go by itself.
      limit: { window: number; limit: number | null } | null
      // false when the project's settings turn the mod off.
      enabled: boolean
      // The doctrine for the system prompt with the tools this project shows, set at the session's start.
      doctrine: string | null
      // SHIFT.md, OWNER.md, GLOSSARY.md and TASKS.md as one block, read at the session's start and after each shift.
      files: string | null
      // The session the block was read for: a resume or a /clear in the same process starts no session, so a new id
      // is what tells the block to be read again.
      filesSession: string | null
      // The records as the mod last saw them, `<stamp>#<fingerprint>` per path from the project's root, null before the
      // first look; and the main agent's tools running now: a change seen while one runs may be its own.
      looks: Looks
    }
  }
}
