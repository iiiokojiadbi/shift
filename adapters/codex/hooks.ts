import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import {
  acknowledgeWait,
  afterToolRecords,
  beforeTool,
  docStamps,
  FRESH_LOOKS,
  type Looks,
  type Project,
  promptRecords,
  RESUME_COMMAND,
  type RecordCourier,
  refreshDocs,
  renderSessionFiles,
  resumeShift,
  SHIFT_COMMAND,
  SHIFT_NOW,
  SIZES_TOOL,
  sessionFiles,
  sizeReport,
  staleLayout,
  startSession,
  TASKS_COMMAND,
  TOOLS,
  tasksView,
  wrap,
} from '../../core/src'
import { projectAt } from '../npm/store'
import { recentEdits } from './edits'
import { freshSample, type Sample, sample } from './gauge'
import { type MapPrints, mapAtTool, observeMap } from './map'
import { contextBody, type Fields, fields } from './protocol'

type ContextReceipt = { offset: number; length: number; hash: string }
const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex')

type HookState = {
  root: string
  looks: Looks
  mapOffset?: number
  editOffset?: number
  context?: ContextReceipt
  doctrineHash?: string
  shells?: string[]
  turn?: string
  map?: MapPrints
  docsSettings?: string
  warnings?: string[]
  reportedProblem?: string | null
  usage: Sample
}

// Resume rebuilds model history from the rollout. A checkpoint alone cannot prove the hook output
// made it into that history: the process may have stopped, or the history may have been replaced.
async function retainedContext(path: string, receipt: ContextReceipt, marker: string) {
  const stream = createReadStream(path, { start: receipt.offset, encoding: 'utf8' })
  const escapedMarker = JSON.stringify(marker).slice(1, -1)
  let retained = false
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line.includes(escapedMarker) && !line.includes('"compacted"') && !line.includes('"thread_rolled_back"')) continue
      let row: Fields
      try {
        row = fields(JSON.parse(line))
      } catch {
        continue
      }
      const item = fields(row.payload)
      if (row.type === 'compacted' || (row.type === 'event_msg' && item.type === 'thread_rolled_back')) retained = false
      if (
        row.type === 'response_item' &&
        item.type === 'message' &&
        item.role === 'developer' &&
        Array.isArray(item.content) &&
        item.content.some(part => {
          const text = fields(part).text
          return typeof text === 'string' && text.startsWith(marker) && fingerprint(text.slice(0, receipt.length)) === receipt.hash
        })
      )
        retained = true
    }
    return retained
  } catch {
    return false
  } finally {
    stream.destroy()
  }
}

async function contextFor(input: Fields, project: Project, state: HookState, restoring = false) {
  const problem = project.problem
  const event = input.hook_event_name
  const edits = await recentEdits(project, input, state.editOffset)
  const recordOffset = state.editOffset
  // The map observes a longer interval than record checks, including an entire tool call.
  let nextMapOffset = edits.offset
  async function mapEdits() {
    const found = state.mapOffset === recordOffset ? edits : await recentEdits(project, input, state.mapOffset)
    nextMapOffset = found.offset
    return found
  }
  const courier: RecordCourier = {
    confirmedEdit: edits.confirmed,
    project: async () => project,
    looks: async () => state.looks,
    updateLooks: async change => {
      state.looks = change(state.looks)
    },
  }
  const sameTurn = typeof input.turn_id === 'string' && input.turn_id === state.turn
  if (!sameTurn && typeof input.turn_id === 'string') {
    state.shells = []
    state.turn = input.turn_id
    state.looks.running = 0
  }
  // A steer can submit another prompt while this turn's tool is still writing.
  if (event === 'UserPromptSubmit' && sameTurn && state.looks.running > 0) return { notes: [], waiting: '' }
  if (state.looks.running === 0 || event === 'PostToolUse') state.editOffset = edits.offset
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    let mapNote = ''
    const before = event === 'PreToolUse'
    const shell = input.tool_name === 'Bash' && typeof input.tool_use_id === 'string' ? input.tool_use_id : undefined
    const matched = shell !== undefined && state.shells?.includes(shell)
    if (
      state.map?.documents &&
      ((before && state.looks.running === 0 && !state.shells?.length) ||
        (!before && matched && (!edits.readOnlyShell || state.shells?.length === 1)))
    ) {
      const update = await mapAtTool(project, state.map, mapEdits, !before && !edits.readOnlyShell)
      state.map = update.prints
      mapNote = update.note
      state.mapOffset = nextMapOffset
    }
    if (shell !== undefined) {
      if (before && !matched) state.shells = [...(state.shells ?? []), shell]
      if (!before && matched) state.shells = state.shells?.filter(id => id !== shell)
    }
    const shiftTool = TOOLS.find(tool => input.tool_name === `mcp__shift__${tool.name}`)
    const outside = !!edits.confirmed || state.looks.running === 0 || (shiftTool?.writes === false && state.looks.running === 1)
    const notes =
      event === 'PreToolUse'
        ? await beforeTool(courier)
        : await afterToolRecords(courier, [], {
            own: shiftTool?.writes === true,
            recordSource: outside ? 'other' : 'agent',
            readOnly: false,
          })
    if (!problem || notes.some(note => note.body.includes(problem))) state.reportedProblem = problem
    return { notes: [mapNote, ...notes.map(wrap)], waiting: '' }
  }
  state.shells = []
  const start = await startSession(project)
  const transcript = typeof input.transcript_path === 'string' ? input.transcript_path : undefined
  const resume = event === 'SessionStart' && input.source === 'resume'
  const kept =
    resume &&
    transcript &&
    state.context &&
    (await retainedContext(transcript, state.context, start.doctrine.slice(0, start.doctrine.indexOf('\n'))))
  const fresh = !state.map || (event === 'SessionStart' && !kept)
  const doctrineHash = fingerprint(start.doctrine)
  const warnings = start.rows.map(row => row.text)
  const changedWarnings = warnings.filter(row => fresh || !state.warnings?.includes(row))
  state.warnings = warnings
  // An empty folder has no document stamp; creating or removing it still changes the map.
  const present = await Promise.all(project.settings.docs.dirs.map(path => project.store.exists(`${project.root}/${path}`)))
  const docsSettings = JSON.stringify([project.settings.docs, project.settings.files.shift, present])
  if (fresh) {
    if (!(await staleLayout(project))) await refreshDocs(project)
    state.looks = { ...FRESH_LOOKS, docs: await docStamps(project) }
  } else if (state.docsSettings !== docsSettings) {
    if (!(await staleLayout(project))) await refreshDocs(project, { tocs: false })
  }
  state.docsSettings = docsSettings
  if (event === 'SessionStart') {
    state.looks.migrationChecked = false
    state.looks.refreshClaims = !!kept
  }
  const legacyStamps = state.looks.docs
  if (restoring) state.looks.refreshClaims = false
  const records = await promptRecords(courier, true, event !== 'SessionStart' && !restoring, contextBody(String(input.prompt ?? '')))
  const recordNotes = records.notes.map(wrap)
  const alreadyReported = problem && (state.reportedProblem === problem || recordNotes.some(note => note.includes(problem)))
  const notes = changedWarnings.filter(row => fresh || !problem || !alreadyReported || !row.includes(problem))
  state.reportedProblem = problem
  const files = await sessionFiles(project, { refresh: false, includeClaims: fresh })
  const { confirmed } = await mapEdits()
  state.mapOffset = nextMapOffset
  const changes = await observeMap(project, fresh ? undefined : state.map, files, state.looks.docs ?? {}, confirmed, legacyStamps)
  await records.delivered()
  state.map = changes.prints
  if (fresh) {
    const block = [start.doctrine, renderSessionFiles(files)].filter(Boolean).join('\n\n')
    const offset = transcript
      ? await stat(transcript).then(
          s => s.size,
          () => undefined,
        )
      : undefined
    state.context = offset === undefined ? undefined : { offset, length: block.length, hash: fingerprint(block) }
    notes.unshift(block)
  } else {
    if (state.doctrineHash !== undefined && state.doctrineHash !== doctrineHash) notes.unshift(start.doctrine)
    notes.push(changes.note)
  }
  state.doctrineHash = doctrineHash
  notes.push(...recordNotes, records.recovery)
  return { notes, waiting: records.waiting }
}

function checkpoint(db: Database): HookState | undefined {
  const row = db.query<{ state: string }, []>('SELECT state FROM checkpoint WHERE id = 1').get()
  return row ? JSON.parse(row.state) : undefined
}

// Read the former profile layout until this thread's first hook migrates its gauge.
async function legacyState(file: string): Promise<HookState | undefined> {
  const binding = await readFile(file, 'utf8').catch(() => '')
  if (!binding) return undefined
  const usage = await readFile(`${file}.usage`, 'utf8').catch(() => '')
  return { root: JSON.parse(binding).root, usage: usage ? JSON.parse(usage) : freshSample(), looks: { ...FRESH_LOOKS } }
}

export async function sessionState(file: string) {
  if (!(await Bun.file(`${file}.sqlite`).exists())) return legacyState(file)
  const db = new Database(`${file}.sqlite`, { readonly: true })
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    const ready = db.query("SELECT 1 FROM sqlite_master WHERE name = 'checkpoint'").get()
    return ready ? checkpoint(db) : legacyState(file)
  } finally {
    db.close()
  }
}

const pickerCommands = new Map([
  ['$shift:shift', SHIFT_COMMAND],
  ['$shift:unshift', RESUME_COMMAND],
  ['$shift:sizes', SIZES_TOOL],
  ['$shift:tasks', TASKS_COMMAND],
])

// Hook processes for one thread can overlap. A SQLite writer transaction covers the observation,
// the decision to deliver and its checkpoint. The OS releases the lock if the hook is killed.
export async function runHook(input: Fields, dir: string, file: string) {
  const project = await projectAt(String(input.cwd), typeof input.session_id === 'string' ? input.session_id : undefined)
  const prompt = input.hook_event_name === 'UserPromptSubmit' && typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const token = prompt.split(/\s/, 1)[0] ?? ''
  const command = pickerCommands.get(token) ?? /^\/\/?([^/\s]+)$/.exec(token)?.[1]
  if (!project.settings.enabled && [SHIFT_COMMAND, RESUME_COMMAND, SIZES_TOOL, TASKS_COMMAND].some(name => name === command))
    return { continue: false, stopReason: 'Shift is disabled in this project.' }
  if (command === SIZES_TOOL || command === TASKS_COMMAND) {
    // Stop before observing a turn, so a display-only command cannot consume a pending note or hint.
    let report: string
    try {
      if (token !== prompt) report = `Usage: ${token}`
      else report = command === SIZES_TOOL ? await sizeReport(project) : await tasksView(project)
    } catch (error) {
      report = `Could not display ${token}: ${String(error)}`
    }
    return { continue: false, stopReason: report }
  }
  const tool = input.hook_event_name === 'PreToolUse' || input.hook_event_name === 'PostToolUse'
  if (tool && !project.settings.enabled) return {}
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const db = new Database(`${file}.sqlite`)
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    db.exec('BEGIN IMMEDIATE')
    db.exec('CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY, state TEXT NOT NULL)')
    let state = checkpoint(db) ?? (await legacyState(file))
    if (!state || state.root !== project.root || !project.settings.enabled)
      state = { root: project.root, looks: { ...FRESH_LOOKS }, usage: freshSample() }
    const delivery = project.settings.enabled
      ? await contextFor(input, project, state, command === RESUME_COMMAND)
      : { notes: [], waiting: '' }
    const { notes } = delivery
    let waiting = delivery.waiting
    if (command === SHIFT_COMMAND) notes.push(SHIFT_NOW(''))
    if (command === RESUME_COMMAND) {
      const last = await resumeShift(project)
      if (last.prompt && last.waiting) waiting = last.waiting
      notes.push(last.prompt ?? `<shift note="from the owner's /unshift">${last.text}</shift>`)
    }
    if (project.settings.enabled && input.hook_event_name !== 'PreToolUse' && typeof input.transcript_path === 'string') {
      const hint = await sample(state.usage, input.transcript_path, input.source === 'compact')
      if (hint) notes.push(wrap({ kind: 'hint', body: hint }))
    }
    db.query('INSERT OR REPLACE INTO checkpoint VALUES (1, ?)').run(JSON.stringify(state))
    db.exec('COMMIT')
    const context = notes.filter(Boolean).join('\n\n')
    if (waiting) await acknowledgeWait(project, waiting)
    return context ? { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: context } } : {}
  } finally {
    db.close()
  }
}
