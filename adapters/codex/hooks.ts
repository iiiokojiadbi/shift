import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import {
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
import { type MapPrints, observeMap } from './map'
import { type Fields, fields } from './protocol'

type ContextReceipt = { offset: number; length: number; hash: string }
const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex')

type HookState = {
  root: string
  looks: Looks
  editOffset?: number
  context?: ContextReceipt
  doctrineHash?: string
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

async function contextFor(input: Fields, project: Project, state: HookState) {
  const problem = project.problem
  const event = input.hook_event_name
  const edits = await recentEdits(project, input, state.editOffset)
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
    state.turn = input.turn_id
    state.looks.running = 0
  }
  // A steer can submit another prompt while this turn's tool is still writing.
  if (event === 'UserPromptSubmit' && sameTurn && state.looks.running > 0) return []
  if (state.looks.running === 0 || event === 'PostToolUse') state.editOffset = edits.offset
  if (event === 'PreToolUse' || event === 'PostToolUse') {
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
    return notes.map(wrap)
  }
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
  const records = await promptRecords(courier, true)
  const recordNotes = records.notes.map(wrap)
  await records.delivered()
  const alreadyReported = problem && (state.reportedProblem === problem || recordNotes.some(note => note.includes(problem)))
  const notes = changedWarnings.filter(row => fresh || !problem || !alreadyReported || !row.includes(problem))
  state.reportedProblem = problem
  const files = await sessionFiles(project, { refresh: false })
  const changes = observeMap(project, state.map, files)
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
  notes.push(...recordNotes)
  return notes
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

// Hook processes for one thread can overlap. A SQLite writer transaction covers the observation,
// the decision to deliver and its checkpoint. The OS releases the lock if the hook is killed.
export async function runHook(input: Fields, dir: string, file: string) {
  const project = await projectAt(String(input.cwd))
  // The terminal reserves single-slash names. A double slash arrives as ordinary user input.
  const prompt = input.hook_event_name === 'UserPromptSubmit' && typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const match = /^\/\/?([^/\s]+)(?=\s|$)/.exec(prompt)
  const command = match?.[1]
  if (!project.settings.enabled && [SHIFT_COMMAND, RESUME_COMMAND, SIZES_TOOL, TASKS_COMMAND].some(name => name === command))
    return { continue: false, stopReason: 'Shift is disabled in this project.' }
  if (command === SIZES_TOOL || command === TASKS_COMMAND) {
    // Stop before observing a turn, so a display-only command cannot consume a pending note or hint.
    let report: string
    try {
      if (match?.[0] !== prompt) report = `Usage: //${command}`
      else report = command === SIZES_TOOL ? await sizeReport(project) : await tasksView(project)
    } catch (error) {
      report = `Could not display //${command}: ${String(error)}`
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
    const notes = project.settings.enabled ? await contextFor(input, project, state) : []
    if (command === SHIFT_COMMAND) notes.push(SHIFT_NOW(''))
    if (command === RESUME_COMMAND) {
      const last = await resumeShift(project)
      notes.push(last.prompt ?? `<shift note="from the owner's /unshift">${last.text}</shift>`)
    }
    if (project.settings.enabled && input.hook_event_name !== 'PreToolUse' && typeof input.transcript_path === 'string') {
      const hint = await sample(state.usage, input.transcript_path, input.source === 'compact')
      if (hint) notes.push(wrap({ kind: 'hint', body: hint }))
    }
    db.query('INSERT OR REPLACE INTO checkpoint VALUES (1, ?)').run(JSON.stringify(state))
    db.exec('COMMIT')
    const context = notes.filter(Boolean).join('\n\n')
    return context ? { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: context } } : {}
  } finally {
    db.close()
  }
}
