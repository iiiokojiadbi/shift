// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { textFingerprint } from './markdown'
import type { Store } from './store'

// Only session startup stages a copy. The caller publishes it after the settings
// write succeeds. A committed migration keeps its source in docs.exclude.
export async function prepareMapImport(
  records: Store,
  disk: Store,
  root: string,
  map: string,
  legacy: string | undefined,
  excluded: readonly string[],
) {
  const existing = await records.read(map)
  if (existing === null && legacy && (await records.exists(map))) throw new Error('Cannot read the internal map.')
  const pending = pendingMap(existing)
  if (existing !== null && !pending) return null
  if (legacy && (await disk.exists(`${root}/${legacy}`))) {
    const rules = await disk.read(`${root}/${legacy}`)
    if (rules === null) throw new Error(`Cannot read the former map at ${legacy}.`)
    const text = stageMap(legacy, rules)
    if (text !== existing) await records.write(map, text, existing)
    return { text, rules }
  }
  if (!pending || existing === null) return null
  const selected = legacy ? pending.path === legacy : excluded.includes(pending.path)
  return { text: existing, rules: selected ? pending.rules : '' }
}

// Stage the rules in their destination. Only an intact marker is retryable. An
// owner's edit to the staged body makes the internal map authoritative.
function stageMap(path: string, rules: string): string {
  return `<!-- shift:map-import ${textFingerprint(rules)} ${JSON.stringify(path)} -->\n${rules}`
}

export function pendingMap(text: string | null): { path: string; rules: string } | null {
  const marker = text?.match(/^<!-- shift:map-import (\d+) ("[^\n]*") -->\n/)
  if (!text || !marker?.[2]) return null
  const rules = text.slice(marker[0].length)
  if (textFingerprint(rules) !== Number(marker[1])) return null
  try {
    const path: unknown = JSON.parse(marker[2])
    return typeof path === 'string' ? { path, rules } : null
  } catch {
    return null
  }
}
