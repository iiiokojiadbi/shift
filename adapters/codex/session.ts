import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import {
  acknowledgeWait,
  afterTool,
  afterTurn,
  afterWrite,
  atPrompt,
  beforeTool,
  type Courier,
  countGrowth,
  docStamps,
  dropWaiting,
  FAILURE_NOTE,
  FRESH_GAUGE,
  FRESH_LOOKS,
  FRESH_LOOP,
  type Gauge,
  gaugeStatus,
  isSaved,
  type Looks,
  type Loop,
  type LoopState,
  letGoGauge,
  type Note,
  type Project,
  type Reading,
  readingPath,
  renderSessionFiles,
  resumeShift,
  SOURCES,
  sessionDoctrine,
  sessionFiles,
  shiftBase,
  shownTools,
  startSession,
  TASKS_DESCRIPTION,
  tasksView,
  waitingNote,
} from '../../core/src'
import { projectAt } from '../npm/store'
import { readOnlyActions, recentEdits } from './edits'
import { usageReading } from './gauge'
import { prepareHandover, readHandover, readyHandover, wakeInput, withSessionDb } from './handover'
import { type MapPrints, mapAtTool, observeMap } from './map'
import { deferred, type Fields, fields, type Request, shiftContext, textInput } from './protocol'

export const namespace = 'shift'
const extraTools = [
  { name: 'unshift', description: 'Read the latest shift and resume from its letter.' },
  { name: 'shift_tasks', description: TASKS_DESCRIPTION },
]

export function toolSpec(project: Project) {
  const tools = shownTools(project.settings).map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema,
  }))
  for (const tool of extraTools) tools.push({ ...tool, type: 'function', inputSchema: { type: 'object', properties: {} } })
  return { type: 'namespace', name: namespace, description: 'The project work records and the shift.', tools }
}

// Read only the stretch appended since the request. Some histories expose an opaque checkpoint.
async function digest(path: string | undefined, start: number | undefined) {
  if (!path || start === undefined) return []
  let text = ''
  const stream = createReadStream(path, { start, encoding: 'utf8' })
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      const row = JSON.parse(line)
      if (row.type === 'compacted' && typeof row.payload?.message === 'string') text = row.payload.message
    }
  } catch {
    // A rotated or partially flushed history may not expose the digest.
  } finally {
    stream.destroy()
  }
  return text ? [{ role: 'digest', text }] : []
}

export class Session {
  private loopState: LoopState = { ...FRESH_LOOP }
  private gauge: Gauge = { ...FRESH_GAUGE }
  private reading: Reading = { tokens: undefined, window: 0, threshold: undefined }
  private looks: Looks = { ...FRESH_LOOKS }
  private prints?: MapPrints
  private mapOffset?: number
  private loaded: string | null = null
  private command: import('../../core/src/beads').TaskCommandPath | null = null
  private settingsStarted = false
  private prepared = false
  private enabled = false
  private observation = Promise.resolve()
  private readonly shells = new Set<string>()
  private readonly startedTools = new Map<string, Note[]>()
  private activeTurn?: string
  private turnEnd = deferred<void>()
  private replay: Promise<unknown> = Promise.resolve()
  private toolsDone: Promise<unknown> = Promise.resolve()
  private acceptingTurn?: string
  private barrier?: ReturnType<typeof deferred<void>>
  private queued = 0
  private transition?: { done: ReturnType<typeof deferred<void>>; turn?: string; completedItem: boolean }
  private readonly loop: Loop
  private readonly courier: Courier

  constructor(
    readonly id: string,
    readonly root: string,
    private readonly path: string | undefined,
    private readonly request: Request,
    private readonly tell: (text: string) => void,
    private readonly hookFile?: string,
  ) {
    this.loop = {
      read: async () => this.loopState,
      update: async change => {
        this.loopState = change(this.loopState)
      },
      tell,
    }
    this.courier = {
      loop: this.loop,
      project: () => projectAt(root, id),
      looks: async () => this.looks,
      updateLooks: async change => {
        this.looks = change(this.looks)
      },
      gauge: {
        read: async () => this.gauge,
        update: async change => {
          this.gauge = change(this.gauge)
        },
        history: async () => ({}),
        base: async () => shiftBase(await projectAt(root, id), id),
        reading: async () => ({ ...this.reading, softHints: (await projectAt(root, id)).settings.hints.soft }),
      },
    }
  }

  async prompt(params: Fields, owner: boolean) {
    if (this.hookFile) {
      const letter = owner ? await waitingNote(this.loop) : null
      if (!letter) return { params, delivered: async () => {} }
      return {
        params: {
          ...params,
          additionalContext: { ...fields(params.additionalContext), shift: { kind: 'untrusted', value: letter.context } },
        },
        delivered: letter.delivered,
      }
    }
    await this.observation
    const project = await projectAt(this.root, this.id, undefined, this.settingsStarted ? undefined : 'start')
    this.settingsStarted = true
    this.enabled = project.settings.enabled
    if (!project.settings.enabled) return { params, delivered: async () => {} }
    const first = !this.prepared
    let initialFiles: Awaited<ReturnType<typeof sessionFiles>> | undefined
    if (first) {
      const started = await startSession(project)
      this.command = started.command
      for (const row of started.rows) this.tell(row.text)
      initialFiles = await sessionFiles(project)
      this.looks.docs = await docStamps(project)
    }
    const notes = await atPrompt(this.courier, { runStarts: true, owner })
    const files = initialFiles ?? (await sessionFiles(project, { refresh: false }))
    const block = renderSessionFiles(files)
    const edits = await recentEdits(project, { session_id: this.id, transcript_path: this.path }, this.mapOffset)
    const changes = await observeMap(project, first ? undefined : this.prints, files, this.looks.docs ?? {}, edits.confirmed)
    const parts = [
      first ? sessionDoctrine(project.settings, this.command).doctrine : '',
      first ? block : changes.note,
      ...notes.notes,
    ].filter(Boolean)
    return {
      params: parts.length
        ? { ...params, additionalContext: { ...fields(params.additionalContext), shift: { kind: 'untrusted', value: parts.join('\n\n') } } }
        : params,
      delivered: async () => {
        await notes.delivered()
        this.prepared = true
        this.loaded = block
        this.prints = changes.prints
        this.mapOffset = edits.offset
      },
    }
  }

  // Hold the original request, including its attachments and settings, until the shift has settled.
  async ownerRequest(method: string, params: Fields) {
    const barrier = this.barrier
    if (!barrier) return method === 'turn/steer' ? this.request(method, params) : this.startOwner(params)
    this.queued++
    const replay = this.replay.then(async () => {
      await barrier.promise
      if (method === 'turn/steer' && this.activeTurn) {
        return this.request(method, { ...params, expectedTurnId: this.activeTurn })
      }
      if (this.activeTurn) await this.turnEnd.promise
      const result = await this.startOwner(params)
      return method === 'turn/steer' ? { turnId: fields(result.turn).id } : result
    })
    this.replay = replay.catch(() => {})
    try {
      return await replay
    } finally {
      this.queued--
    }
  }

  async afterShift(method: string, params: Fields) {
    await this.barrier?.promise
    return this.request(method, params)
  }

  private async startOwner(params: Fields) {
    const prepared = await this.prompt(params, true)
    const args = { ...prepared.params }
    delete args.expectedTurnId
    const result = await this.request('turn/start', args)
    await prepared.delivered()
    return result
  }

  tool(name: string, raw: Fields, turn: string) {
    const run = this.toolsDone.then(async () => {
      const project = await projectAt(this.root, this.id)
      if (!project.settings.enabled) throw new Error('Shift is disabled in this project.')
      if (name === 'shift_tasks') return tasksView(project)
      if (name === 'unshift') {
        const last = await resumeShift(project)
        if (last.prompt) await dropWaiting(this.loop, this.hookFile ? undefined : project, last.waiting)
        return last.prompt ?? last.text
      }
      const tool = shownTools(project.settings).find(tool => tool.name === name)
      if (!tool) throw new Error(`Unknown tool: ${name}`)
      const file =
        name === 'shift_read' && typeof raw.path === 'string'
          ? readingPath(raw.path.trim(), project.settings.docs.dirs, project.settings.docs.maxDepth)
          : name === 'doc_outline'
            ? raw.path
            : name === 'shift'
              ? raw.letter
              : undefined
      if (typeof file === 'string' && file) {
        const root = await realpath(this.root)
        const path = resolve(root, file)
        const local = relative(root, await realpath(path).catch(() => path))
        if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error('The file must be inside this project.')
      }
      if (name === 'shift' && !this.barrier) this.barrier = deferred<void>()
      const done = await tool.run(raw, {
        project: async () => project,
        sessionId: async () => this.id,
        now: async () => Date.now(),
        subagent: false,
        loop: this.loop,
        loaded: async () => this.loaded,
        status: () => gaugeStatus(this.courier.gauge),
        cannotLetGo: async () => null,
      })
      if ('deny' in done) throw new Error(done.deny)
      if (name === 'shift') {
        if (this.activeTurn === turn) this.acceptingTurn = turn
        else await this.settle(true)
      }
      return done.result
    })
    this.toolsDone = run.catch(() => {
      if (name === 'shift' && !this.loopState.pending && !this.loopState.letting && !this.transition) {
        this.barrier?.resolve()
        this.barrier = undefined
      }
    })
    return run
  }

  // Observations run in event order, without blocking the RPC reader on a request to that same server.
  private observe(work: () => Promise<void>) {
    this.observation = this.observation.then(work).catch(error => this.tell(String(error)))
  }

  private async checkMap(shellWrite: boolean) {
    if (!this.prints?.documents) return
    const project = await projectAt(this.root, this.id)
    const edits = await recentEdits(project, { session_id: this.id, transcript_path: this.path }, this.mapOffset)
    const update = await mapAtTool(project, this.prints, async () => edits, shellWrite)
    if (update.note) await this.inject(update.note)
    this.prints = update.prints
    this.mapOffset = edits.offset
  }

  private toolEvent(method: string, item: Fields) {
    const kind = String(item.type)
    const id = String(item.id)
    if (!['dynamicToolCall', 'mcpToolCall', 'commandExecution', 'fileChange', 'collabAgentToolCall', 'webSearch'].includes(kind)) return
    if (method === 'item/started') {
      this.observe(async () => {
        if (!this.startedTools.size) await this.checkMap(false)
        if (kind === 'commandExecution') this.shells.add(id)
        this.startedTools.set(id, await beforeTool(this.courier))
      })
    } else if (method === 'item/completed') {
      this.observe(async () => {
        const notes = this.startedTools.get(id)
        if (!notes) return
        this.startedTools.delete(id)
        if (this.shells.delete(id) && (!this.shells.size || !readOnlyActions(item.commandActions)))
          await this.checkMap(!readOnlyActions(item.commandActions))
        if (kind === 'fileChange' && item.status === 'completed' && Array.isArray(item.changes)) {
          for (const change of item.changes) {
            const path = fields(change).path
            if (typeof path === 'string') await afterWrite(this.courier, path)
          }
        }
        const own = item.namespace === namespace
        const output = item.aggregatedOutput ?? item.result ?? item.contentItems
        if (output) await countGrowth(this.courier.gauge, String(item.tool ?? kind), JSON.stringify(output).length)
        const messages = await afterTool(this.courier, notes, { own, readOnly: item.readOnlyHint === true })
        if (messages.length) await this.inject(messages.join('\n\n'))
      })
    }
  }

  event(method: string, params: Fields) {
    if (this.enabled && (method === 'item/started' || method === 'item/completed')) {
      const item = fields(params.item)
      this.toolEvent(method, item)
      if (method === 'item/completed' && (item.type === 'agentMessage' || item.type === 'userMessage')) {
        const source = item.type === 'agentMessage' ? SOURCES.responses : SOURCES.owner
        const chars = typeof item.text === 'string' ? item.text.length : JSON.stringify(item.content ?? []).length
        this.observe(() => countGrowth(this.courier.gauge, source, chars))
      }
    }
    if (method === 'turn/started') {
      this.activeTurn = String(fields(params.turn).id)
      this.turnEnd = deferred<void>()
    }
    if (method === 'turn/completed' && this.activeTurn === fields(params.turn).id) {
      this.activeTurn = undefined
      this.turnEnd.resolve()
    }
    if (method === 'thread/tokenUsage/updated') {
      const usage = fields(params.tokenUsage)
      const tokens = fields(usage.last).totalTokens
      if (typeof tokens === 'number' && typeof usage.modelContextWindow === 'number' && usage.modelContextWindow > 0) {
        const next = usageReading(this.reading, this.gauge, tokens, usage.modelContextWindow)
        this.reading = next.reading
        this.gauge = next.gauge
      }
    }
    const transition = this.transition
    const turn = fields(params.turn)
    if (transition && method === 'turn/started' && transition.turn === undefined) transition.turn = String(turn.id)
    if (method === 'item/completed' && fields(params.item).type === 'contextCompaction') {
      if (transition && (transition.turn === undefined || transition.turn === params.turnId)) {
        transition.turn = String(params.turnId)
        transition.completedItem = true
      } else {
        this.prepared = false
        this.gauge = letGoGauge(true)
        if (this.enabled)
          this.observe(async () => {
            const project = await projectAt(this.root, this.id)
            if (!project.settings.enabled) return
            const files = await sessionFiles(project)
            const block = renderSessionFiles(files)
            this.prints = (await observeMap(project, undefined, files, await docStamps(project))).prints
            this.mapOffset = undefined
            await this.inject([sessionDoctrine(project.settings, this.command).doctrine, block].filter(Boolean).join('\n\n'))
            this.loaded = block
            this.prepared = true
          })
      }
    }
    if (method !== 'turn/completed') return
    if (transition && turn.id === transition.turn) {
      if (transition.completedItem && turn.status === 'completed') transition.done.resolve()
      else transition.done.reject(new Error('The server ended the turn without a completed shift.'))
    }
    if (this.acceptingTurn !== undefined && turn.id === this.acceptingTurn) {
      this.acceptingTurn = undefined
      void this.settle(turn.status !== 'completed').catch(error => this.tell(String(error)))
    }
  }

  private async settle(aborted: boolean) {
    const barrier = this.barrier
    const file = this.hookFile
    const shift = this.loopState.pending
    const receipt = file && shift ? { root: this.root, dir: shift.dir } : undefined
    const phase = () =>
      file && receipt
        ? withSessionDb(file, db => {
            const row = readHandover(db, this.root)
            return row?.dir === receipt.dir ? row.phase : undefined
          })
        : undefined
    try {
      await this.observation
      await afterTurn(
        await projectAt(this.root, this.id),
        this.loop,
        {
          fill: async () => this.reading.tokens,
          // The installed prompt hook owns delivery, including a turn the owner started
          // independently before this MCP client observed the end of the shift.
          confirmsInHistory: !!receipt,
          parkWait: receipt ? async () => {} : undefined,
          letGo: async instructions => {
            await this.inject(instructions)
            const path = this.path ?? fields((await this.request('thread/read', { threadId: this.id })).thread).path
            const history = typeof path === 'string' ? path : undefined
            const start = history
              ? await stat(history).then(
                  s => s.size,
                  () => undefined,
                )
              : undefined
            if (file && receipt) prepareHandover(file, this.root, receipt.dir, start)
            const done = deferred<void>()
            // The completion can precede the RPC acknowledgement.
            void done.promise.catch(() => {})
            this.transition = { done, completedItem: false }
            this.reading = { ...this.reading, tokens: undefined }
            // The request may already have changed history. Only the server can confirm its outcome.
            const timer = setTimeout(() => this.tell('Still waiting for the server to finish the shift.'), 60_000)
            try {
              await Promise.all([this.request('thread/compact/start', { threadId: this.id }), done.promise])
              const messages = await digest(history, start)
              if (file && receipt) withSessionDb(file, db => readyHandover(db, receipt))
              return { messages }
            } catch (error) {
              if (file && receipt)
                withSessionDb(file, db =>
                  db.query("DELETE FROM handover WHERE root = ? AND dir = ? AND phase = 'prepared'").run(this.root, receipt.dir),
                )
              throw error
            } finally {
              clearTimeout(timer)
              this.transition = undefined
            }
          },
          afterLetGo: async () => {
            this.gauge = letGoGauge(false)
            this.prepared = false
          },
          continueWith: async text => {
            if (receipt && phase() && !text.startsWith('<shift note=')) {
              if (phase() === 'ready')
                await this.request('thread/queue/add', {
                  threadId: this.id,
                  clientUserMessageId: crypto.randomUUID(),
                  input: [textInput(wakeInput(receipt.dir, receipt.root))],
                })
              return
            }
            const prepared = await this.prompt({ threadId: this.id, input: [textInput(shiftContext(text))] }, false)
            if (this.queued) {
              await this.inject([fields(fields(prepared.params.additionalContext).shift).value, text].filter(Boolean).join('\n\n'))
            } else await this.request('turn/start', prepared.params)
            await prepared.delivered()
          },
        },
        aborted,
      )
      // Put a waiting letter in the thread itself. It survives a client restart and starts no turn.
      const note = this.loopState.note
      const delivered = phase()
      if (receipt && delivered && isSaved(receipt.dir) && delivered === 'delivered')
        await acknowledgeWait(await projectAt(this.root, this.id), receipt.dir)
      if (receipt && delivered && note?.dir === receipt.dir && !note.files.includes(FAILURE_NOTE)) {
        await dropWaiting(this.loop)
      } else if (note) {
        const prepared = await this.prompt({ threadId: this.id }, true)
        await this.inject(String(fields(fields(prepared.params.additionalContext).shift).value ?? note.context))
        await prepared.delivered()
        if (this.hookFile && isSaved(note.dir)) await acknowledgeWait(await projectAt(this.root, this.id), note.dir)
      }
    } finally {
      this.barrier = undefined
      barrier?.resolve()
    }
  }

  private async inject(text: string) {
    await this.request('thread/inject_items', {
      threadId: this.id,
      items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: shiftContext(text) }] }],
    })
  }

  get shifting() {
    return !!this.barrier
  }

  close() {
    this.turnEnd.resolve()
    this.transition?.done.reject(new Error('The app server disconnected during the shift.'))
    this.barrier?.resolve()
  }
}
