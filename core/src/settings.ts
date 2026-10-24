import { SETTINGS } from './layout'
import type { Store } from './store'

// The owner's settings for one project; the agent does not edit them.
export type Settings = {
  // false turns the mod off in this project: no tools, no doctrine, no hints, no shifts.
  enabled: boolean
  // Where knowledge goes; null until the owner said, and then it stays in the records' knowledge folder.
  knowledge: Placement | null
}

export const PLACEMENTS = ['local', 'project', 'split'] as const
export type Placement = (typeof PLACEMENTS)[number]

export const DEFAULT_SETTINGS: Settings = { enabled: true, knowledge: null }

// A flat subset of TOML: `key = value` lines with a string, a boolean or a number, `#` comments, `[table]` headers
// that prefix the keys after them. A key outside the known ones is a mistake, not a setting the mod skips.
export function parseSettings(text: string): Settings | string {
  const values = new Map<string, string | boolean | number>()
  let table = ''
  for (const [index, raw] of text.split('\n').entries()) {
    const line = withoutComment(raw).trim()
    if (line === '') continue
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line)
    if (header !== null) {
      table = `${header[1]}.`
      continue
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    const value = pair === null ? undefined : tomlValue(pair[2] ?? '')
    if (pair === null || value === undefined)
      return `${SETTINGS}, line ${index + 1}: expected \`key = value\` with a string, true/false or a number, got "${raw.trim()}".`
    values.set(`${table}${pair[1]}`, value)
  }

  const settings = { ...DEFAULT_SETTINGS }
  for (const [key, value] of values) {
    if (key === 'enabled') {
      if (typeof value !== 'boolean') return `${SETTINGS}: \`enabled\` is true or false, got ${JSON.stringify(value)}.`
      settings.enabled = value
    } else if (key === 'knowledge') {
      if (!(PLACEMENTS as readonly unknown[]).includes(value)) {
        return `${SETTINGS}: \`knowledge\` is one of ${PLACEMENTS.map(each => `"${each}"`).join(', ')}, got ${JSON.stringify(value)}.`
      }
      settings.knowledge = value as Placement
    } else {
      return `${SETTINGS}: unknown key \`${key}\`; the keys are \`enabled\` and \`knowledge\`.`
    }
  }

  return settings
}

// The project's settings, the defaults when there is no file; a file that does not parse comes back as its problem.
export async function readSettings(store: Store, root: string): Promise<{ settings: Settings; problem: string | null }> {
  const text = await store.read(`${root}/${SETTINGS}`)
  if (text === null) return { settings: DEFAULT_SETTINGS, problem: null }
  const parsed = parseSettings(text)

  // A broken file leaves the mod on: turning it off by a typo would be silent.
  return typeof parsed === 'string' ? { settings: DEFAULT_SETTINGS, problem: parsed } : { settings: parsed, problem: null }
}

function withoutComment(line: string): string {
  let quote: string | null = null
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote !== null) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '#') return line.slice(0, index)
  }

  return line
}

function tomlValue(raw: string): string | boolean | number | undefined {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^[+-]?\d+(\.\d+)?$/.test(value)) return Number(value)
  const quoted = /^"([^"\\]*)"$|^'([^']*)'$/.exec(value)

  return quoted === null ? undefined : (quoted[1] ?? quoted[2])
}
