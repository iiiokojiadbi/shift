import { resolve } from 'node:path'
import type { Plugin } from '@opencode/plugin'
import type { Courier, Gauge, GaugeKeeper, LetGoHarness, Level, Looks, Loop, LoopState, Note, WaitNote } from './core/index'
import {
  addGrowth,
  afterTool,
  afterTurn,
  afterWrite,
  atPrompt,
  beforeTool,
  contentChars,
  countGrowth,
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
  SHIFT_COMMAND,
  SHIFT_NOW,
  SHIFT_NOW_DESCRIPTION,
  SOURCES,
  sessionDoctrine,
  sessionFiles,
  shiftBase,
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
      const fresh: Session = {
        loop: { ...FRESH_LOOP, note },
        gauge: FRESH_GAUGE,
        looks: FRESH_LOOKS,
        fill: undefined,
        busy: false,
        hold: undefined,
        letGo: undefined,
        block: undefined,
      }
      sessions.set(sessionID, sessions.get(sessionID) ?? fresh)

      return sessions.get(sessionID) ?? fresh
    }

    // A subagent runs in a child session: only the main agent shifts and is told.
    async function child(sessionID: string): Promise<boolean> {
      return (await parentOf(sessionID)) !== null
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
      await ctx.session.synthetic({ sessionID, text: row, description: row, resume: false }).catch(() => {})
    }

    function loopOf(sessionID: string): Loop {
      return {
        read: async () => (await state(sessionID)).loop,
        update: async change => {
          const session = await state(sessionID)
          const before = session.loop.note
          session.loop = change(session.loop)
          const { note } = session.loop
          if (note === before) return
          if (note === null) await ctx.storage.remove(waitKey(sessionID))
          else await ctx.storage.set(waitKey(sessionID), note)
        },
        tell: (row, level) => void tell(sessionID, row, level),
      }
    }

    function courierOf(sessionID: string): Courier {
      return {
        loop: loopOf(sessionID),
        gauge: keeperOf(sessionID),
        project: () => projectAt(root),
        looks: async () => (await state(sessionID)).looks,
        updateLooks: async change => {
          const session = await state(sessionID)
          session.looks = change(session.looks)
        },
      }
    }

    // The gauge in the plugin's memory; the history and the base read from the session.
    function keeperOf(sessionID: string): GaugeKeeper {
      return {
        read: async () => (await state(sessionID)).gauge,
        update: async change => {
          const session = await state(sessionID)
          session.gauge = change(session.gauge)
        },
        history: async () => growthIn(await ctx.session.context({ sessionID })),
        base: async () => shiftBase(await projectAt(root), sessionID),
        reading: async () => ({ tokens: (await state(sessionID)).fill, ...(await limits(sessionID)) }),
      }
    }

    // The model's window and where opencode lets the history go by itself: the window less max(15%, 16K), its default.
    async function limits(sessionID: string): Promise<{ window: number; threshold: number | undefined }> {
      const known = windows.get(sessionID)
      if (known !== undefined) return known
      const info = await ctx.session.get({ sessionID }).catch(() => undefined)
      const models = info?.model === undefined ? [] : ((await ctx.model.list().catch(() => undefined))?.data ?? [])
      const model = models.find(each => each.id === info?.model?.id && each.providerID === info?.model?.providerID)
      const window = model?.limit.input || model?.limit.context || 0
      if (window === 0) return { window: 0, threshold: undefined }
      const buffer =
        typeof ctx.options.buffer === 'number' ? ctx.options.buffer : Math.max(Math.floor(window * 0.15), window >= 32_000 ? 16_000 : 0)
      const found = { window, threshold: window - buffer }
      windows.set(sessionID, found)

      return found
    }

    // opencode lets go through a compaction the runner takes once the session is idle; the Hold rides on its hook.
    function letGoOf(sessionID: string): LetGoHarness {
      return {
        fill: async () => (await state(sessionID)).fill,
        letGo: async instructions => {
          const session = await state(sessionID)
          const before = session.fill
          const ended = new Promise<{ text: string } | { error: string }>(done => {
            session.letGo = done
          })
          session.hold = instructions
          try {
            await ctx.session.compact({ sessionID, delivery: 'queue' })
            const end = await ended
            if ('error' in end) return { skip: end.error }
            await ctx.session.wait({ sessionID })
            // The next step measures it; until then the digest and the kept tail stand for it.
            const after = Math.round(end.text.length / CHARS_PER_TOKEN) + Math.min(before ?? 0, KEPT_TOKENS)

            return { messages: [{ role: 'digest', text: end.text }], before, after }
          } finally {
            session.hold = undefined
            session.letGo = undefined
          }
        },
        continueWith: async prompt => {
          await ctx.session.synthetic({ sessionID, text: prompt, description: CONTINUED })
        },
      }
    }

    // The doctrine and the session's files, read at the session's first request and again after each let-go.
    await ctx.session.hook('context', async event => {
      if (await child(event.sessionID)) return
      const session = await state(event.sessionID)
      if (session.block === undefined) {
        const project = await projectAt(root)
        const files = renderSessionFiles(await sessionFiles(project))
        session.block = { doctrine: sessionDoctrine(project.settings).doctrine, files }
      }
      event.system.push({ type: 'text', text: session.block.doctrine })
      if (session.block.files !== null) event.system.push({ type: 'text', text: session.block.files })
    })

    // A compaction the agent asked for holds what its letter says; any other gets the summarizer's instructions.
    await ctx.session.hook('compaction', async event => {
      const hold = sessions.get(event.sessionID)?.hold
      const text = hold ?? unassistedInstructions((await projectAt(root)).settings.files)
      event.system.push({ type: 'text', text })
    })

    // The owner's message: what changed between turns, a hint, and after a wait the letter go with it.
    await ctx.session.hook('prompt', async event => {
      if (await child(event.sessionID)) return
      const { sessionID } = event
      await countGrowth(keeperOf(sessionID), SOURCES.owner, event.prompt.text.length)
      const told = await atPrompt(courierOf(sessionID), { runStarts: !(await state(sessionID)).busy, owner: true })
      if (told.notes.length === 0) return
      const text = told.notes.join('\n\n')
      await ctx.session.synthetic({ sessionID, text, description: NOTES, resume: false })
      await countGrowth(keeperOf(sessionID), SOURCES.attachments, text.length)
      await told.delivered()
    })

    // Every note to the agent mid-run goes with a tool's result: what changed in the records around a tool of the agent,
    // the docs after a write, a hint. A subagent's write gets only the docs.
    await ctx.tool.hook('execute.before', async event => {
      if (await child(event.sessionID)) return
      outside.set(event.id, await beforeTool(courierOf(event.sessionID)))
    })

    await ctx.tool.hook('execute.after', async event => {
      const { sessionID } = event
      const done = event.status === 'completed' ? event.result : null
      const path = done !== null && WRITING.has(event.tool) ? (event.input as { path?: unknown }).path : undefined
      const written = typeof path === 'string' ? resolve(root, path) : undefined
      if (done !== null) await countGrowth(keeperOf(sessionID), event.tool, contentChars(done.content))
      if (await child(sessionID)) {
        if (written !== undefined) await afterWrite(courierOf(await mainOf(sessionID)), written)
        return
      }
      const before = outside.get(event.id) ?? []
      outside.delete(event.id)
      const end = done === null ? null : { own: OURS.has(event.tool), readOnly: READING.has(event.tool), written }
      const added = await afterTool(courierOf(sessionID), before, end)
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
          await ctx.session.synthetic({
            sessionID,
            text: SHIFT_NOW(prompt.text.trim()),
            description: `/${SHIFT_COMMAND}`,
            delivery: 'queue',
          })
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
      const data = (event.data ?? {}) as Ended & { tokens?: Tokens; reason?: string }
      if (typeof data.sessionID !== 'string' || (await child(data.sessionID))) return
      const session = await state(data.sessionID)
      switch (event.type) {
        case 'session.execution.started':
          session.busy = true
          return
        case 'session.step.ended': {
          const tokens = data.tokens as Tokens | undefined
          if (tokens === undefined) return
          session.fill = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
          const said = ((tokens.output ?? 0) + (tokens.reasoning ?? 0)) * CHARS_PER_TOKEN
          await countGrowth(keeperOf(data.sessionID), SOURCES.responses, said)
          return
        }
        case 'session.compaction.ended':
          session.gauge = letGoGauge(data.reason === 'auto')
          session.fill = undefined
          session.block = undefined
          session.letGo?.({ text: data.text ?? '' })
          return
        case 'session.compaction.failed':
          session.letGo?.({ error: `the compaction failed: ${errorText(data.error)}` })
          return
        // A run is over, whichever way it ended: a shift held in it lets go now, unless the owner interrupted it.
        case 'session.execution.succeeded':
        case 'session.execution.failed':
        case 'session.execution.interrupted': {
          session.busy = false
          const courier = courierOf(data.sessionID)
          await courier.updateLooks(current => (current.running === 0 ? current : { ...current, running: 0 }))
          if (session.loop.pending === null) return
          const aborted = event.type === 'session.execution.interrupted'
          void afterTurn(await projectAt(root), loopOf(data.sessionID), letGoOf(data.sessionID), aborted)
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

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)

  return JSON.stringify(error)
}

// The growth of the history since the last let-go, counted the way rows are counted as they come.
function growthIn(messages: readonly unknown[]): Record<string, number> {
  let gauge = FRESH_GAUGE
  for (const message of messages as { type: string; text?: string; content?: unknown }[]) {
    if (message.type === 'compaction') gauge = FRESH_GAUGE
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
