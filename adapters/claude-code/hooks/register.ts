import type { Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { WaitNote } from '../types'
import {
  ARCHIVE_DESCRIPTION,
  ARCHIVE_SCHEMA,
  ARCHIVE_TOOL,
  acceptShift,
  archiveTask,
  DOCTRINE,
  FRESH_GAUGE,
  GUIDE,
  GUIDE_DESCRIPTION,
  GUIDE_SCHEMA,
  GUIDE_TOOL,
  HISTORY_DESCRIPTION,
  HISTORY_SCHEMA,
  HISTORY_TOOL,
  parseArchiveInput,
  parseHistoryCount,
  parseShiftInput,
  RESUME_COMMAND,
  resumeShift,
  SOURCES,
  STATUS_DESCRIPTION,
  STATUS_SCHEMA,
  STATUS_TOOL,
  shiftHistory,
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
const autoStreak = atom({ plugin: 'infinity-shift', key: 'autoStreak' } as const, 0)
const gauge = atom({ plugin: 'infinity-shift', key: 'gauge' } as const, FRESH_GAUGE)
const pending = atom({ plugin: 'infinity-shift', key: 'pending' } as const, null)
const waitNote = atom({ plugin: 'infinity-shift', key: 'waitNote' } as const, null)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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

  on('prompt.compose', async (_$, e, next) => {
    const composed = await next(e)

    return { ...composed, sections: [...composed.sections, { id: `${PLUGIN}:doctrine`, text: DOCTRINE, scope: 'session' }] }
  })

  on('tool.call', { tool: 'mcp__infinity-shift__shift' }, async ($, e) => {
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

  on('tool.call', { tool: 'mcp__infinity-shift__task_archive' }, async ($, e) => {
    const parsed = parseArchiveInput(e as unknown as Record<string, unknown>)
    if (typeof parsed === 'string') return { deny: parsed }

    return archiveTask(claudeStore($), await $.session.root(), parsed)
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: archiving broke (${next.error?.kind ?? 'unknown'}).` }))

  on('tool.call', { tool: 'mcp__infinity-shift__shift_guide' }, () => ({ result: GUIDE }))

  on('tool.call', { tool: 'mcp__infinity-shift__shift_status' }, async $ => ({ result: await statusText($) })).catch((_$, e, next) =>
    next.called ? next(e) : { deny: `${PLUGIN}: the status did not read (${next.error?.kind ?? 'unknown'}).` },
  )

  on('tool.call', { tool: 'mcp__infinity-shift__shift_history' }, async ($, e) => {
    const count = parseHistoryCount(e as unknown as Record<string, unknown>)
    if (typeof count === 'string') return { deny: count }

    return { result: await shiftHistory(claudeStore($), await $.session.root(), count) }
  }).catch((_$, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: the history did not read (${next.error?.kind ?? 'unknown'}).` }))

  on('command.run', { command: RESUME_COMMAND }, async $ => {
    const resumed = await resumeShift(claudeStore($), await $.session.root())
    const { prompt } = resumed
    if (prompt !== undefined) $.clock.after(100, () => void $.prompt.submit({ text: prompt }))

    return { text: resumed.text }
  })

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined) return ended

    if ((await read($, pending)) !== null) $.clock.after(300, () => void handOver($))

    return ended
  })

  // Every row of the main history is counted by source; a hint rides inside a tool result: mid-turn, at the agent's next look, with no row of its own.
  on('session.append', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const source = growthSource(e.door, e.origin)
    if (source !== null) await countGrowth($, source, e.message.content)
    if (e.door !== 'tool-result') return next(e)
    const hint = await takeHint($)
    if (hint === null) return next(e)

    return next({ ...e, message: { ...e.message, content: withHint(e.message.content, hint) } })
  }).catch((_$, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const hint = await takeHint($)
    const hinted = hint === null ? e : { ...e, context: [...(e.context ?? []), hint] }
    // Only the owner's own message: the terminal, the remote bridge or the SDK host.
    if (!OWNER_ORIGINS.has(e.origin?.kind ?? '')) return next(hinted)
    await update($, autoStreak, () => 0)
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

  on('session.compact', { trigger: 'auto' }, (_$, e, next) =>
    next({ ...e, instructions: [e.instructions, UNASSISTED_INSTRUCTIONS].filter(Boolean).join('\n\n') }),
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
