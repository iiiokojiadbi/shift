// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { SETTINGS } from './layout'
import { DEFAULT_SETTINGS, parseSettings, type Settings } from './settings'
import type { Store } from './store'

// One project as an operation of the mod sees it: its files and its settings, read once when the operation starts.
// A settings file that does not parse leaves the mod on with the defaults — turning it off by a typo would be silent —
// and its problem is told to the owner at the session's start and refuses a shift until the owner fixes it.
export type Project = {
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

export async function loadProject(store: Store, root: string): Promise<Project> {
  const settingsText = await store.read(`${root}/${SETTINGS}`)
  const parsed = settingsText === null ? null : parseSettings(settingsText)
  if (typeof parsed === 'string') return { store, root, settings: DEFAULT_SETTINGS, problem: parsed, settingsText, set: new Set() }

  return { store, root, settings: parsed?.settings ?? DEFAULT_SETTINGS, problem: null, settingsText, set: parsed?.set ?? new Set() }
}
