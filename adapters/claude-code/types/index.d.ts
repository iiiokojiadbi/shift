// The contract must be self-contained: ShiftAfter, Gauge, PendingShift and WaitNote mirror the core's types of the same name.
export type ShiftAfter = 'continue' | 'wait'
export type Gauge = { base: number | null; hinted: number | null; unassisted: boolean; growth: Record<string, number>; whole: boolean }

export type PendingShift = {
  after: ShiftAfter
  letter: string
  hold: string
  dir: string
  board: string
  sessionId: string
  about: string
  at: number
  segment: { done: string[]; dropped: string[]; archived: string[]; open: string[] }
}

// The letter waiting for the owner's next message, and the shift folder it came from.
export type WaitNote = { context: string; dir: string; files: string[] }

declare module 'claude-code' {
  // The mod's own tools, as `tools/list` gives them. The generated MCP entry is left out of tsconfig: it is a snapshot of whatever servers were connected at its last save.
  interface McpToolInputs {
    'mcp__infinity-shift__shift': { letter: string; after: ShiftAfter; about: string }
    'mcp__infinity-shift__shift_guide': Record<never, never>
    'mcp__infinity-shift__shift_history': { count?: number }
    'mcp__infinity-shift__shift_status': Record<never, never>
    'mcp__infinity-shift__task_archive': { name: string; outcome: 'done' | 'dropped'; about: string }
  }

  interface PluginState {
    'infinity-shift': {
      pending: PendingShift | null
      waitNote: WaitNote | null
      autoStreak: number
      gauge: Gauge
      threshold: number | null
      // false when the project's settings turn the mod off.
      enabled: boolean
    }
  }
}
