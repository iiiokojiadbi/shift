import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { WaitNote } from '../types'
import {
  ARCHIVE_DESCRIPTION,
  ARCHIVE_SCHEMA,
  ARCHIVE_TOOL,
  acceptShift,
  archiveTask,
  DIR,
  DOCTRINE,
  EXCLUDED,
  FRESH_GAUGE,
  GUIDE,
  GUIDE_DESCRIPTION,
  GUIDE_SCHEMA,
  GUIDE_TOOL,
  HISTORY_DESCRIPTION,
  HISTORY_SCHEMA,
  HISTORY_TOOL,
  keepRecordsOut,
  parseArchiveInput,
  parseHistoryCount,
  parseShiftInput,
  RESUME_COMMAND,
  RESUME_GO,
  readSettings,
  renderSessionFiles,
  resumeShift,
  SOURCES,
  STATUS_DESCRIPTION,
  STATUS_SCHEMA,
  STATUS_TOOL,
  sessionFiles,
  shiftHistory,
  staleLayout,
  TOOL,
  TOOL_DESCRIPTION,
  TOOL_SCHEMA,
  UNASSISTED_INSTRUCTIONS,
  withHint,
} from './core/index'
import { claudeStore } from './disk'
import { handOver } from './handover'
import { countGrowth, statusText, takeHint } from './hint'
import { OWNER_ORIGINS, PLUGIN } from './state'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const autoStreak = atom({ plugin: 'shift', key: 'autoStreak' } as const, 0)
const enabled = atom({ plugin: 'shift', key: 'enabled' } as const, true)
const files = atom({ plugin: 'shift', key: 'files' } as const, null)
const gauge = atom({ plugin: 'shift', key: 'gauge' } as const, FRESH_GAUGE)
const pending = atom({ plugin: 'shift', key: 'pending' } as const, null)
const resumeKick = atom({ plugin: 'shift', key: 'resumeKick' } as const, false)
const waitNote = atom({ plugin: 'shift', key: 'waitNote' } as const, null)

export const register: Register = on => {
  // Off in a project whose settings say so: nothing is registered, and every other hook passes through.
  on('session.start', async ($, e, next) => {
    const store = claudeStore($)
    const root = await $.session.root()
    const { settings, problem } = await readSettings(store, root)
    await update($, enabled, () => settings.enabled)
    if (problem !== null) $.ui.log(`${PLUGIN}: ${problem} The mod stays on.`)
    if (!settings.enabled) return next(e)
    const stale = await staleLayout(store, root)
    if (stale !== null) $.ui.log(`${PLUGIN}: ${stale}`)
    const loaded = renderSessionFiles(await sessionFiles(store, root))
    await update($, files, () => loaded)
    // Records written before the first shift stay out of a commit too.
    if (await store.exists(`${root}/${DIR}`)) {
      const kept = await keepRecordsOut(store, root, settings)
      if ('excluded' in kept && kept.excluded !== null) $.ui.log(EXCLUDED(kept.excluded))
    }
    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: TOOL_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({ name: GUIDE_TOOL, description: GUIDE_DESCRIPTION, inputSchema: GUIDE_SCHEMA, isDeferred: false })
    await $.tool.register({ name: HISTORY_TOOL, description: HISTORY_DESCRIPTION, inputSchema: HISTORY_SCHEMA, isDeferred: false })
    await $.tool.register({ name: ARCHIVE_TOOL, description: ARCHIVE_DESCRIPTION, inputSchema: ARCHIVE_SCHEMA, isDeferred: false })
    await $.tool.register({ name: STATUS_TOOL, description: STATUS_DESCRIPTION, inputSchema: STATUS_SCHEMA, isDeferred: false })
    await $.command.register({
      name: RESUME_COMMAND,
      description: 'Pick up the work from the last shift: the letter, the board and the tasks in progress go to the agent',
    })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabled))) return composed
    const loaded: string | null = await read($, files)
    const own = [{ id: `${PLUGIN}:doctrine`, text: DOCTRINE, scope: 'session' as const }]
    if (loaded !== null) own.push({ id: `${PLUGIN}:files`, text: loaded, scope: 'session' })

    return { ...composed, sections: [...composed.sections, ...own] }
  })

  on('tool.call', { tool: 'mcp__shift__shift' }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'Only the main agent shifts, not a subagent.' }
    if ((await read($, pending)) !== null) return { deny: 'The shift is already accepted: end the turn with one line.' }

    const parsed = parseShiftInput(e as unknown as Record<string, unknown>)
    if (typeof parsed === 'string') return { deny: parsed }

    const call = { root: await $.session.root(), input: parsed, at: await $.clock.now(), sessionId: await $.session.id() }
    const accepted = await acceptShift(claudeStore($), call)
    if ('deny' in accepted) return accepted
    await update($, pending, () => accepted.shift)

    return { result: accepted.result }
  }).catch((_$, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: the shift broke (${next.error?.kind ?? 'unknown'}), the history is intact.` },
  )

  on('tool.call', { tool: 'mcp__shift__task_archive' }, async ($, e) => {
    const parsed = parseArchiveInput(e as unknown as Record<string, unknown>)
    if (typeof parsed === 'string') return { deny: parsed }

    return archiveTask(claudeStore($), await $.session.root(), parsed)
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: archiving broke (${next.error?.kind ?? 'unknown'}).` }))

  on('tool.call', { tool: 'mcp__shift__shift_guide' }, () => ({ result: GUIDE }))

  on('tool.call', { tool: 'mcp__shift__shift_status' }, async $ => ({ result: await statusText($) })).catch((_$, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: the status did not read (${next.error?.kind ?? 'unknown'}).` },
  )

  on('tool.call', { tool: 'mcp__shift__shift_history' }, async ($, e) => {
    const count = parseHistoryCount(e as unknown as Record<string, unknown>)
    if (typeof count === 'string') return { deny: count }

    return { result: await shiftHistory(claudeStore($), await $.session.root(), count) }
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: the history did not read (${next.error?.kind ?? 'unknown'}).` }))

  // The letter enters the history with the command itself, so the owner's words — typed with the command or sent
  // right after it — come after the letter, never before it. A bare command starts the turn with a prompt of its own.
  on('command.run', { command: RESUME_COMMAND }, async ($, e) => {
    const resumed = await resumeShift(claudeStore($), await $.session.root())
    const { prompt } = resumed
    if (prompt === undefined) return { text: resumed.text }
    const words = e.args.trim()
    if (words !== '') $.clock.after(100, () => void $.prompt.submit({ text: words, asUser: true }))
    else {
      await update($, resumeKick, () => true)
      $.clock.after(100, () => void kick($))
    }

    return { text: resumed.text, context: [prompt] }
  })

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined) return ended

    if ((await read($, pending)) !== null) $.clock.after(300, () => void handOver($))

    return ended
  })

  // Every row of the main history is counted by source; a hint rides inside a tool result: mid-turn, at the agent's next look, with no row of its own.
  on('session.append', async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabled))) return next(e)
    const source = growthSource(e.door, e.origin)
    if (source !== null) await countGrowth($, source, e.message.content)
    if (e.door !== 'tool-result') return next(e)
    const hint = await takeHint($)
    if (hint === null) return next(e)

    return next({ ...e, message: { ...e.message, content: withHint(e.message.content, hint) } })
  }).catch((_$, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const hint = await takeHint($)
    const hinted = hint === null ? e : { ...e, context: [...(e.context ?? []), hint] }
    // Only the owner's own message: the terminal, the remote bridge or the SDK host.
    if (!OWNER_ORIGINS.has(e.origin?.kind ?? '')) return next(hinted)
    await update($, autoStreak, () => 0)
    await update($, resumeKick, () => false)
    const note: WaitNote | null = await read($, waitNote)
    if (note === null) return next(hinted)
    // Cleared only once the message has entered with it: a failed hook keeps the letter for the next one.
    const entered = await next({ ...hinted, context: [...(hinted.context ?? []), note.context] })
    await update($, waitNote, () => null)
    // Logged once the message has entered, so the row stands under it.
    $.ui.log(`went with your message: ${note.files.join(', ')} — ${note.dir}/letter.md`)

    return entered
  }).catch(($, e, next) => {
    // Silent before, the letter once went missing with no trace.
    $.ui.log(`the letter did not go with your message (${next.error?.kind ?? 'unknown'}: ${next.error?.message ?? 'no message'})`)

    return next(e)
  })

  // Any let-go of the main history starts a new stretch; one the agent did not ask for is told to it at its next look.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && done.messages !== undefined) {
      await update($, gauge, () => ({ ...FRESH_GAUGE, unassisted: e.trigger === 'auto', whole: true }))
    }

    return done
  }).catch((_$, e, next) => next(e))

  on('session.compact', { trigger: 'auto' }, async ($, e, next) =>
    (await read($, enabled))
      ? next({ ...e, instructions: [e.instructions, UNASSISTED_INSTRUCTIONS].filter(Boolean).join('\n\n') })
      : next(e),
  ).catch((_$, e, next) => next(e))
}

// Who a row came from, as the hint names it; rows outside the model's history are not counted.
function growthSource(door: string, origin: { kind: string; tool?: string } | undefined): string | null {
  if (door === 'tool-result') return origin?.kind === 'tool' && origin.tool !== undefined ? origin.tool : SOURCES.tools
  if (door === 'response') return SOURCES.responses
  if (door === 'prompt' || door === 'command') return SOURCES.owner
  if (door === 'compaction' || door === 'notice' || door === 'queue') return null

  return SOURCES.attachments
}

// The turn after a bare /unshift, unless the owner's own message already started one.
async function kick($: EngineInterface): Promise<void> {
  if (!(await read($, resumeKick))) return
  await update($, resumeKick, () => false)
  await $.prompt.submit({ text: RESUME_GO })
}
