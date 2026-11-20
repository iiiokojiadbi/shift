// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { docOutline, docsMentioning } from './docs'
import { acceptShift, archiveTask, keepRecordsOut, openTask, shiftHistory, staleLayout } from './flows'
import { parseArchiveInput, parseHistoryCount, parseOpenInput, parsePath, parseShiftInput, parseTrackInput } from './input'
import {
  ARCHIVE_TOOL,
  atPlaces,
  DIR,
  GUIDE_TOOL,
  HISTORY_TOOL,
  MANAGE_TOOL,
  MENTIONS_TOOL,
  MIGRATE_TOOL,
  MOD,
  OPEN_TOOL,
  OUTLINE_TOOL,
  QUERY_TOOL,
  SETUP_TOOL,
  SIZES_TOOL,
  STATUS_TOOL,
  TOOL,
  TRACK_TOOL,
} from './layout'
import { holdShift, type Loop } from './loop'
import { migrateRecords } from './migration'
import type { Project } from './project'
import { historyAction, usesNewStorage } from './saved'
import type { Settings } from './settings'
import { setupReport } from './setup'
import { sizeReport } from './sizes'
import { closeGraph, createGraphTask, manageGraph, queryGraph, trackGraph } from './taskgraph'
import { doctrine, doctrineBody, GRAPH_GUIDE_FLOW, GRAPH_GUIDE_RECORDS, GUIDE, GUIDE_FLOW, GUIDE_RECORDS } from './texts/doctrine'
import { EXCLUDED, SHIFT_TOO_EARLY } from './texts/prompts'
import { TOOL_TEXTS, type ToolText } from './texts/tools'
import { updateTrack } from './track'

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
  // The shift loop: a shift accepted is held in it until the turn ends, and only one a turn.
  loop: Loop
  // The session's block as this session holds it; null when the harness reads it anew before every run.
  loaded: () => Promise<string | null>
  // How full the history is: the harness measures it.
  status: () => Promise<string>
  // Why the harness cannot let this history go now — too small to let go of; null when it can.
  cannotLetGo: () => Promise<string | null>
}

// A refusal, or the result.
export type ToolDone = { deny: string } | { result: string }

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
  {
    name: GUIDE_TOOL,
    run: async (raw, call) => {
      if (raw.section !== undefined && raw.section !== 'flow' && raw.section !== 'records')
        return { deny: 'section must be flow or records.' }
      const project = await call.project()
      const modern = await usesNewStorage(project)
      const flow = modern ? GRAPH_GUIDE_FLOW : GUIDE_FLOW
      const records = modern ? GRAPH_GUIDE_RECORDS : GUIDE_RECORDS
      const guide = raw.section === 'flow' ? flow : raw.section === 'records' ? records : modern ? `${flow}\n\n${records}` : GUIDE
      return { result: atPlaces(guide.trimEnd(), project.settings.files) }
    },
  },
  {
    name: TOOL,
    writes: true,
    run: async (raw, call) => {
      if (call.subagent) return { deny: 'Only the main agent shifts, not a subagent.' }
      if ((await call.loop.read()).pending !== null) return { deny: 'The shift is already accepted: end the turn as its result said.' }
      const input = parseShiftInput(raw)
      if (typeof input === 'string') return { deny: input }
      const cannot = await call.cannotLetGo()
      if (cannot !== null) return { deny: SHIFT_TOO_EARLY(cannot) }
      const accepted = await acceptShift(await call.project(), { input, at: await call.now(), sessionId: await call.sessionId() })
      if ('deny' in accepted) return accepted
      await holdShift(call.loop, accepted.shift)

      return { result: accepted.result }
    },
  },
  {
    name: OPEN_TOOL,
    writes: true,
    run: async (raw, call) => {
      const project = await call.project()
      const graph = await usesNewStorage(project)
      const input = parseOpenInput(raw, graph)
      if (typeof input === 'string') return { deny: input }
      if (!graph) return openTask(project, input, await call.now())
      try {
        return { result: await createGraphTask(project, input, raw, await call.sessionId(), await call.now()) }
      } catch (error) {
        return { deny: String(error) }
      }
    },
  },
  {
    name: MANAGE_TOOL,
    writes: true,
    run: async (raw, call) => {
      try {
        return { result: await manageGraph(await call.project(), raw, await call.sessionId()) }
      } catch (error) {
        return { deny: String(error) }
      }
    },
  },
  {
    name: QUERY_TOOL,
    run: async (raw, call) => {
      try {
        return { result: await queryGraph(await call.project(), raw, await call.sessionId()) }
      } catch (error) {
        return { deny: String(error) }
      }
    },
  },
  {
    name: ARCHIVE_TOOL,
    writes: true,
    run: async (raw, call) => {
      const input = parseArchiveInput(raw)

      if (typeof input === 'string') return { deny: input }
      const project = await call.project()
      if (!(await usesNewStorage(project))) return archiveTask(project, input)
      try {
        return { result: await closeGraph(project, input, await call.sessionId()) }
      } catch (error) {
        return { deny: String(error) }
      }
    },
  },
  {
    name: TRACK_TOOL,
    writes: true,
    run: async (raw, call) => {
      const input = parseTrackInput(raw)

      if (typeof input === 'string') return { deny: input }
      const project = await call.project()
      if (!(await usesNewStorage(project))) return updateTrack(project, input, await call.now())
      try {
        return { result: await trackGraph(project, input, await call.sessionId(), await call.now()) }
      } catch (error) {
        return { deny: String(error) }
      }
    },
  },
  {
    name: MIGRATE_TOOL,
    writes: true,
    run: async (raw, call) => {
      try {
        return { result: await migrateRecords(await call.project(), raw) }
      } catch (error) {
        return { deny: String(error) }
      }
    },
  },
  {
    name: HISTORY_TOOL,
    writes: true,
    run: async (raw, call) => {
      if (raw.action && raw.action !== 'list') {
        try {
          return { result: await historyAction(await call.project(), raw) }
        } catch (error) {
          return { deny: String(error) }
        }
      }
      const count = parseHistoryCount(raw)

      return typeof count === 'string' ? { deny: count } : { result: await shiftHistory(await call.project(), count) }
    },
  },
  { name: STATUS_TOOL, run: async (_raw, call) => ({ result: await call.status() }) },
  { name: SIZES_TOOL, run: async (_raw, call) => ({ result: await sizeReport(await call.project()) }) },
  {
    name: SETUP_TOOL,
    run: async (raw, call) => {
      const project = await call.project()
      if (raw.section === undefined) return { result: await setupReport(project, await call.loaded()) }
      if (raw.section !== 'runtime') return { deny: 'Expected section runtime.' }
      if (!project.store.beads) return { deny: 'This adapter has no private task runtime.' }
      try {
        return { result: (await project.store.beads(project.root, ['version'])).trim() }
      } catch (error) {
        return { deny: String(error) }
      }
    },
  },
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
// The doctrine with the tools the project shows, at the places its settings give: in its tag, and the body alone for a
// harness that puts it under a heading of its own. An adapter that has none kept yet builds it here, not from the table.
export function sessionDoctrine(settings: Settings): { doctrine: string; doctrineBody: string } {
  const names = shownTools(settings).map(tool => tool.name)

  return { doctrine: atPlaces(doctrine(names), settings.files), doctrineBody: atPlaces(doctrineBody(names), settings.files) }
}

export async function startSession(project: Project): Promise<SessionStart> {
  const { settings, problem } = project
  const rows: SessionStart['rows'] = []
  if (problem !== null) rows.push({ text: `${MOD}: ${problem} The mod stays on.`, level: 'warning' })
  const start = { enabled: settings.enabled, rows, tools: shownTools(settings), ...sessionDoctrine(settings) }
  if (!settings.enabled) return start

  const stale = await staleLayout(project)
  if (stale !== null) rows.push({ text: `${MOD}: ${stale}`, level: 'warning' })
  if (await project.store.exists(`${project.root}/${DIR}`)) {
    const kept = await keepRecordsOut(project)
    if ('excluded' in kept && kept.excluded !== null) rows.push({ text: EXCLUDED(kept.excluded), level: 'info' })
  }

  return start
}
