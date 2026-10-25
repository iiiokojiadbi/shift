import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import {
  afterWrite,
  type ChangedBy,
  changedRecords,
  doctrine,
  FRESH_GAUGE,
  holdShift,
  letGoGauge,
  ownerSpoke,
  type Project,
  RESUME_COMMAND,
  RESUME_DESCRIPTION,
  RESUME_GO,
  renderSessionFiles,
  resumeShift,
  SOURCES,
  sessionFiles,
  startSession,
  TOOLS,
  unassistedInstructions,
  waitingNote,
  withHint,
} from './core/index'
import { projectOf } from './disk'
import { handOver, loopOf } from './handover'
import { countGrowth, statusText, takeHint } from './hint'
import { OWNER_ORIGINS, PLUGIN } from './state'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const doctrineText = atom({ plugin: 'shift', key: 'doctrine' } as const, null)
const enabled = atom({ plugin: 'shift', key: 'enabled' } as const, true)
const files = atom({ plugin: 'shift', key: 'files' } as const, null)
const filesSession = atom({ plugin: 'shift', key: 'filesSession' } as const, null)
const gauge = atom({ plugin: 'shift', key: 'gauge' } as const, FRESH_GAUGE)
const resumeKick = atom({ plugin: 'shift', key: 'resumeKick' } as const, false)
const running = atom({ plugin: 'shift', key: 'running' } as const, 0)
const seen = atom({ plugin: 'shift', key: 'seen' } as const, null)

export const register: Register = on => {
  // Off in a project whose settings say so: nothing is registered, and every other hook passes through.
  on('session.start', async ($, e, next) => {
    const project = await projectOf($)
    const start = await startSession(project)
    for (const row of start.rows) $.ui.log(row.text)
    await update($, enabled, () => start.enabled)
    await update($, doctrineText, () => start.doctrine)
    if (!start.enabled) return next(e)
    await loadFiles($, project)
    for (const tool of start.tools) {
      await $.tool.register({ name: tool.name, description: tool.description, inputSchema: tool.schema, isDeferred: false })
    }
    await $.command.register({ name: RESUME_COMMAND, description: RESUME_DESCRIPTION })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, enabled))) return composed
    if ((await read($, filesSession)) !== (await $.session.id())) await loadFiles($, await projectOf($))
    const loaded: string | null = await read($, files)
    // A state kept by an older version of the mod has no doctrine yet: it gets every tool's line.
    const text: string = (await read($, doctrineText)) ?? doctrine(TOOLS.map(tool => tool.name))
    const own = [{ id: `${PLUGIN}:doctrine`, text, scope: 'session' as const }]
    if (loaded !== null) own.push({ id: `${PLUGIN}:files`, text: loaded, scope: 'session' })

    return { ...composed, sections: [...composed.sections, ...own] }
  })

  // Registered before the table's tools, so it wraps them too: a hook registered later runs inside it, and the mod's own
  // tools answer without passing the call on.
  // The records are looked at around every tool of the main agent: what changed before it began is someone else's,
  // what changed while it ran is the agent's own. While another tool runs the change before is not looked at — it may
  // be that tool's. The mod's own tools write the records validly: what they wrote is only remembered.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabled))) return next(e)
    // A look that fails says nothing: it must never stand between the agent and its tool.
    const outside = (await read($, running)) === 0 ? await recordsNote($, 'other').catch(() => null) : null
    await update($, running, count => count + 1)
    let done: Awaited<ReturnType<typeof next>>
    try {
      done = await next(e)
    } finally {
      await update($, running, count => Math.max(0, count - 1))
    }
    // A tool that ran read-only changed nothing: no look after it.
    const own = done.isReadOnly === true ? null : await recordsNote($, 'agent').catch(() => null)
    const notes = [outside, e.tool.startsWith(`mcp__${PLUGIN}__`) ? null : own].filter((each): each is string => each !== null)
    if (notes.length === 0) return done
    if (done.deny !== undefined) return { ...done, deny: [done.deny, ...notes].join('\n\n') }

    return { ...done, context: [...(done.context ?? []), ...notes] }
  }).catch((_$, e, next) => next(e))

  // Every tool of the table; a tool the project does not show is never registered, so never called.
  for (const tool of TOOLS) {
    on('tool.call', { tool: `mcp__${PLUGIN}__${tool.name}` as 'mcp__shift__shift' }, async ($, e) => {
      const done = await tool.run(e as unknown as Record<string, unknown>, {
        project: () => projectOf($),
        sessionId: () => $.session.id(),
        now: () => $.clock.now(),
        subagent: e.agentId !== undefined,
        pending: (await loopOf($).read()).pending !== null,
        loaded: () => read($, files),
        status: () => statusText($),
      })
      if ('deny' in done) return { deny: done.deny }
      if (done.shift !== undefined) await holdShift(loopOf($), done.shift)

      return { result: done.result }
    }).catch((_$, e, next) =>
      next.called ? next(e) : { deny: `${PLUGIN}: ${tool.name} broke (${next.error?.kind ?? 'unknown'}); nothing was let go.` },
    )
  }

  // After the agent writes a file the docs follow it: the toc and the map, and remarks in the result, once.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => withDocsNote($, e.file_path, await next(e))).catch((_$, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => withDocsNote($, e.file_path, await next(e))).catch((_$, e, next) => next(e))

  // The letter enters the history with the command itself, so the owner's words — typed with the command or sent
  // right after it — come after the letter, never before it. A bare command starts the turn with a prompt of its own.
  on('command.run', { command: RESUME_COMMAND }, async ($, e) => {
    const resumed = await resumeShift(await projectOf($))
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

    const aborted = e.reason === 'aborted'
    if ((await loopOf($).read()).pending !== null) $.clock.after(300, () => void handOver($, aborted))

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
    // Records changed between turns — by the owner's hand or another session — are told with the next prompt.
    const added = [await recordsNote($, 'other'), await takeHint($)].filter((each): each is string => each !== null)
    const hinted = added.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...added] }
    // Only the owner's own message: the terminal, the remote bridge or the SDK host.
    if (!OWNER_ORIGINS.has(e.origin?.kind ?? '')) return next(hinted)
    await ownerSpoke(loopOf($))
    await update($, resumeKick, () => false)
    const note = await waitingNote(loopOf($))
    if (note === null) return next(hinted)
    // Cleared only once the message has entered with it, and the row stands under it: a failed hook keeps the letter.
    const entered = await next({ ...hinted, context: [...(hinted.context ?? []), note.context] })
    await note.delivered()

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
      await update($, gauge, () => letGoGauge(e.trigger === 'auto'))
    }

    return done
  }).catch((_$, e, next) => next(e))

  on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const unassisted = unassistedInstructions((await projectOf($)).settings.files)

    return next({ ...e, instructions: [e.instructions, unassisted].filter(Boolean).join('\n\n') })
  }).catch((_$, e, next) => next(e))
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

// A written file's result with the mod's check of the docs after it, when there is anything to say.
async function withDocsNote<Done extends { deny?: unknown; isError?: unknown; context?: readonly string[] }>(
  $: EngineInterface,
  file: string,
  done: Done,
): Promise<Done> {
  if (done.deny !== undefined || done.isError === true || !(await read($, enabled))) return done
  const note = await afterWrite(await projectOf($), file)

  return note === null ? done : { ...done, context: [...(done.context ?? []), note] }
}

// The check of the records changed since the mod last looked; the first look only remembers them.
async function recordsNote($: EngineInterface, by: ChangedBy): Promise<string | null> {
  const changed = await changedRecords(await projectOf($), await read($, seen), by)
  await update($, seen, () => changed.seen)

  return changed.note
}

// SHIFT.md, OWNER.md, GLOSSARY.md, TASKS.md and the owner's own files, read for the session that runs now.
async function loadFiles($: EngineInterface, project: Project): Promise<void> {
  const loaded = renderSessionFiles(await sessionFiles(project))
  const session = await $.session.id()
  await update($, files, () => loaded)
  await update($, filesSession, () => session)
}
