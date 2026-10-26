import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import {
  afterTool,
  afterWrite,
  atPrompt,
  beforeTool,
  type Courier,
  dropWaiting,
  FRESH_GAUGE,
  FRESH_LOOKS,
  letGoGauge,
  type Project,
  RESUME_COMMAND,
  RESUME_DESCRIPTION,
  RESUME_GO,
  renderSessionFiles,
  resumeShift,
  runEnded,
  SHIFT_COMMAND,
  SHIFT_NOW,
  SHIFT_NOW_DESCRIPTION,
  SOURCES,
  sessionDoctrine,
  sessionFiles,
  startSession,
  TASKS_COMMAND,
  TASKS_DESCRIPTION,
  TOOL,
  TOOLS,
  tasksView,
  unassistedInstructions,
} from './core/index'
import { projectOf } from './disk'
import { handOver, loopOf } from './handover'
import { countGrowth, keeperOf, statusText } from './hint'
import { OWNER_ORIGINS, PLUGIN } from './state'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const doctrineText = atom({ plugin: 'shift', key: 'doctrine' } as const, null)
const enabled = atom({ plugin: 'shift', key: 'enabled' } as const, true)
const files = atom({ plugin: 'shift', key: 'files' } as const, null)
const filesSession = atom({ plugin: 'shift', key: 'filesSession' } as const, null)
const gauge = atom({ plugin: 'shift', key: 'gauge' } as const, FRESH_GAUGE)
const resumeKick = atom({ plugin: 'shift', key: 'resumeKick' } as const, false)
const looks = atom({ plugin: 'shift', key: 'looks' } as const, FRESH_LOOKS)

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
    await $.command.register({ name: TASKS_COMMAND, description: TASKS_DESCRIPTION, immediate: true })
    await $.command.register({ name: SHIFT_COMMAND, description: SHIFT_NOW_DESCRIPTION, argumentHint: 'words for the agent' })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // A resume, a /clear or a branch resets the state without a session start, and a new root is another project:
    // the switch, the doctrine and the files are read again for what runs now.
    if ((await read($, filesSession)) !== (await sessionKey($))) {
      const project = await projectOf($)
      await update($, enabled, () => project.settings.enabled)
      await update($, doctrineText, () => sessionDoctrine(project.settings).doctrine)
      await loadFiles($, project)
    }
    if (!(await read($, enabled))) return composed
    const loaded: string | null = await read($, files)
    // A state kept by an older version of the mod has no doctrine yet.
    const text: string = (await read($, doctrineText)) ?? sessionDoctrine((await projectOf($)).settings).doctrine
    const own = [{ id: `${PLUGIN}:doctrine`, text, scope: 'session' as const }]
    if (loaded !== null) own.push({ id: `${PLUGIN}:files`, text: loaded, scope: 'session' })

    return { ...composed, sections: [...composed.sections, ...own] }
  })

  // Registered before the table's tools, so it wraps them too: a hook registered later runs inside it, and the mod's own
  // tools answer without passing the call on.
  // Every note to the agent mid-turn goes with a tool's result: what changed in the records around a tool of the main
  // agent, a hint. A written file, the main agent's or a subagent's, is followed by the docs, settled with the next prompt.
  on('tool.call', async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const courier = courierOf($)
    const main = e.agentId === undefined
    const before = main ? await beforeTool(courier) : []
    let done: Awaited<ReturnType<typeof next>>
    try {
      done = await next(e)
    } catch (error) {
      if (main) await afterTool(courier, before, null)
      throw error
    }
    const path = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : undefined
    const written = (e.tool === 'Edit' || e.tool === 'Write') && done.deny === undefined && done.isError !== true ? path : undefined
    if (!main && written !== undefined) await afterWrite(courier, written)
    const notes = main
      ? await afterTool(courier, before, {
          own: e.tool.startsWith(`mcp__${PLUGIN}__`),
          // A subagent's tool writes as the agent's own: the call that ran it is never read-only.
          readOnly: done.isReadOnly === true && !SPAWNS.has(e.tool),
          written,
        })
      : []
    if (notes.length === 0) return done
    if (done.deny !== undefined) return { ...done, deny: [done.deny, ...notes].join('\n\n') }

    return { ...done, context: [...(done.context ?? []), ...notes] }
  }).catch((_$, e, next) => next(e))

  // Every tool of the table; a tool the project does not show is never registered, so never called.
  for (const tool of TOOLS) {
    on('tool.call', { tool: `mcp__${PLUGIN}__${tool.name}` as 'mcp__shift__shift' }, async ($, e, next) => {
      // A tool that throws is refused here: the mod's catch of this event answers for every hook of it, and passes on.
      const done = await tool
        .run(e as unknown as Record<string, unknown>, {
          project: () => projectOf($),
          sessionId: () => $.session.id(),
          now: () => $.clock.now(),
          subagent: e.agentId !== undefined,
          loop: loopOf($),
          loaded: () => read($, files),
          status: () => statusText($),
          cannotLetGo: async () => null,
        })
        .catch((error: unknown) => ({ deny: `${PLUGIN}: ${tool.name} broke (${String(error)}); nothing was let go.` }))
      // A shift interrupted while it was accepted: its turn may have ended already, so it is not made, never one of a
      // later turn.
      if (tool.name === TOOL && next.signal.aborted && !('deny' in done)) $.clock.after(300, () => void handOver($, true))

      return 'deny' in done ? { deny: done.deny } : { result: done.result }
    }).catch((_$, e, next) =>
      next.called ? next(e) : { deny: `${PLUGIN}: ${tool.name} broke (${next.error?.kind ?? 'unknown'}); nothing was let go.` },
    )
  }

  // The letter enters the history with the command itself, so the owner's words — typed with the command or sent
  // right after it — come after the letter, never before it. A bare command starts the turn with a prompt of its own.
  on('command.run', { command: RESUME_COMMAND }, async ($, e) => {
    const resumed = await resumeShift(await projectOf($))
    const { prompt } = resumed
    if (prompt === undefined) return { text: resumed.text }
    // The newest letter goes now: one waiting for the owner's message is not told again.
    await dropWaiting(loopOf($))
    const words = e.args.trim()
    if (words !== '') $.clock.after(100, () => void $.prompt.submit({ text: words, asUser: true }))
    else {
      await update($, resumeKick, () => true)
      $.clock.after(100, () => void kick($))
    }

    return { text: resumed.text, context: pieces(prompt) }
  })

  // The owner's word to shift, without writing it: after the turn in flight, a turn of its own.
  on('command.run', { command: SHIFT_COMMAND }, async ($, e) => {
    $.clock.after(100, () => void $.prompt.submit({ text: SHIFT_NOW(e.args.trim()) }))

    return {}
  })

  // For the owner: it runs at once, even mid-turn, and asks the agent nothing.
  on('command.run', { command: TASKS_COMMAND }, async $ => ({ text: await tasksView(await projectOf($)) }))

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined) return ended

    const aborted = e.reason === 'aborted'
    // No tool of the turn runs any more, whatever a process that ended mid-tool left counted.
    if (await read($, enabled)) await runEnded(courierOf($))
    if ((await loopOf($).read()).pending !== null) $.clock.after(300, () => void handOver($, aborted))

    return ended
  })

  // Every row of the main history is counted by source.
  on('session.append', async ($, e, next) => {
    if (e.agentId !== undefined || !(await read($, enabled))) return next(e)
    const source = growthSource(e.door, e.origin)
    if (source !== null) await countGrowth($, source, e.message.content)

    return next(e)
  }).catch((_$, e, next) => next(e))

  // Between turns the notes come with the next prompt: what changed in the records meanwhile, a hint, and after a wait
  // the letter with the owner's own message — the terminal, the remote bridge or the SDK host.
  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, enabled))) return next(e)
    const owner = OWNER_ORIGINS.has(e.origin?.kind ?? '')
    if (owner) await update($, resumeKick, () => false)
    // A message queued while a tool runs does not start a run: what changed meanwhile may be that tool's.
    const told = await atPrompt(courierOf($), { runStarts: false, owner })
    if (told.notes.length === 0) return next(e)
    // Told and cleared only once the message has entered with them, and the row stands under it: a failed hook or a
    // message dropped beneath keeps every note for the next one.
    const entries = told.notes.flatMap(pieces)
    const entered = await next({ ...e, context: [...(e.context ?? []), ...entries] })
    // Went only if every entry entered: a hook beneath may drop the prompt or strip what it carries. A result that names
    // no context at all says nothing of it, and is taken as gone.
    const context = 'drop' in entered ? undefined : entered.context
    if (!('drop' in entered) && (context === undefined || entries.every(entry => context.includes(entry)))) await told.delivered()

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

// The tools that run a subagent: what it writes comes back as this call's own.
const SPAWNS: ReadonlySet<string> = new Set(['Agent', 'Task'])

// A context entry past 100,000 characters reaches the model as a head and a path: a long note goes as several entries,
// cut between lines, in order, so the letter at its end is read whole.
const PIECE = 90_000

function pieces(text: string): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > PIECE) {
    const cut = rest.lastIndexOf('\n', PIECE)
    const at = cut <= 0 ? PIECE : cut
    out.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^\n/, '')
  }

  return [...out, rest]
}

// The session and the project it runs in: the block is read again when either changes.
async function sessionKey($: EngineInterface): Promise<string> {
  return `${await $.session.id()} ${await $.session.root()}`
}

// The turn after a bare /unshift, unless the owner's own message already started one.
async function kick($: EngineInterface): Promise<void> {
  if (!(await read($, resumeKick))) return
  await update($, resumeKick, () => false)
  await $.prompt.submit({ text: RESUME_GO })
}

// The notes to the agent over the plugin's state: the looks at the records in their atom, the loop and the gauge.
function courierOf($: EngineInterface): Courier {
  return {
    loop: loopOf($),
    gauge: keeperOf($),
    project: () => projectOf($),
    looks: () => read($, looks),
    updateLooks: async change => {
      await update($, looks, change)
    },
  }
}

// SHIFT.md, OWNER.md, GLOSSARY.md, TASKS.md and the owner's own files, read for the session that runs now.
async function loadFiles($: EngineInterface, project: Project): Promise<void> {
  const loaded = renderSessionFiles(await sessionFiles(project))
  const session = await sessionKey($)
  await update($, files, () => loaded)
  await update($, filesSession, () => session)
}
