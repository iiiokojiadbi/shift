import { resolve } from 'node:path'
import type { CompactionResult, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'
import type { Gauge, PendingShift, Reading, WaitNote } from './core/index'
import {
  ARCHIVE_DESCRIPTION,
  ARCHIVE_SCHEMA,
  ARCHIVE_TOOL,
  acceptShift,
  addGrowth,
  afterWrite,
  archiveTask,
  compactInstructions,
  contentChars,
  DIR,
  DOCTRINE_BODY,
  docOutline,
  docsMentioning,
  EXCLUDED,
  FRESH_GAUGE,
  GUIDE,
  GUIDE_DESCRIPTION,
  GUIDE_SCHEMA,
  GUIDE_TOOL,
  HINTED,
  HISTORY_DESCRIPTION,
  HISTORY_SCHEMA,
  HISTORY_TOOL,
  hintBlock,
  keepRecordsOut,
  MENTIONS_DESCRIPTION,
  MENTIONS_SCHEMA,
  MENTIONS_TOOL,
  MOD,
  OUTLINE_DESCRIPTION,
  OUTLINE_SCHEMA,
  OUTLINE_TOOL,
  parseArchiveInput,
  parseHistoryCount,
  parsePath,
  parseShiftInput,
  parseTrackInput,
  RESUME_COMMAND,
  readSettings,
  renderStatus,
  resumeShift,
  SETTINGS,
  SETUP_DESCRIPTION,
  SETUP_SCHEMA,
  SETUP_TOOL,
  SOURCES,
  STATUS_DESCRIPTION,
  STATUS_SCHEMA,
  STATUS_TOOL,
  sessionFiles,
  settleShift,
  setupReport,
  shiftBase,
  shiftHint,
  shiftHistory,
  shiftNotMade,
  staleLayout,
  TOOL,
  TOOL_DESCRIPTION,
  TOOL_SCHEMA,
  TRACK_DESCRIPTION,
  TRACK_SCHEMA,
  TRACK_TOOL,
  updateTrack,
} from './core/index'
import { nodeStore } from './store'

const DOCS_TOOLS: ReadonlySet<string> = new Set([OUTLINE_TOOL, MENTIONS_TOOL])
const TOOLS: ReadonlySet<string> = new Set([
  TOOL,
  GUIDE_TOOL,
  HISTORY_TOOL,
  ARCHIVE_TOOL,
  TRACK_TOOL,
  STATUS_TOOL,
  SETUP_TOOL,
  ...DOCS_TOOLS,
])

// The custom entry that keeps a wait note across a reload: the extension's own state lives only as long as its runtime.
const WAIT_ENTRY = `${MOD}:wait`

export default function shift(pi: ExtensionAPI): void {
  let pending: PendingShift | null = null
  let waitNote: WaitNote | null = null
  let streak = 0
  let gauge: Gauge = FRESH_GAUGE
  // Set by the owner's own input, consumed by the run it starts.
  let ownerTyped = false
  // false when the project's settings turn the mod off; read at each session start.
  let enabled = true

  const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }], details: undefined })
  const schema = (shape: object) => shape as TSchema

  pi.registerTool({
    name: TOOL,
    label: 'Shift',
    description: TOOL_DESCRIPTION,
    parameters: schema(TOOL_SCHEMA),
    executionMode: 'sequential',
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (pending !== null) throw new Error('The shift is already accepted: end the turn with one line.')
      const parsed = parseShiftInput(params as Record<string, unknown>)
      if (typeof parsed === 'string') throw new Error(parsed)
      const call = { root: ctx.cwd, input: parsed, at: Date.now(), sessionId: ctx.sessionManager.getSessionId() }
      const accepted = await acceptShift(nodeStore, call)
      if ('deny' in accepted) throw new Error(accepted.deny)
      pending = accepted.shift

      return text(accepted.result)
    },
  })

  pi.registerTool({
    name: ARCHIVE_TOOL,
    label: 'Archive a task',
    description: ARCHIVE_DESCRIPTION,
    parameters: schema(ARCHIVE_SCHEMA),
    executionMode: 'sequential',
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const parsed = parseArchiveInput(params as Record<string, unknown>)
      if (typeof parsed === 'string') throw new Error(parsed)
      const archived = await archiveTask(nodeStore, ctx.cwd, parsed)
      if ('deny' in archived) throw new Error(archived.deny)

      return text(archived.result)
    },
  })

  pi.registerTool({
    name: TRACK_TOOL,
    label: 'Task status',
    description: TRACK_DESCRIPTION,
    parameters: schema(TRACK_SCHEMA),
    executionMode: 'sequential',
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const parsed = parseTrackInput(params as Record<string, unknown>)
      if (typeof parsed === 'string') throw new Error(parsed)
      const done = await updateTrack(nodeStore, ctx.cwd, parsed)
      if ('deny' in done) throw new Error(done.deny)

      return text(done.result)
    },
  })

  pi.registerTool({
    name: GUIDE_TOOL,
    label: 'Shift guide',
    description: GUIDE_DESCRIPTION,
    parameters: schema(GUIDE_SCHEMA),
    execute: async () => text(GUIDE),
  })

  pi.registerTool({
    name: HISTORY_TOOL,
    label: 'Shift history',
    description: HISTORY_DESCRIPTION,
    parameters: schema(HISTORY_SCHEMA),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const count = parseHistoryCount(params as Record<string, unknown>)
      if (typeof count === 'string') throw new Error(count)

      return text(await shiftHistory(nodeStore, ctx.cwd, count))
    },
  })

  pi.registerTool({
    name: STATUS_TOOL,
    label: 'Shift status',
    description: STATUS_DESCRIPTION,
    parameters: schema(STATUS_SCHEMA),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      await restore(ctx)

      return text(renderStatus(gauge, reading(ctx)))
    },
  })

  // pi reads the session's files anew before every run, so its copy is never older than them.
  pi.registerTool({
    name: SETUP_TOOL,
    label: 'Shift setup',
    description: SETUP_DESCRIPTION,
    parameters: schema(SETUP_SCHEMA),
    execute: async (_id, _params, _signal, _onUpdate, ctx) => text(await setupReport(nodeStore, ctx.cwd, null)),
  })

  pi.registerTool({
    name: OUTLINE_TOOL,
    label: 'Document outline',
    description: OUTLINE_DESCRIPTION,
    parameters: schema(OUTLINE_SCHEMA),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const path = parsePath(params as Record<string, unknown>, 'path')
      if (path === null) throw new Error("path is the document, from the project's root.")

      return text(await docOutline(nodeStore, ctx.cwd, path))
    },
  })

  pi.registerTool({
    name: MENTIONS_TOOL,
    label: 'Documents mentioning a file',
    description: MENTIONS_DESCRIPTION,
    parameters: schema(MENTIONS_SCHEMA),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const file = parsePath(params as Record<string, unknown>, 'file')
      if (file === null) throw new Error('file is the file whose name to look for.')

      return text(await docsMentioning(nodeStore, ctx.cwd, file))
    },
  })

  pi.registerCommand(RESUME_COMMAND, {
    description: 'Pick up the work from the last shift: the letter, the board and the tasks in progress go to the agent',
    // The owner's words typed with the command go after the letter, as their own message that starts the turn.
    handler: async (args, ctx) => {
      if (!enabled) return ctx.ui.notify(`${MOD} is off in this project: ${SETTINGS} has enabled = false.`, 'info')
      const resumed = await resumeShift(nodeStore, ctx.cwd)
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
    const { settings, problem } = await readSettings(nodeStore, ctx.cwd)
    enabled = settings.enabled
    if (problem !== null) tell(ctx, `${MOD}: ${problem} The mod stays on.`, 'warning')
    if (!enabled) {
      pi.setActiveTools(pi.getActiveTools().filter(name => !TOOLS.has(name)))
      return
    }
    // The docs tools only where the mod keeps docs.
    if (settings.docs.dirs.length === 0) pi.setActiveTools(pi.getActiveTools().filter(name => !DOCS_TOOLS.has(name)))
    const stale = await staleLayout(nodeStore, ctx.cwd)
    if (stale !== null) tell(ctx, `${MOD}: ${stale}`, 'warning')
    // Records written before the first shift stay out of a commit too.
    if (await nodeStore.exists(`${ctx.cwd}/${DIR}`)) {
      const kept = await keepRecordsOut(nodeStore, ctx.cwd, settings)
      if ('excluded' in kept && kept.excluded !== null) tell(ctx, EXCLUDED(kept.excluded), 'info')
    }
    const last = ctx.sessionManager
      .getBranch()
      .filter(entry => entry.type === 'custom' && entry.customType === WAIT_ENTRY)
      .at(-1)
    waitNote = last?.type === 'custom' ? ((last.data as { note: WaitNote | null } | undefined)?.note ?? null) : null
  })

  pi.on('input', event => {
    if (enabled && event.source !== 'extension') ownerTyped = true
  })

  // The doctrine every run; between turns a hint, and after a wait the letter, follow the owner's message.
  pi.on('before_agent_start', async (event, ctx) => {
    if (!enabled) return
    event.systemPromptOptions.sections[MOD] = DOCTRINE_BODY
    // SHIFT.md, OWNER.md, GLOSSARY.md and TASKS.md go where pi puts AGENTS.md; the same paths are replaced, not added twice.
    const loaded = await sessionFiles(nodeStore, ctx.cwd)
    const ours = new Set(loaded.map(file => file.path))
    event.systemPromptOptions.contextFiles = [
      ...event.systemPromptOptions.contextFiles.filter(file => !ours.has(file.path)),
      ...loaded.map(file => ({ path: file.path, content: file.text })),
    ]
    const parts: string[] = []
    const hint = await takeHint(ctx)
    if (hint !== null) parts.push(hintBlock(hint))
    if (event.messageType === 'user' && ownerTyped) {
      ownerTyped = false
      streak = 0
      if (waitNote !== null) {
        parts.push(waitNote.context)
        ctx.ui.notify(`went with your message: ${waitNote.files.join(', ')} — ${waitNote.dir}/letter.md`, 'info')
        waitNote = null
        pi.appendEntry(WAIT_ENTRY, { note: null })
      }
    }
    if (parts.length === 0) return

    return { message: { customType: MOD, content: parts.join('\n\n'), display: true } }
  })

  // Every message of the history is counted by source.
  pi.on('message_end', async (event, ctx) => {
    if (!enabled) return
    await restore(ctx)
    const source = growthSource(event.message)
    if (source !== null) gauge = addGrowth(gauge, source, messageChars(event.message))
  })

  // A hint rides inside a tool result: mid-turn, at the agent's next look, with no message of its own.
  // After the agent writes a file the docs follow it: the toc and the map, and remarks in the result, once.
  pi.on('tool_result', async (event, ctx) => {
    if (!enabled) return
    const written = (event.toolName === 'edit' || event.toolName === 'write') && !event.isError ? event.input.path : undefined
    const note = typeof written === 'string' ? await afterWrite(nodeStore, ctx.cwd, resolve(ctx.cwd, written)) : null
    const hint = event.parentToolCallId === undefined ? await takeHint(ctx) : null
    const added = [note, hint === null ? null : hintBlock(hint)].filter((each): each is string => each !== null)
    if (added.length === 0) return

    return {
      content: [...event.content, ...added.map(each => ({ type: 'text' as const, text: each }))],
      structuredContent: event.structuredContent,
    }
  })

  // The shift lets go once the run has settled: compacting aborts whatever runs, so never from inside the turn.
  pi.on('agent_settled', (event, ctx) => {
    const shift = pending
    if (shift === null) return
    pending = null
    if (event.aborted) {
      void shiftNotMade(nodeStore, shift, 'the turn was aborted', ctx.getContextUsage()?.tokens ?? undefined).then(row =>
        ctx.ui.notify(row, 'warning'),
      )
      return
    }
    handOver(shift, ctx)
  })

  // Any compaction starts a new stretch; one the agent did not ask for is told to it at its next look.
  pi.on('session_compact', event => {
    gauge = { ...FRESH_GAUGE, unassisted: event.reason !== 'manual', whole: true }
  })

  // A failure is written to the shift's about.md and told to the owner; the history stays as it was.
  function handOver(shift: PendingShift, ctx: ExtensionContext): void {
    let tokensBefore: number | undefined
    const failed = (why: string) => void shiftNotMade(nodeStore, shift, why, tokensBefore).then(row => tell(ctx, row, 'error'))
    try {
      tokensBefore = ctx.getContextUsage()?.tokens ?? undefined
      ctx.compact({
        customInstructions: compactInstructions(shift.hold, shift.board, `${shift.dir}/letter.md`),
        onError: error => failed(`compaction failed: ${error.message}`),
        onComplete: result =>
          void settle(shift, ctx, result, tokensBefore).catch((error: unknown) => failed(`after the let-go: ${String(error)}`)),
      })
    } catch (error) {
      failed(`compaction did not start: ${String(error)}`)
    }
  }

  async function settle(shift: PendingShift, ctx: ExtensionContext, result: CompactionResult, tokensBefore: number | undefined) {
    const settled = await settleShift(nodeStore, {
      root: ctx.cwd,
      shift,
      messages: [{ role: 'digest', text: result.summary }],
      before: result.tokensBefore ?? tokensBefore,
      after: result.estimatedTokensAfter ?? 0,
      streak,
    })
    tell(ctx, settled.row, 'info')
    if (settled.after === 'continue') {
      streak = settled.streak
      pi.sendMessage({ customType: MOD, content: settled.prompt, display: true }, { triggerTurn: true })
      return
    }
    waitNote = settled.note
    pi.appendEntry(WAIT_ENTRY, { note: settled.note })
  }

  // A hint for the agent if the fill since the last shift calls for one; none while a shift is pending.
  async function takeHint(ctx: ExtensionContext): Promise<string | null> {
    if (pending !== null) return null
    await restore(ctx)
    const hint = shiftHint(gauge, reading(ctx))
    gauge = hint.gauge
    if (hint.text !== null) tell(ctx, HINTED(hint.text), 'info')

    return hint.text
  }

  // pi compacts by itself once the free room falls under `reserveTokens`.
  function reading(ctx: ExtensionContext): Reading {
    const usage = ctx.getContextUsage()
    const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0
    const settings = SettingsManager.create(ctx.cwd).getCompactionSettings(ctx.model)

    return {
      tokens: usage?.tokens ?? undefined,
      window,
      threshold: settings.enabled ? window - settings.reserveTokens : undefined,
    }
  }

  // A fresh runtime (a restart, a reload, a resumed session) starts with none of the stretch counted: the base comes back
  // from the last shift of this session, the growth from the history as it is. Once; a compaction marks the count whole itself.
  async function restore(ctx: ExtensionContext): Promise<void> {
    if (gauge.whole) return
    const base = await shiftBase(nodeStore, ctx.cwd, ctx.sessionManager.getSessionId())
    if (gauge.whole) return
    const counted = ctx.sessionManager.buildSessionProjection().messages.reduce((sum, message) => {
      const source = growthSource(message)
      return source === null ? sum : addGrowth(sum, source, messageChars(message))
    }, FRESH_GAUGE)
    const merged = Object.entries(gauge.growth).reduce((sum, [source, chars]) => addGrowth(sum, source, chars), counted)
    gauge = { ...gauge, growth: merged.growth, base: gauge.base ?? base, whole: true }
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
