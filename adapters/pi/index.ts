import { resolve } from 'node:path'
import type { CompactionResult, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'
import type { ChangedBy, Gauge, GaugeKeeper, LetGoHarness, Loop, LoopState, Seen, WaitNote } from './core/index'
import {
  addGrowth,
  afterTurn,
  afterWrite,
  changedRecords,
  contentChars,
  countGrowth,
  doctrineBody,
  FRESH_GAUGE,
  FRESH_LOOP,
  gaugeStatus,
  hintBlock,
  holdShift,
  letGoGauge,
  loopHint,
  MOD,
  ownerSpoke,
  RESUME_COMMAND,
  RESUME_DESCRIPTION,
  resumeShift,
  SETTINGS,
  SOURCES,
  sessionFiles,
  shiftBase,
  startSession,
  TOOLS,
  waitingNote,
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
  // The doctrine with the tools this project shows; read at each session start.
  let doctrine = doctrineBody(TOOLS.map(tool => tool.name))
  // The records as last seen, the agent's tools running now, and what changed before each began, by its call.
  let seen: Seen | null = null
  let running = 0
  const outside = new Map<string, string>()

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
          pending: loop.pending !== null,
          // pi reads the session's files anew before every run, so its copy is never older than them.
          loaded: async () => null,
          status: () => gaugeStatus(keeperOf(ctx)),
        })
        if ('deny' in done) throw new Error(done.deny)
        if (done.shift !== undefined) await holdShift(loopOf(ctx), done.shift)

        return text(done.result)
      },
    })
  }

  pi.registerCommand(RESUME_COMMAND, {
    description: RESUME_DESCRIPTION,
    // The owner's words typed with the command go after the letter, as their own message that starts the turn.
    handler: async (args, ctx) => {
      if (!enabled) return ctx.ui.notify(`${MOD} is off in this project: ${SETTINGS} has enabled = false.`, 'info')
      const resumed = await resumeShift(await projectAt(ctx.cwd))
      ctx.ui.notify(resumed.text, 'info')
      if (resumed.prompt === undefined) return
      const words = args.trim()
      pi.sendMessage({ customType: MOD, content: resumed.prompt, display: true }, { triggerTurn: words === '' })
      if (words !== '') pi.sendUserMessage(words)
    },
  })

  // Tools are registered before the project is known, so an off project only takes them out of the active set.
  // A wait note survives a reload: the last wait entry on the branch says whether one is still undelivered.
  pi.on('session_start', async (_event, ctx) => {
    const start = await startSession(await projectAt(ctx.cwd))
    enabled = start.enabled
    doctrine = start.doctrineBody
    for (const row of start.rows) tell(ctx, row.text, row.level)
    const shown = start.tools.map(tool => tool.name)
    pi.setActiveTools([...pi.getActiveTools().filter(name => !OURS.has(name)), ...shown])
    if (!enabled) return
    const last = ctx.sessionManager
      .getBranch()
      .filter(entry => entry.type === 'custom' && entry.customType === WAIT_ENTRY)
      .at(-1)
    loop = { ...loop, note: last?.type === 'custom' ? ((last.data as { note: WaitNote | null } | undefined)?.note ?? null) : null }
  })

  // The owner's own input, idle or typed mid-run, starts the count of shifts without them over; only a message that
  // starts a run takes the waiting letter with it.
  pi.on('input', async (event, ctx) => {
    if (!enabled || event.source === 'extension') return
    await ownerSpoke(loopOf(ctx))
    if (event.streamingBehavior === undefined) ownerTyped = true
  })

  // The doctrine every run; between turns a hint, and after a wait the letter, follow the owner's message.
  pi.on('before_agent_start', async (event, ctx) => {
    if (!enabled) return
    event.systemPromptOptions.sections[MOD] = doctrine
    // SHIFT.md, OWNER.md, GLOSSARY.md and TASKS.md go where pi puts AGENTS.md; the same paths are replaced, not added twice.
    const loaded = await sessionFiles(await projectAt(ctx.cwd))
    const ours = new Set(loaded.map(file => file.path))
    event.systemPromptOptions.contextFiles = [
      ...event.systemPromptOptions.contextFiles.filter(file => !ours.has(file.path)),
      ...loaded.map(file => ({ path: file.path, content: file.text })),
    ]
    const parts: string[] = []
    // Records changed between runs — by the owner's hand or another session — come with the run.
    running = 0
    const changed = await recordsNote(ctx, 'other')
    if (changed !== null) parts.push(changed)
    const hint = await takeHint(ctx)
    if (hint !== null) parts.push(hintBlock(hint))
    if (event.messageType === 'user' && ownerTyped) {
      ownerTyped = false
      const note = await waitingNote(loopOf(ctx))
      if (note !== null) {
        parts.push(note.context)
        await note.delivered()
      }
    }
    if (parts.length === 0) return

    return { message: { customType: MOD, content: parts.join('\n\n'), display: true } }
  })

  // Every message of the history is counted by source.
  pi.on('message_end', async (event, ctx) => {
    if (!enabled) return
    const source = growthSource(event.message)
    if (source !== null) await countGrowth(keeperOf(ctx), source, messageChars(event.message))
  })

  // The records are looked at around every tool of the agent: what changed before it began is someone else's, what
  // changed while it ran is the agent's own. While another tool runs the change before is not looked at — it may be
  // that tool's.
  pi.on('tool_call', async (event, ctx) => {
    if (!enabled || event.parentToolCallId !== undefined) return
    const note = running === 0 ? await recordsNote(ctx, 'other') : null
    running++
    if (note !== null) outside.set(event.toolCallId, note)
  })

  // A hint rides inside a tool result: mid-turn, at the agent's next look, with no message of its own.
  // After the agent writes a file the docs follow it: the toc and the map, and remarks in the result, once. The mod's
  // own tools write the records validly: what they wrote is only remembered.
  pi.on('tool_result', async (event, ctx) => {
    if (!enabled) return
    const written = (event.toolName === 'edit' || event.toolName === 'write') && !event.isError ? event.input.path : undefined
    const note = typeof written === 'string' ? await afterWrite(await projectAt(ctx.cwd), resolve(ctx.cwd, written)) : null
    const nested = event.parentToolCallId !== undefined
    let before: string | null = null
    let own: string | null = null
    if (!nested) {
      running = Math.max(0, running - 1)
      before = outside.get(event.toolCallId) ?? null
      outside.delete(event.toolCallId)
      const looked = READING.has(event.toolName) ? null : await recordsNote(ctx, 'agent')
      own = OURS.has(event.toolName) ? null : looked
    }
    const hint = nested ? null : await takeHint(ctx)
    const added = [before, own, note, hint === null ? null : hintBlock(hint)].filter((each): each is string => each !== null)
    if (added.length === 0) return

    return {
      content: [...event.content, ...added.map(each => ({ type: 'text' as const, text: each }))],
      structuredContent: event.structuredContent,
    }
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

  // A hint for the agent if the fill since the last shift calls for one; none while a shift is pending.
  // The check of the records changed since the mod last looked; the first look only remembers them.
  // A look that fails says nothing: it must never stand between the agent and its tool.
  async function recordsNote(ctx: ExtensionContext, by: ChangedBy): Promise<string | null> {
    try {
      const changed = await changedRecords(await projectAt(ctx.cwd), seen, by)
      seen = changed.seen

      return changed.note
    } catch {
      return null
    }
  }

  function takeHint(ctx: ExtensionContext): Promise<string | null> {
    return loopHint(loopOf(ctx), keeperOf(ctx))
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
  function keeperOf(ctx: ExtensionContext): GaugeKeeper {
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
      base: async () => shiftBase(await projectAt(ctx.cwd), ctx.sessionManager.getSessionId()),
      reading: async () => {
        const usage = ctx.getContextUsage()
        const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0
        const settings = SettingsManager.create(ctx.cwd).getCompactionSettings(ctx.model)

        return { tokens: usage?.tokens ?? undefined, window, threshold: settings.enabled ? window - settings.reserveTokens : undefined }
      },
    }
  }
}

// A row for the owner; a context gone stale with its session has no one to tell.
function tell(ctx: ExtensionContext, row: string, kind: 'info' | 'warning' | 'error'): void {
  try {
    ctx.ui.notify(row, kind)
  } catch {
    // The row is in about.md all the same.
  }
}

// Who a message came from, as the hint names it; digests of earlier history are not counted.
function growthSource(message: { role: string; toolName?: string }): string | null {
  if (message.role === 'assistant') return SOURCES.responses
  if (message.role === 'user' || message.role === 'bashExecution') return SOURCES.owner
  if (message.role === 'toolResult') return message.toolName ?? SOURCES.tools
  if (message.role === 'compactionSummary' || message.role === 'branchSummary') return null

  return SOURCES.attachments
}

// A shell command the owner ran has its command and output instead of content.
function messageChars(message: object): number {
  if ('content' in message) return contentChars(message.content)
  if ('output' in message && typeof message.output === 'string') return message.output.length

  return 0
}
