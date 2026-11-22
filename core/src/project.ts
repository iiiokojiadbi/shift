import { keepRecordsOut, staleLayout } from './flows'
import { SETTINGS } from './layout'
import { pendingMap, prepareMapImport } from './map-import'
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
    const records = p.store
    const map = `${root}/${p.settings.files.shift}`
    p.store = {
      ...records,
      read: async path => {
        const text = await records.read(path)
        if (path !== map) return text
        const pending = pendingMap(text)
        if (!pending) return text
        // An interrupted import is private to startup. Once settings commit, its
        // selected rules can be read even before startup removes the marker.
        if (p.problem || p.settings.files.legacyMap) return null
        return p.settings.docs.exclude.includes(pending.path) ? pending.rules : ''
      },
    }
    return p
  }
  if (source === null) {
    try {
      if (await store.exists(path, 'checked')) return project(null, `Cannot read ${SETTINGS}.`)
    } catch (error) {
      return project(null, `Cannot read ${SETTINGS}: ${String(error)}`)
    }
  }
  if (!lifecycle) {
    const parsed = parseSettings(source ?? '')
    if (typeof parsed === 'string') {
      // A retired key can survive a failed upgrade. Honor a valid off switch while reporting it.
      const recoverable = settingsDocument(source ?? '', true)
      if (typeof recoverable !== 'string' && !recoverable.settings.enabled) {
        const disabled = project(source, recoverable)
        disabled.problem = parsed
        return disabled
      }
    }
    return project(source, parsed)
  }
  const document = settingsDocument(source ?? '', true)
  if (typeof document === 'string') return project(source, document)
  const current = project(source, document)
  const initialize = source !== document.next || current.settings.docs.exclude.length > 0
  if ((!initialize && current.settings.enabled) || (await staleLayout(current))) return current
  const updated = parseSettings(document.next)
  if (typeof updated === 'string') return project(source, updated)
  const legacy = current.settings.files.legacyMap
  const map = `${root}/${current.settings.files.shift}`
  try {
    // Migration may create private records even when the project is disabled.
    const kept = await keepRecordsOut(current)
    if ('deny' in kept) throw new Error(kept.deny)
    if (!initialize) return current
    // Migration alone reads the raw staging marker.
    const records =
      !current.settings.enabled && !current.settings.commit && store.nativeRecords
        ? new WorkingRecords(current, store, letterSession ?? '').store()
        : (current.working?.store() ?? store)
    const staged =
      legacy || current.settings.docs.exclude.length
        ? await prepareMapImport(records, store, root, map, legacy, current.settings.docs.exclude)
        : null
    if (source !== document.next) {
      if ((await store.read(path)) !== source || (source === null && (await store.exists(path, 'checked'))))
        throw new Error('Settings changed during initialization. Retry at the next session start.')
      await store.write(path, document.next, source)
    }
    if (staged) await records.write(map, staged.rules, staged.text)
    return project(document.next, updated)
  } catch (error) {
    if (source !== document.next && !legacy && !current.settings.docs.exclude.length && (await store.read(path)) === document.next)
      return project(document.next, updated)
    current.problem = `Could not initialize ${SETTINGS}: ${String(error)}`
    return current
  }
}
