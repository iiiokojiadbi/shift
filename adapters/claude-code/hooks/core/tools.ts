// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { docOutline, docsMentioning } from './docs'
import { acceptShift, archiveTask, keepRecordsOut, shiftHistory, staleLayout } from './flows'
import { parseArchiveInput, parseHistoryCount, parsePath, parseShiftInput } from './input'
import {
  ARCHIVE_TOOL,
  DIR,
  GUIDE_TOOL,
  HISTORY_TOOL,
  MENTIONS_TOOL,
  MOD,
  OUTLINE_TOOL,
  SETUP_TOOL,
  STATUS_TOOL,
  TOOL,
  TRACK_TOOL,
} from './layout'
import type { Project } from './project'
import type { Settings } from './settings'
import { setupReport } from './setup'
import { doctrine, doctrineBody, GUIDE } from './texts/doctrine'
import { EXCLUDED } from './texts/prompts'
import { TOOL_TEXTS, type ToolText } from './texts/tools'
import { parseTrackInput, updateTrack } from './track'
import type { PendingShift } from './types'

// The mod's tools as one table: an adapter registers every row the project shows and hands each call to its `run`.
// A new tool is a name in layout, its texts and a row here; no adapter changes.

// What a call knows beyond its arguments; the adapter fills it from the harness. What costs a read is asked for
// only by the tool that needs it: the guide loads no project, the status reads no files.
export type ToolCall = {
  project: () => Promise<Project>
  sessionId: () => Promise<string>
  now: () => Promise<number>
  // A subagent's call: only the main agent shifts.
  subagent: boolean
  // A shift is already accepted in this turn.
  pending: boolean
  // The session's block as this session holds it; null when the harness reads it anew before every run.
  loaded: () => Promise<string | null>
  // How full the history is: the harness measures it.
  status: () => Promise<string>
}

// A refusal, or the result; an accepted shift also comes back for the adapter to let go after the turn.
export type ToolDone = { deny: string } | { result: string; shift?: PendingShift }

export type Tool = ToolText & {
  name: string
  // Writes the records: a harness that runs tools side by side runs these one at a time.
  writes: boolean
  // Shown only where the mod keeps the project's docs.
  docs: boolean
  run: (raw: Record<string, unknown>, call: ToolCall) => Promise<ToolDone>
}

type Row = Omit<Tool, keyof ToolText | 'writes' | 'docs'> & { writes?: boolean; docs?: boolean }

const ROWS: readonly Row[] = [
  { name: GUIDE_TOOL, run: async () => ({ result: GUIDE }) },
  {
    name: TOOL,
    writes: true,
    run: async (raw, call) => {
      if (call.subagent) return { deny: 'Only the main agent shifts, not a subagent.' }
      if (call.pending) return { deny: 'The shift is already accepted: end the turn with one line.' }
      const input = parseShiftInput(raw)
      if (typeof input === 'string') return { deny: input }

      return acceptShift(await call.project(), { input, at: await call.now(), sessionId: await call.sessionId() })
    },
  },
  {
    name: ARCHIVE_TOOL,
    writes: true,
    run: async (raw, call) => {
      const input = parseArchiveInput(raw)

      return typeof input === 'string' ? { deny: input } : archiveTask(await call.project(), input)
    },
  },
  {
    name: TRACK_TOOL,
    writes: true,
    run: async (raw, call) => {
      const input = parseTrackInput(raw)

      return typeof input === 'string' ? { deny: input } : updateTrack(await call.project(), input)
    },
  },
  {
    name: HISTORY_TOOL,
    run: async (raw, call) => {
      const count = parseHistoryCount(raw)

      return typeof count === 'string' ? { deny: count } : { result: await shiftHistory(await call.project(), count) }
    },
  },
  { name: STATUS_TOOL, run: async (_raw, call) => ({ result: await call.status() }) },
  { name: SETUP_TOOL, run: async (_raw, call) => ({ result: await setupReport(await call.project(), await call.loaded()) }) },
  {
    name: OUTLINE_TOOL,
    docs: true,
    run: async (raw, call) => {
      const path = parsePath(raw, 'path')

      return path === null
        ? { deny: "path is the document, from the project's root." }
        : { result: await docOutline(await call.project(), path) }
    },
  },
  {
    name: MENTIONS_TOOL,
    docs: true,
    run: async (raw, call) => {
      const file = parsePath(raw, 'file')

      return file === null
        ? { deny: 'file is the file whose name to look for.' }
        : { result: await docsMentioning(await call.project(), file) }
    },
  },
]

export const TOOLS: readonly Tool[] = ROWS.map(row => {
  const text = TOOL_TEXTS[row.name]
  if (text === undefined) throw new Error(`No texts for the tool ${row.name}.`)

  return { ...text, writes: false, docs: false, ...row }
})

// The tools a project with these settings shows: none where the mod is off, no docs tools where it keeps no docs.
export function shownTools(settings: Settings): Tool[] {
  if (!settings.enabled) return []

  return TOOLS.filter(tool => !tool.docs || settings.docs.dirs.length > 0)
}

// What a session starts with: whether the mod is on, the rows for the owner, the tools to register and the doctrine.
export type SessionStart = {
  enabled: boolean
  rows: { text: string; level: 'info' | 'warning' }[]
  tools: Tool[]
  // The doctrine for the system prompt, with and without its tag.
  doctrine: string
  doctrineBody: string
}

// A broken settings file is told and leaves the mod on; records in an older layout are named; records the project's
// git would take in are kept out before the first shift too.
export async function startSession(project: Project): Promise<SessionStart> {
  const { settings, problem } = project
  const rows: SessionStart['rows'] = []
  if (problem !== null) rows.push({ text: `${MOD}: ${problem} The mod stays on.`, level: 'warning' })
  const tools = shownTools(settings)
  const names = tools.map(tool => tool.name)
  const start = { enabled: settings.enabled, rows, tools, doctrine: doctrine(names), doctrineBody: doctrineBody(names) }
  if (!settings.enabled) return start

  const stale = await staleLayout(project)
  if (stale !== null) rows.push({ text: `${MOD}: ${stale}`, level: 'warning' })
  if (await project.store.exists(`${project.root}/${DIR}`)) {
    const kept = await keepRecordsOut(project)
    if ('excluded' in kept && kept.excluded !== null) rows.push({ text: EXCLUDED(kept.excluded), level: 'info' })
  }

  return start
}
