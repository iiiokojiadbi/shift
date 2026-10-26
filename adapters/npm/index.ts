import { resolve } from 'node:path'
import type { CompactionEntry, CompactionResult, ExtensionAPI, ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent'
import { estimateTokens, findCutPoint, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'
import type { Courier, Gauge, GaugeKeeper, LetGoHarness, Looks, Loop, LoopState, Note, Project, WaitNote } from './core/index'
import {
  addGrowth,
  afterTool,
  afterTurn,
  afterWrite,
  atPrompt,
  beforeTool,
  contentChars,
  countGrowth,
  dropWaiting,
  FRESH_GAUGE,
  FRESH_LOOKS,
  FRESH_LOOP,
  formatK,
  gaugeStatus,
  letGoGauge,
  MOD,
  RESUME_COMMAND,
  RESUME_DESCRIPTION,
  resumeShift,
  SETTINGS,
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
} from './core/index'
import { projectAt } from './store'

const OURS: ReadonlySet<string> = new Set(TOOLS.map(tool => tool.name))
// pi's tools that only read: nothing to look at after them.
const READING: ReadonlySet<string> = new Set(['read', 'grep', 'find', 'ls'])

// The custom entry that keeps a wait note across a reload: the extension's own state lives only as long as its runtime.
const WAIT_ENTRY = `${MOD}:wait`

export default function shift(pi: ExtensionAPI): void {
  let loop: LoopState = FRESH_LOOP
  let gauge: Gauge = FRESH_GAUGE
  // Set by the owner's own input, consumed by the run it starts.
  let ownerTyped = false
  // false when the project's settings turn the mod off; read at each session start.
  let enabled = true
  // The documents' tocs and the map are refreshed at the first run of a session, before anything looks at them.
  let refreshed = false
  // The records as last seen and the agent's tools running now; what changed before each tool began, by its call.
  let looks: Looks = FRESH_LOOKS
  const outside = new Map<string, Note[]>()

  const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }], details: undefined })
  const schema = (shape: object) => shape as TSchema

  // Every tool of the table; the session's start takes the ones the project does not show out of the active set.
  for (const tool of TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: schema(tool.schema),
      ...(tool.writes ? { executionMode: 'sequential' as const } : {}),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const done = await tool.run(params as Record<string, unknown>, {
          project: () => projectAt(ctx.cwd),
          sessionId: async () => ctx.sessionManager.getSessionId(),
          now: async () => Date.now(),
          subagent: false,
          loop: loopOf(ctx),
          // pi reads the session's files anew before every run, so its copy is never older than them.
          loaded: async () => null,
          status: () => gaugeStatus(keeperOf(ctx, () => projectAt(ctx.cwd))),
          cannotLetGo: async () => cannotLetGo(ctx),
        })
        if ('deny' in done) throw new Error(done.deny)

        return text(done.result)
      },
    })
  }

  pi.registerCommand(TASKS_COMMAND, {
    description: TASKS_DESCRIPTION,
    handler: async (_args, ctx) => ctx.ui.notify(await tasksView(await projectAt(ctx.cwd)), 'info'),
  })

  pi.registerCommand(SHIFT_COMMAND, {
    description: SHIFT_NOW_DESCRIPTION,
    handler: async (args, ctx) => {
      if (!enabled) return ctx.ui.notify(`${MOD} is off in this project: ${SETTINGS} has enabled = false.`, 'info')
      // Typed mid-run, it waits for the run to end, as Claude Code holds a command until the turn is over.
      pi.sendUserMessage(SHIFT_NOW(args.trim()), ctx.isIdle() ? undefined : { deliverAs: 'followUp' })
    },
  })

  pi.registerCommand(RESUME_COMMAND, {
    description: RESUME_DESCRIPTION,
    // The owner's words typed with the command go after the letter, as their own message that starts the turn.
    handler: async (args, ctx) => {
      if (!enabled) return ctx.ui.notify(`${MOD} is off in this project: ${SETTINGS} has enabled = false.`, 'info')
      const resumed = await resumeShift(await projectAt(ctx.cwd))
      ctx.ui.notify(resumed.text, 'info')
      if (resumed.prompt === undefined) return
      // The newest letter goes now: one waiting for the owner's message is not told again.
      await dropWaiting(loopOf(ctx))
      const words = args.trim()
      // Typed mid-run, both wait for the run to end.
      const busy = ctx.isIdle() ? {} : { deliverAs: 'followUp' as const }
      pi.sendMessage({ customType: MOD, content: resumed.prompt, display: true }, { triggerTurn: words === '', ...busy })
      if (words !== '') pi.sendUserMessage(words, ctx.isIdle() ? undefined : { deliverAs: 'followUp' })
    },
  })

  // Tools are registered before the project is known, so an off project only takes them out of the active set.
  // A wait note survives a reload: the last wait entry on the branch says whether one is still undelivered.
  pi.on('session_start', async (_event, ctx) => {
    const start = await startSession(await projectAt(ctx.cwd))
    enabled = start.enabled
    refreshed = false
    for (const row of start.rows) tell(ctx, row.text, row.level)
    const shown = start.tools.map(tool => tool.name)
    pi.setActiveTools([...pi.getActiveTools().filter(name => !OURS.has(name)), ...shown])
    if (!enabled) return
    loop = { ...loop, note: branchNote(ctx) }
  })

  // Another branch has its own wait note, or none: a letter of the branch left behind never goes with this one.
  // Its history too: the gauge is counted anew from the branch.
  pi.on('session_tree', async (_event, ctx) => {
    if (!enabled) return
    loop = { ...loop, note: branchNote(ctx) }
    gauge = FRESH_GAUGE
  })

  // The owner's own input: only a message that starts a run takes the waiting letter with it. An extension's message
  // comes after any owner input another extension took without a run, so it clears what that left.
  pi.on('input', async (event, _ctx) => {
    if (!enabled) return
    if (event.source === 'extension') ownerTyped = false
    else if (event.streamingBehavior === undefined) ownerTyped = true
  })

  // The doctrine every run; between turns a hint, and after a wait the letter, follow the owner's message.
  pi.on('before_agent_start', async (event, ctx) => {
    if (!enabled) return
    const loading = projectAt(ctx.cwd)
    const project = () => loading
    // The doctrine at the settings' places: a shift may have moved a record.
    event.systemPromptOptions.sections[MOD] = sessionDoctrine((await loading).settings).doctrineBody
    // A session's first run refreshes the tocs and the map before the documents' stamps are first looked at.
    if (!refreshed) await sessionFiles(await loading)
    refreshed = true
    // Records changed between runs — by the owner's hand or another session — a hint, and after a wait the letter.
    const owner = event.messageType === 'user' && ownerTyped
    if (owner) ownerTyped = false
    const told = await atPrompt(courierOf(ctx, project), { runStarts: true, owner })
    if (told.notes.length > 0) await told.delivered()
    // SHIFT.md, OWNER.md, GLOSSARY.md and TASKS.md go where pi puts AGENTS.md; the same paths are replaced, not added
    // twice. Read after the notes: a toc a script left stale is written with its note, never silently before it.
    const loaded = await sessionFiles(await loading, { refresh: false })
    const ours = new Set(loaded.map(file => file.path))
    event.systemPromptOptions.contextFiles = [
      ...event.systemPromptOptions.contextFiles.filter(file => !ours.has(file.path)),
      ...loaded.map(file => ({ path: file.path, content: file.text })),
    ]
    if (told.notes.length === 0) return

    return { message: { customType: MOD, content: told.notes.join('\n\n'), display: true } }
  })

  // Every message of the history is counted by source.
  pi.on('message_end', async (event, ctx) => {
    if (!enabled) return
    const source = growthSource(event.message)
    if (source !== null)
      await countGrowth(
        keeperOf(ctx, () => projectAt(ctx.cwd)),
        source,
        messageChars(event.message),
      )
  })

  // Every note to the agent mid-run goes with a tool's result: what changed in the records around a tool of the agent,
  // the docs after a write, a hint. A nested tool's write gets only the docs.
  pi.on('tool_call', async (event, ctx) => {
    if (!enabled || event.parentToolCallId !== undefined) return
    outside.set(event.toolCallId, await beforeTool(courierOf(ctx)))
  })

  pi.on('tool_result', async (event, ctx) => {
    if (!enabled) return
    const path = (event.toolName === 'edit' || event.toolName === 'write') && !event.isError ? event.input.path : undefined
    const written = typeof path === 'string' ? resolve(ctx.cwd, path) : undefined
    if (event.parentToolCallId !== undefined) {
      if (written !== undefined) await afterWrite(courierOf(ctx), written)
      return
    }
    const before = outside.get(event.toolCallId) ?? []
    outside.delete(event.toolCallId)
    const added = await afterTool(courierOf(ctx), before, { own: OURS.has(event.toolName), readOnly: READING.has(event.toolName), written })
    if (added.length === 0) return

    return {
      content: [...event.content, ...added.map(each => ({ type: 'text' as const, text: each }))],
      structuredContent: event.structuredContent,
    }
  })

  // A call blocked before it ran has no result: it ends here, so the tools after it still know what runs.
  pi.on('tool_execution_end', async (event, ctx) => {
    if (!enabled || !outside.has(event.toolCallId)) return
    outside.delete(event.toolCallId)
    await afterTool(courierOf(ctx), [], null)
  })

  // pi's own let-go at its threshold would go without the letter's Hold: an accepted shift lets go once the run settles.
  pi.on('session_before_compact', async event => {
    if (enabled && loop.pending !== null && event.reason === 'threshold') return { cancel: true }
  })

  // The shift lets go once the run has settled: compacting aborts whatever runs, so never from inside the turn.
  pi.on('agent_settled', async (event, ctx) => {
    if (loop.pending === null) return
    await afterTurn(await projectAt(ctx.cwd), loopOf(ctx), letGoOf(ctx), event.aborted)
  })

  // Any compaction starts a new stretch; one the agent did not ask for is told to it at its next look.
  pi.on('session_compact', event => {
    gauge = letGoGauge(event.reason !== 'manual')
  })

  // The notes to the agent over the extension's runtime: the looks at the records, the loop and the gauge.
  function courierOf(ctx: ExtensionContext, project: () => Promise<Project> = () => projectAt(ctx.cwd)): Courier {
    return {
      loop: loopOf(ctx),
      gauge: keeperOf(ctx, project),
      project,
      looks: async () => looks,
      updateLooks: async change => {
        looks = change(looks)
      },
    }
  }

  // The loop's state in the extension's runtime; a wait note also in a session entry, so it survives a reload.
  function loopOf(ctx: ExtensionContext): Loop {
    return {
      read: async () => loop,
      update: async change => {
        const before = loop
        loop = change(loop)
        if (loop.note !== before.note) pi.appendEntry(WAIT_ENTRY, { note: loop.note })
      },
      tell: (row, level) => tell(ctx, row, level),
    }
  }

  // pi compacts with callbacks; the next turn starts from a custom message.
  function letGoOf(ctx: ExtensionContext): LetGoHarness {
    return {
      fill: async () => ctx.getContextUsage()?.tokens ?? undefined,
      letGo: instructions =>
        new Promise<Awaited<ReturnType<LetGoHarness['letGo']>>>(done => {
          ctx.compact({
            customInstructions: instructions,
            onError: error => done({ skip: error.message }),
            onComplete: (result: CompactionResult) =>
              done({
                messages: [{ role: 'digest', text: result.summary }],
                before: result.tokensBefore ?? undefined,
                after: result.estimatedTokensAfter ?? undefined,
              }),
          })
        }).catch((error: unknown) => ({ skip: `did not start: ${String(error)}` })),
      continueWith: async prompt => {
        pi.sendMessage({ customType: MOD, content: prompt, display: true }, { triggerTurn: true })
      },
    }
  }

  // The gauge in the extension's runtime; the history and the base read from the session. pi compacts by itself once
  // the free room falls under `reserveTokens`.
  function keeperOf(ctx: ExtensionContext, project: () => Promise<Project>): GaugeKeeper {
    return {
      read: async () => gauge,
      update: async change => {
        gauge = change(gauge)
      },
      history: async () => {
        let counted = FRESH_GAUGE
        for (const message of ctx.sessionManager.buildSessionProjection().messages) {
          const source = growthSource(message)
          if (source !== null) counted = addGrowth(counted, source, messageChars(message))
        }

        return counted.growth
      },
      base: async () => shiftBase(await project(), ctx.sessionManager.getSessionId()),
      reading: async () => {
        const usage = ctx.getContextUsage()
        const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0
        const settings = SettingsManager.create(ctx.cwd).getCompactionSettings(ctx.model)

        return { tokens: usage?.tokens ?? undefined, window, threshold: settings.enabled ? window - settings.reserveTokens : undefined }
      },
    }
  }
}

// The wait note of the branch the session stands on: its last wait entry, written whenever the note changes. A note
// cleared by a message rewound off this branch still waits on it: every clearing is followed by the mod's message.
function branchNote(ctx: ExtensionContext): WaitNote | null {
  let followed = false
  for (const entry of ctx.sessionManager.getBranch().toReversed()) {
    if (entry.type === 'custom_message' && entry.customType === MOD) followed = true
    if (entry.type !== 'custom' || entry.customType !== WAIT_ENTRY) continue
    const note = (entry.data as { note: WaitNote | null } | undefined)?.note ?? null
    if (note !== null || followed) return note
  }

  return null
}

// What a let-go summarizes: the conversation, not the system prompt pi records as a message of its own.
function summarized(entry: SessionEntry): boolean {
  return entry.type === 'message' ? entry.message.role !== 'system' : entry.type === 'custom_message' || entry.type === 'branch_summary'
}

// pi lets go only of the messages before the cut it finds by keepRecentTokens, counted from the last let-go; with none
// there — a history no bigger, the cut on its first message — it refuses as "session too small". The same cut is
// found here, before the shift is accepted.
function cannotLetGo(ctx: ExtensionContext): string | null {
  const keep = SettingsManager.create(ctx.cwd).getCompactionSettings(ctx.model).keepRecentTokens
  const branch = ctx.sessionManager.getBranch()
  const last = branch.findLastIndex(entry => entry.type === 'compaction')
  const kept = last === -1 ? -1 : branch.findIndex(entry => entry.id === (branch[last] as CompactionEntry).firstKeptEntryId)
  const start = kept === -1 ? Math.max(0, last + 1) : kept
  const cut = findCutPoint(branch, start, branch.length, keep)
  if (branch.slice(start, cut.firstKeptEntryIndex).some(summarized)) return null
  const since = branch.slice(start).reduce((sum, entry) => sum + (entry.type === 'message' ? estimateTokens(entry.message) : 0), 0)

  return `the history since the last let-go is about ${formatK(since)} tokens, and pi keeps its last ${formatK(keep)} whole, so it has nothing to let go.`
}

// A row for the owner; a context gone stale with its session has no one to tell.
function tell(ctx: ExtensionContext, row: string, kind: 'info' | 'warning' | 'error'): void {
  try {
    ctx.ui.notify(row, kind)
  } catch {
    // The row is in about.md all the same.
  }
}

// Who a message came from, as the hint names it; digests of earlier history and a shell output the owner kept out of
// the context are not counted.
function growthSource(message: { role: string; toolName?: string; excludeFromContext?: boolean }): string | null {
  if (message.excludeFromContext === true) return null
  if (message.role === 'assistant') return SOURCES.responses
  if (message.role === 'user' || message.role === 'bashExecution') return SOURCES.owner
  if (message.role === 'toolResult') return message.toolName ?? SOURCES.tools
  if (message.role === 'compactionSummary' || message.role === 'branchSummary') return null

  return SOURCES.attachments
}

// A shell command the owner ran has its command and output instead of content; a change of the system prompt carries
// its text in sections.
function messageChars(message: object): number {
  const sections =
    'sections' in message && typeof message.sections === 'object' && message.sections !== null
      ? Object.values(message.sections).reduce((sum: number, text) => sum + (typeof text === 'string' ? text.length : 0), 0)
      : 0
  if ('content' in message) return contentChars(message.content) + sections
  if ('output' in message && typeof message.output === 'string') return message.output.length

  return sections
}
