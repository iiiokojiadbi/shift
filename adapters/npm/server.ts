import { resolve } from 'node:path'
import type { Plugin } from '@opencode/plugin'
import type {
  Courier,
  Gauge,
  GaugeKeeper,
  LetGoHarness,
  Level,
  Looks,
  Loop,
  LoopState,
  Note,
  PendingShift,
  Project,
  WaitNote,
} from './core/index'
import {
  addGrowth,
  afterTool,
  afterTurn,
  afterWrite,
  atPrompt,
  beforeTool,
  compactInstructions,
  contentChars,
  countGrowth,
  dropWaiting,
  FRESH_GAUGE,
  FRESH_LOOKS,
  FRESH_LOOP,
  gaugeStatus,
  letGoGauge,
  MOD,
  RESUME_COMMAND,
  RESUME_DESCRIPTION,
  renderSessionFiles,
  resumeShift,
  runEnded,
  SHIFT_COMMAND,
  SHIFT_NOW_DESCRIPTION,
  SOURCES,
  sessionDoctrine,
  sessionFiles,
  shiftBase,
  shiftNow,
  startSession,
  TASKS_COMMAND,
  TASKS_DESCRIPTION,
  TOOLS,
  tasksView,
  unassistedInstructions,
} from './core/index'
import { projectAt } from './store'

type Definition = Plugin.Plugin

const OURS: ReadonlySet<string> = new Set(TOOLS.map(tool => tool.name))
// opencode's tools that only read, and those that write one file by `path`.
const READING: ReadonlySet<string> = new Set(['read', 'glob', 'grep'])
const WRITING: ReadonlySet<string> = new Set(['edit', 'write'])
// opencode keeps this much of the latest history whole beside the digest, unless its config says otherwise.
const KEPT_TOKENS = 15_000
// A token is about four characters: the step's tokens stand for the response's text, which the event does not carry.
const CHARS_PER_TOKEN = 4
// The rows the owner sees above what the mod sends the agent.
const CONTINUED = `${MOD}: the letter and the records`
const NOTES = `${MOD}: notes to the agent`

// What the plugin keeps of one session; the plugin is one per project, shared by its sessions.
type Session = {
  // The project's settings turn the mod on for it, read as the session first comes; the rows that start it, told once.
  enabled: boolean
  rows: { text: string; level: Level }[]
  loop: LoopState
  gauge: Gauge
  looks: Looks
  // The last step's prompt size: the history as the model read it.
  fill: number | undefined
  // A run is going on; set when it starts, cleared at idle.
  busy: boolean
  // The Hold of the shift being let go, and what its let-go ended in.
  hold: string | undefined
  letGo: ((end: { text: string } | { error: string }) => void) | undefined
  // The inbox item of the let-go the mod asked for: its cancel ends the wait for it.
  letGoID: string | undefined
  // A let-go opencode made by itself while a shift was pending, with the shift's Hold: it is that shift's let-go.
  early: string | undefined
  // The doctrine and the session's files as the session started or last let go: a block read anew every
  // request would show records the history has not reached yet and break the prompt's cache on every write.
  block: { doctrine: string; files: string | null } | undefined
}

type Ended = { sessionID: string; text?: string; error?: unknown; tokens?: { input?: number } }

const plugin: Definition = {
  id: MOD,
  async setup(ctx) {
    const root = ctx.location.directory
    const start = await startSession(await projectAt(root))
    if (!start.enabled) return
    // The docs' tocs and map are refreshed once, as the plugin starts: later the notes settle what changed, each with
    // its note.
    await sessionFiles(await projectAt(root)).catch(() => [])
    // The model a session without its own uses.
    let defaultModel: { providerID: string; modelID: string } | undefined
    await ctx.model.transform(models => {
      defaultModel = models.default.get()
    })

    const sessions = new Map<string, Session>()
    const parents = new Map<string, string | null>()
    const windows = new Map<string, { window: number; threshold: number | undefined }>()
    const outside = new Map<string, Note[]>()
    let stopped = false

    // A session's state, its waiting letter read back from the plugin's storage the first time: it outlives a restart.
    async function state(sessionID: string): Promise<Session> {
      const known = sessions.get(sessionID)
      if (known !== undefined) return known
      const note = ((await ctx.storage.get(waitKey(sessionID))) ?? null) as WaitNote | null
      // A shift accepted before the plugin reloaded lets go at the next run's end.
      const pending = ((await ctx.storage.get(pendingKey(sessionID))) ?? null) as PendingShift | null
      const begun = await startSession(await projectAt(root))
      const fresh: Session = {
        enabled: begun.enabled,
        rows: begun.rows,
        loop: { ...FRESH_LOOP, note, pending },
        gauge: FRESH_GAUGE,
        looks: FRESH_LOOKS,
        fill: undefined,
        busy: false,
        hold: undefined,
        letGo: undefined,
        letGoID: undefined,
        early: undefined,
        block: undefined,
      }
      sessions.set(sessionID, sessions.get(sessionID) ?? fresh)

      return sessions.get(sessionID) ?? fresh
    }

    // A subagent runs in a child session: only the main agent shifts and is told.
    async function child(sessionID: string): Promise<boolean> {
      return (await parentOf(sessionID)) !== null
    }

    // A session the mod does not serve: a subagent's, or one the settings turned the mod off for.
    async function apart(sessionID: string): Promise<boolean> {
      return (await child(sessionID)) || !(await state(sessionID)).enabled
    }

    async function parentOf(sessionID: string): Promise<string | null> {
      const known = parents.get(sessionID)
      if (known !== undefined) return known
      const info = await ctx.session.get({ sessionID }).catch(() => undefined)
      const parent = info?.parentID ?? null
      parents.set(sessionID, parent)

      return parent
    }

    // The main session a subagent's session runs under, through any depth.
    async function mainOf(sessionID: string): Promise<string> {
      const parent = await parentOf(sessionID)

      return parent === null ? sessionID : mainOf(parent)
    }

    // A row for the owner: a synthetic message the owner sees by its description; the agent reads it with the next one.
    async function tell(sessionID: string, row: string, _level: Level): Promise<void> {
      // Queued: a running turn does not take it as a message to answer.
      await ctx.session.synthetic({ sessionID, text: row, description: row, resume: false, delivery: 'queue' }).catch(() => {})
    }

    function loopOf(sessionID: string): Loop {
      return {
        read: async () => (await state(sessionID)).loop,
        update: async change => {
          const session = await state(sessionID)
          const before = session.loop
          session.loop = change(session.loop)
          const { note, pending } = session.loop
          if (pending !== before.pending) await keep(pendingKey(sessionID), pending)
          if (note !== before.note) await keep(waitKey(sessionID), note)
        },
        tell: (row, level) => void tell(sessionID, row, level),
      }
    }

    async function keep(key: string, value: unknown): Promise<void> {
      if (value === null) await ctx.storage.remove(key)
      else await ctx.storage.set(key, value as never)
    }

    // A project loaded once for the hook at hand.
    function once(): () => Promise<Project> {
      const loading = projectAt(root)
      return () => loading
    }

    function courierOf(sessionID: string, project: () => Promise<Project> = once()): Courier {
      return {
        loop: loopOf(sessionID),
        gauge: keeperOf(sessionID, project),
        project,
        looks: async () => (await state(sessionID)).looks,
        updateLooks: async change => {
          const session = await state(sessionID)
          session.looks = change(session.looks)
        },
      }
    }

    // The gauge in the plugin's memory; the history and the base read from the session.
    function keeperOf(sessionID: string, project: () => Promise<Project> = once()): GaugeKeeper {
      return {
        read: async () => (await state(sessionID)).gauge,
        update: async change => {
          const session = await state(sessionID)
          session.gauge = change(session.gauge)
        },
        history: async () => growthIn(await ctx.session.context({ sessionID })),
        base: async () => shiftBase(await project(), sessionID),
        reading: async () => ({ tokens: (await state(sessionID)).fill, ...(await limits(sessionID)) }),
      }
    }

    // The model's window and where opencode lets the history go by itself: the window less max(15%, 16K), its default,
    // or the `buffer` given unless it leaves nothing. Kept per model: a session that changes its model is read anew.
    async function limits(sessionID: string): Promise<{ window: number; threshold: number | undefined }> {
      const info = await ctx.session.get({ sessionID }).catch(() => undefined)
      const ref =
        info?.model ?? (defaultModel === undefined ? undefined : { id: defaultModel.modelID, providerID: defaultModel.providerID })
      if (ref === undefined) return { window: 0, threshold: undefined }
      const key = `${ref.providerID}/${ref.id}`
      const known = windows.get(key)
      if (known !== undefined) return known
      const models = (await ctx.model.list().catch(() => undefined))?.data ?? []
      const model = models.find(each => each.id === ref.id && each.providerID === ref.providerID)
      const window = model?.limit.input || model?.limit.context || 0
      if (window === 0) return { window: 0, threshold: undefined }
      const given = typeof ctx.options.buffer === 'number' && ctx.options.buffer < window ? ctx.options.buffer : undefined
      const buffer = given ?? Math.max(Math.floor(window * 0.15), window >= 32_000 ? 16_000 : 0)
      const found = { window, threshold: window - buffer }
      windows.set(key, found)

      return found
    }

    // opencode lets go through a compaction the runner takes once the session is idle; the Hold rides on its hook.
    function letGoOf(sessionID: string): LetGoHarness {
      return {
        fill: async () => (await state(sessionID)).fill,
        letGo: async instructions => {
          const session = await state(sessionID)
          const before = session.fill
          // opencode let go by itself after the shift was accepted, with its Hold: that was the shift's let-go.
          const early = session.early
          session.early = undefined
          if (early !== undefined) {
            return { messages: [{ role: 'digest', text: early }], before, after: Math.round(early.length / CHARS_PER_TOKEN) }
          }
          const ended = new Promise<{ text: string } | { error: string }>(done => {
            session.letGo = done
          })
          session.hold = instructions
          try {
            session.letGoID = (await ctx.session.compact({ sessionID, delivery: 'queue' })).id
            const end = await ended
            if ('error' in end) return { skip: end.error }
            await ctx.session.wait({ sessionID })
            // The next step measures it; until then the digest and the kept tail stand for it.
            const after = Math.round(end.text.length / CHARS_PER_TOKEN) + Math.min(before ?? 0, KEPT_TOKENS)

            return { messages: [{ role: 'digest', text: end.text }], before, after }
          } finally {
            session.hold = undefined
            session.letGo = undefined
            session.letGoID = undefined
          }
        },
        continueWith: async prompt => {
          await ctx.session.synthetic({ sessionID, text: prompt, description: CONTINUED })
        },
      }
    }

    // The doctrine and the session's files, read at the session's first request and again after each let-go.
    await ctx.session.hook('context', async event => {
      if (await apart(event.sessionID)) return
      const session = await state(event.sessionID)
      for (const row of session.rows.splice(0)) await tell(event.sessionID, row.text, row.level)
      if (session.block === undefined) {
        const project = await projectAt(root)
        const files = renderSessionFiles(await sessionFiles(project, { refresh: false }))
        session.block = { doctrine: sessionDoctrine(project.settings).doctrine, files }
      }
      event.system.push({ type: 'text', text: session.block.doctrine })
      if (session.block.files !== null) event.system.push({ type: 'text', text: session.block.files })
    })

    // A compaction the agent asked for holds what its letter says; any other gets the summarizer's instructions.
    await ctx.session.hook('compaction', async event => {
      const session = sessions.get(event.sessionID)
      // One opencode makes by itself while a shift is pending holds that shift's Hold too.
      const pending = session?.loop.pending ?? null
      const hold = session?.hold ?? (pending === null ? undefined : compactInstructions(pending))
      const text = hold ?? unassistedInstructions((await projectAt(root)).settings.files)
      event.system.push({ type: 'text', text })
    })

    // The owner's message: what changed between turns, a hint, and after a wait the letter go with it.
    await ctx.session.hook('prompt', async event => {
      if (await apart(event.sessionID)) return
      const { sessionID } = event
      const courier = courierOf(sessionID)
      await countGrowth(courier.gauge, SOURCES.owner, event.prompt.text.length)
      const told = await atPrompt(courier, { runStarts: !(await state(sessionID)).busy, owner: true })
      if (told.notes.length === 0) return
      const text = told.notes.join('\n\n')
      // Delivered as the owner's message is: a queued one takes its notes with it, not a run before it.
      await ctx.session.synthetic({ sessionID, text, description: NOTES, resume: false, delivery: event.delivery })
      await countGrowth(courier.gauge, SOURCES.attachments, text.length)
      await told.delivered()
    })

    // Every note to the agent mid-run goes with a tool's result: what changed in the records around a tool of the agent,
    // the docs after a write, a hint. A subagent's write gets only the docs.
    await ctx.tool.hook('execute.before', async event => {
      if (await apart(event.sessionID)) return
      outside.set(event.id, await beforeTool(courierOf(event.sessionID)))
    })

    await ctx.tool.hook('execute.after', async event => {
      const { sessionID } = event
      const done = event.status === 'completed' ? event.result : null
      const path = done !== null && WRITING.has(event.tool) ? (event.input as { path?: unknown }).path : undefined
      const written = typeof path === 'string' ? resolve(root, path) : undefined
      if (await child(sessionID)) {
        if (written !== undefined && (await state(await mainOf(sessionID))).enabled)
          await afterWrite(courierOf(await mainOf(sessionID)), written)
        return
      }
      if (!(await state(sessionID)).enabled) return
      const courier = courierOf(sessionID)
      if (done !== null) await countGrowth(courier.gauge, event.tool, contentChars(done.content))
      const before = outside.get(event.id) ?? []
      outside.delete(event.id)
      const end = done === null ? null : { own: OURS.has(event.tool), readOnly: READING.has(event.tool), written }
      const added = await afterTool(courier, before, end)
      if (done === null || added.length === 0) return
      const blocks = added.map(text => ({ type: 'text' as const, text }))
      const content = typeof done.content === 'string' ? [{ type: 'text' as const, text: done.content }] : (done.content ?? [])
      if (event.status === 'completed') event.result = { ...done, content: [...content, ...blocks] }
    })

    await ctx.tool.transform(tools => {
      for (const tool of start.tools) {
        tools.add({
          name: tool.name,
          description: tool.description,
          input: tool.schema,
          // Called by its name, not through the code-mode tool.
          options: { codemode: false },
          execute: async (input, call) => {
            if (!(await state(call.sessionID)).enabled) throw new Error(`${MOD} is off in this project: its settings say enabled = false.`)
            const done = await tool.run(input as Record<string, unknown>, {
              project: () => projectAt(root),
              sessionId: async () => call.sessionID,
              now: async () => Date.now(),
              subagent: await child(call.sessionID),
              loop: loopOf(call.sessionID),
              // The session's files as this session read them: shift_setup tells which changed since.
              loaded: async () => (await state(call.sessionID)).block?.files ?? null,
              status: () => gaugeStatus(keeperOf(call.sessionID)),
              cannotLetGo: async () => null,
            })
            if ('deny' in done) throw new Error(done.deny)

            return { content: done.result }
          },
        })
      }
    })

    await ctx.command.transform(commands => {
      // The owner's word to shift: once the run going on is over, a turn of its own.
      commands.add({
        name: SHIFT_COMMAND,
        description: SHIFT_NOW_DESCRIPTION,
        execute: async ({ sessionID, prompt }) => {
          const now = await shiftNow(loopOf(sessionID), prompt.text.trim())
          await ctx.session.synthetic({ sessionID, text: now.text, description: `/${SHIFT_COMMAND}`, delivery: 'queue' })
          await now.delivered()
        },
      })
      // The letter first; the owner's words typed with the command come after it as their own message.
      commands.add({
        name: RESUME_COMMAND,
        description: RESUME_DESCRIPTION,
        execute: async ({ sessionID, prompt }) => {
          const resumed = await resumeShift(await projectAt(root))
          const words = prompt.text.trim()
          if (resumed.prompt === undefined) return tell(sessionID, resumed.text, 'info')
          await ctx.session.synthetic({ sessionID, text: resumed.prompt, description: resumed.text, resume: words === '' })
          // The newest letter went: one waiting for the owner's message is not told again.
          await dropWaiting(loopOf(sessionID))
          if (words !== '') await ctx.session.prompt({ sessionID, text: words })
        },
      })
      // For the owner: it asks the agent nothing; the agent reads it with the next message.
      commands.add({
        name: TASKS_COMMAND,
        description: TASKS_DESCRIPTION,
        execute: async ({ sessionID }) => tell(sessionID, await tasksView(await projectAt(root)), 'info'),
      })
    })

    // The runs and the let-gos, by the server's events; a let-go is awaited outside the loop that reads its end.
    async function onEvent(event: { type: string; data?: unknown }): Promise<void> {
      const data = (event.data ?? {}) as Ended & { tokens?: Tokens; reason?: string; inboxID?: string }
      if (typeof data.sessionID !== 'string' || (await apart(data.sessionID))) return
      const session = await state(data.sessionID)
      switch (event.type) {
        case 'session.execution.started':
          session.busy = true
          session.early = undefined
          return
        case 'session.step.ended': {
          const tokens = data.tokens as Tokens | undefined
          if (tokens === undefined) return
          session.fill = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
          const said = ((tokens.output ?? 0) + (tokens.reasoning ?? 0)) * CHARS_PER_TOKEN
          await countGrowth(keeperOf(data.sessionID), SOURCES.responses, said)
          return
        }
        // Only the let-go the mod asked for answers it: one opencode makes by itself is `auto`, and while a shift is
        // pending it carries the shift's Hold and stands for its let-go.
        case 'session.compaction.ended':
          session.gauge = letGoGauge(data.reason === 'auto')
          session.fill = undefined
          session.block = undefined
          if (data.reason !== 'auto') session.letGo?.({ text: data.text ?? '' })
          else if (session.loop.pending !== null) session.early = data.text ?? ''
          return
        case 'session.compaction.failed':
          if (data.reason !== 'auto') session.letGo?.({ error: `the harness did not let the history go: ${errorText(data.error)}` })
          return
        case 'session.inbox.cancelled':
          if (data.inboxID !== undefined && data.inboxID === session.letGoID) session.letGo?.({ error: 'the let-go was cancelled' })
          return
        // A run is over, whichever way it ended: a shift held in it lets go now, unless the owner interrupted it.
        case 'session.execution.succeeded':
        case 'session.execution.failed':
        case 'session.execution.interrupted': {
          session.busy = false
          const project = once()
          await runEnded(courierOf(data.sessionID, project))
          if (session.loop.pending === null) return
          const aborted = event.type === 'session.execution.interrupted'
          void afterTurn(await project(), loopOf(data.sessionID), letGoOf(data.sessionID), aborted)
          return
        }
      }
    }

    void (async () => {
      for await (const event of ctx.event.subscribe()) {
        if (stopped) return
        await onEvent(event as { type: string; data?: unknown }).catch(() => {})
      }
    })()

    return () => {
      stopped = true
    }
  },
}

export default plugin

type Tokens = { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }

// The waiting letter of a session, in the plugin's storage.
function waitKey(sessionID: string): string {
  return `wait:${sessionID}`
}

// The shift a session accepted and has not let go yet: a reload of the plugin must not drop it.
function pendingKey(sessionID: string): string {
  return `pending:${sessionID}`
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)

  return JSON.stringify(error)
}

// The growth of the history since the last let-go, counted the way rows are counted as they come.
function growthIn(messages: readonly unknown[]): Record<string, number> {
  let gauge = FRESH_GAUGE
  for (const message of messages as { type: string; status?: string; text?: string; content?: unknown }[]) {
    // A let-go that failed or still runs left the history before it whole.
    if (message.type === 'compaction') gauge = message.status === undefined || message.status === 'completed' ? FRESH_GAUGE : gauge
    else if (message.type === 'user') gauge = addGrowth(gauge, SOURCES.owner, message.text?.length ?? 0)
    else if (message.type === 'synthetic') gauge = addGrowth(gauge, SOURCES.attachments, message.text?.length ?? 0)
    else if (message.type === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content as { type: string; name?: string; state?: { content?: unknown } }[]) {
        if (block.type === 'tool') gauge = addGrowth(gauge, block.name ?? SOURCES.tools, contentChars(block.state?.content))
        else gauge = addGrowth(gauge, SOURCES.responses, contentChars(block))
      }
    }
  }

  return gauge.growth
}
