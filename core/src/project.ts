import { staleLayout } from './flows'
import { SETTINGS } from './layout'
import { DEFAULT_SETTINGS, type ParsedSettings, parseSettings, type Settings, settingsDocument } from './settings'
import type { Store } from './store'
import { WorkingRecords } from './working'

// One project as an operation of the mod sees it: its files and its settings, read once when the operation starts.
// A settings file that does not parse leaves the mod on with the defaults — turning it off by a typo would be silent —
// and its problem is told to the owner at the session's start and refuses a shift until the owner fixes it.
export type Project = {
  actor?: string | undefined
  // Some hosts scope delivery receipts to a branch or a particular accepted shift.
  deliveryKey?: string
  working?: Pick<WorkingRecords, keyof WorkingRecords>
  store: Store
  root: string
  settings: Settings
  // What is wrong with settings.toml; null when it parses or there is none.
  problem: string | null
  // settings.toml as the owner wrote it, null without one: a shift snapshots it.
  settingsText: string | null
  // The keys the file sets itself; the rest are at their defaults.
  set: ReadonlySet<string>
}

export async function loadProject(
  store: Store,
  root: string,
  actor?: string,
  letterSession = actor,
  lifecycle?: 'start',
): Promise<Project> {
  const path = `${root}/${SETTINGS}`
  const source = await store.read(path)
  const project = (text: string | null, parsed: ParsedSettings | string): Project => {
    const problem = typeof parsed === 'string' ? parsed : null
    const p: Project = {
      store,
      root,
      actor,
      settingsText: text,
      problem,
      settings: typeof parsed === 'string' ? DEFAULT_SETTINGS : parsed.settings,
      set: typeof parsed === 'string' ? new Set() : parsed.set,
    }
    if (!problem && store.nativeRecords && p.settings.enabled && !p.settings.commit) {
      p.working = new WorkingRecords(p, store, letterSession ?? '')
      p.store = p.working.store()
    }
    return p
  }
  if (source === null && (await store.exists(path))) return project(null, `Cannot read ${SETTINGS}.`)
  if (!lifecycle) return project(source, parseSettings(source ?? ''))
  const document = settingsDocument(source ?? '', true)
  if (typeof document === 'string') return project(source, document)
  const current = project(source, document)
  if (source === document.next || (await staleLayout(current))) return current
  const updated = parseSettings(document.next)
  if (typeof updated === 'string') return project(source, updated)
  try {
    const legacy = current.settings.files.legacyMap
    if (legacy && legacy !== current.settings.files.shift && (await store.exists(`${root}/${legacy}`))) {
      // Even a disabled project's private map belongs in its usual store when it is upgraded.
      const records =
        !current.settings.enabled && !current.settings.commit && store.nativeRecords
          ? new WorkingRecords(current, store, letterSession ?? '').store()
          : current.store
      const map = `${root}/${current.settings.files.shift}`
      if (!(await records.exists(map))) {
        const rules = await store.read(`${root}/${legacy}`)
        if (rules === null) throw new Error(`Cannot read the former map at ${legacy}.`)
        await records.write(map, rules)
      } else if ((await records.read(map)) === null) throw new Error('Cannot read the internal map.')
    }
    if ((await store.read(path)) !== source || (source === null && (await store.exists(path))))
      throw new Error('Settings changed during initialization. Retry at the next session start.')
    await store.write(path, document.next, source)
    return project(document.next, updated)
  } catch (error) {
    // Two starts may have prepared the same upgrade. The first writer already completed it.
    if ((await store.read(path)) === document.next) return project(document.next, updated)
    return project(source, `Could not initialize ${SETTINGS}: ${String(error)}`)
  }
}
