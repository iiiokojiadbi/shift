import { Database } from 'bun:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import {
  afterToolRecords,
  beforeTool,
  docStamps,
  FRESH_LOOKS,
  type Looks,
  type Project,
  promptRecords,
  type RecordCourier,
  refreshDocs,
  renderSessionFiles,
  sessionFiles,
  staleLayout,
  startSession,
  wrap,
} from '../../core/src'
import { projectAt } from '../npm/store'
import { freshSample, type Sample, sample } from './gauge'
import { type MapPrints, observeMap } from './map'
import type { Fields } from './protocol'

type HookState = {
  root: string
  looks: Looks
  turn?: string
  map?: MapPrints
  docsSettings?: string
  warnings?: string[]
  reportedProblem?: string | null
  usage: Sample
}

async function contextFor(input: Fields, project: Project, state: HookState) {
  const problem = project.problem
  const event = input.hook_event_name
  const courier: RecordCourier = {
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
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    const notes =
      event === 'PreToolUse'
        ? await beforeTool(courier)
        : await afterToolRecords(courier, [], {
            own: typeof input.tool_name === 'string' && input.tool_name.startsWith('mcp__shift__'),
            readOnly: false,
          })
    if (!problem || notes.some(note => note.body.includes(problem))) state.reportedProblem = problem
    return notes.map(wrap)
  }
  const start = await startSession(project)
  const fresh = event === 'SessionStart' || !state.map
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
  if (fresh) notes.unshift(start.doctrine, renderSessionFiles(files) ?? '')
  else notes.push(changes.note)
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
