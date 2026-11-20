// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { docPaths } from './docs'
import { BOARD, DIR, KNOWLEDGE, LETTER, SETTINGS, TASK_LIST, TASKS } from './layout'
import { normalize } from './paths'
import type { Project } from './project'
import { legacyExists, readSaved, savedEntries } from './saved'
import { graphTask, taskGuard, taskId } from './taskgraph'
import { parseTaskList } from './tasks'

type Transfer = { recovery?: string; backup: string; confirmed: Record<string, string>; done: boolean; previous: string }

async function transferState(p: Project): Promise<Transfer | null> {
  const path = `${p.root}/${DIR}/migration.json`
  const text = await p.store.read(path)
  if (text === null && !(await p.store.exists(path))) return null
  try {
    const state = JSON.parse(text ?? '')
    if (
      !state ||
      typeof state.backup !== 'string' ||
      typeof state.confirmed !== 'object' ||
      !state.confirmed ||
      typeof state.done !== 'boolean'
    )
      throw new Error()
    return state
  } catch {
    throw new Error('Cannot read .shift/migration.json. Recover the migration record before cleanup. Keep the backup and current records.')
  }
}

export async function migrationReceipt(p: Project, id: string) {
  if (!p.store.beads) return undefined
  let state: Transfer | null
  try {
    state = await transferState(p)
  } catch {
    return undefined
  }
  if (!state || state.done || id <= state.previous) return undefined
  const receipt: unknown = JSON.parse(
    await p.store.beads(p.root, ['shift-migrate'], JSON.stringify({ action: 'receipt', previous: id, generation: state.backup })),
  )
  return typeof receipt === 'string' && /^[a-f0-9]{24}$/.test(receipt) ? receipt : undefined
}

export async function needsMigrationShift(p: Project, previous: string) {
  const state = await transferState(p).catch(() => null)
  return !!state && !state.done && previous <= state.previous
}

async function status(p: Project) {
  const state = await transferState(p)
  const list = await p.store.read(`${p.root}/${TASK_LIST}`)
  const folders = await p.store.list(`${p.root}/${TASKS}`, 'dir')
  const parsed = parseTaskList(list ?? 'none')
  const legacy = await legacyExists(p)
  return { state, legacy, parsed, folders }
}
export async function migrationNote(p: Project) {
  if (!p.store.beads) return null
  const result = await status(p).catch((error: unknown) => String(error))
  if (typeof result === 'string') return result
  const { state, legacy, parsed, folders } = result
  if (state?.done && legacy)
    return 'Legacy records appeared after cleanup. Run shift_migrate with action start to back them up and transfer current work.'
  if (state?.done || (!legacy && !state)) return null
  const names = new Set([...(typeof parsed === 'string' ? [] : parsed.map(t => t.name)), ...folders])
  return [
    'Legacy records need migration. Run shift_migrate with action start. Transfer each current task through the task tools, then confirm its stable ID. Leave earlier shifts and closed tasks in the backup. Make one new shift, restore its letter and run cleanup with its ID and restoration receipt.',
    ...(state?.recovery ? [state.recovery.trim()] : []),
    ...[...names].map(name => `- ${name}: ${state?.confirmed[name] ?? 'transfer pending'}`),
    ...(typeof parsed === 'string' ? [parsed] : []),
  ].join('\n')
}
export async function migrateRecords(p: Project, raw: Record<string, unknown>) {
  const run = p.store.beads
  if (!run) throw new Error('No bundled storage runtime.')
  const { state, legacy, parsed, folders } = await status(p)
  if (state?.done && !legacy) return `Migration already finished. Backup: ${state.backup}.`
  if (!legacy && !state) return 'No legacy records.'
  const action = raw.action
  const req: Record<string, unknown> = { action }
  if (action === 'status') return (await migrationNote(p)) ?? 'No legacy records.'
  if (action === 'start') req.previous = (await savedEntries(p)).at(-1)?.id ?? ''
  else {
    if (state?.done) throw new Error('Legacy records appeared after cleanup. Start their transfer first.')
    if (typeof parsed === 'string') throw new Error(parsed)
    if (!state) throw new Error('Start the transfer first.')
    req.generation = state.backup
    const names = new Set([...parsed.map(t => t.name), ...folders, ...Object.keys(state.confirmed)])
    if (action === 'confirm') {
      const name = String(raw.task ?? '')
      if (!names.has(name)) throw new Error('Choose a current legacy task.')
      const target = await graphTask(p, taskId(raw.target ?? name))
      if (target.status === 'closed') throw new Error('Transfer the current task into an open graph task.')
      if (Object.entries(state.confirmed).some(([n, id]) => n !== name && id === target.id))
        throw new Error('Each legacy task needs its own stable ID.')
      Object.assign(req, { task: name, target: target.id })
    } else if (action === 'cleanup') {
      if (p.problem) throw new Error(`Correct settings.toml before cleanup: ${p.problem}`)
      req.settings = p.settingsText
      const saved = await readSaved(p, String(raw.id ?? ''), 'letter.md')
      if (saved.state !== 'complete' || saved.id <= state.previous)
        throw new Error('Complete and restore a new shift after starting migration.')
      const expected = []
      for (const name of names) {
        const target = state.confirmed[name]
        if (!target) throw new Error(`Transfer and confirm ${name} first.`)
        const task = await graphTask(p, target)
        if (task.status === 'closed' || !task.revision) throw new Error(`Reopen and check ${target} before cleanup.`)
        expected.push(taskGuard(task))
      }
      Object.assign(req, { expected, confirmed: state.confirmed, receipt: raw.receipt, previous: saved.id })
      req.protected = [
        BOARD,
        LETTER,
        SETTINGS,
        KNOWLEDGE,
        ...(await p.store.list(`${p.root}/${KNOWLEDGE}`, 'file')).map(name => `${KNOWLEDGE}/${name}`),
        ...(await docPaths(p.store, p.root, p.settings.docs.dirs)),
        p.settings.files.shift,
        p.settings.files.glossary,
        p.settings.files.owner,
        ...p.settings.files.always,
        ...p.settings.docs.dirs,
      ].map(path => normalize(path) ?? path)
    } else throw new Error('Choose status, start, confirm or cleanup.')
  }
  return String(JSON.parse(await run(p.root, ['shift-migrate'], JSON.stringify(req))))
}
