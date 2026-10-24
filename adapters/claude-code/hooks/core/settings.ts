// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { GLOSSARY, OWNER, SETTINGS, SHIFT_FILE } from './layout'
import type { Store } from './store'

// The owner's settings for one project; the agent does not edit them.
export type Settings = {
  // false turns the mod off in this project: no tools, no doctrine, no hints, no shifts.
  enabled: boolean
  // Where knowledge goes; null until the owner said, and then it stays in the records' knowledge folder.
  knowledge: Placement | null
  // true lets the project's git take the records in; false keeps them out, the mod excludes them itself.
  commit: boolean
  // Where the files loaded into every session live, relative to the project's root.
  files: { shift: string; owner: string; glossary: string }
  // The folders whose documents the map in SHIFT.md lists, relative to the project's root.
  docs: string[]
}

export const PLACEMENTS = ['local', 'project', 'split'] as const
export type Placement = (typeof PLACEMENTS)[number]

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  knowledge: null,
  commit: false,
  files: { shift: SHIFT_FILE, owner: OWNER, glossary: GLOSSARY },
  docs: ['docs'],
}

type Value = string | boolean | number | string[]

// A flat subset of TOML: `key = value` lines with a string, a boolean, a number or a one-line array of strings,
// `#` comments, `[table]` headers that prefix the keys after them. A key outside the known ones is a mistake, not a
// setting the mod skips.
export function parseSettings(text: string): Settings | string {
  const values = new Map<string, Value>()
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
      return `${SETTINGS}, line ${index + 1}: expected \`key = value\` with a string, true/false, a number or ["strings"], got "${raw.trim()}".`
    values.set(`${table}${pair[1]}`, value)
  }

  const settings: Settings = { ...DEFAULT_SETTINGS, files: { ...DEFAULT_SETTINGS.files } }
  for (const [key, value] of values) {
    const problem = apply(settings, key, value)
    if (problem !== null) return `${SETTINGS}: ${problem}`
  }

  return settings
}

const FILE_KEYS = { 'files.shift': 'shift', 'files.owner': 'owner', 'files.glossary': 'glossary' } as const

function apply(settings: Settings, key: string, value: Value): string | null {
  if (key === 'enabled' || key === 'commit') {
    if (typeof value !== 'boolean') return `\`${key}\` is true or false, got ${JSON.stringify(value)}.`
    settings[key] = value
  } else if (key === 'knowledge') {
    if (!(PLACEMENTS as readonly unknown[]).includes(value)) {
      return `\`knowledge\` is one of ${PLACEMENTS.map(each => `"${each}"`).join(', ')}, got ${JSON.stringify(value)}.`
    }
    settings.knowledge = value as Placement
  } else if (key in FILE_KEYS) {
    if (typeof value !== 'string' || !isInside(value)) return `\`${key}\` is a path inside the project, got ${JSON.stringify(value)}.`
    settings.files[FILE_KEYS[key as keyof typeof FILE_KEYS]] = value
  } else if (key === 'docs.dirs') {
    if (!Array.isArray(value) || !value.every(isInside))
      return `\`docs.dirs\` is a list of folders inside the project, got ${JSON.stringify(value)}.`
    settings.docs = value
  } else {
    return `unknown key \`${key}\`; the keys are \`enabled\`, \`knowledge\`, \`commit\`, \`files.shift\`, \`files.owner\`, \`files.glossary\` and \`docs.dirs\`.`
  }

  return null
}

// Relative, without a way out of the project.
function isInside(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.split('/').includes('..')
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

function tomlValue(raw: string): Value | undefined {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^[+-]?\d+(\.\d+)?$/.test(value)) return Number(value)
  const list = /^\[(.*)\]$/.exec(value)
  if (list !== null) {
    const items = (list[1] ?? '')
      .split(',')
      .map(item => item.trim())
      .filter(item => item !== '')
      .map(quoted)

    return items.every(item => item !== undefined) ? (items as string[]) : undefined
  }

  return quoted(value)
}

function quoted(value: string): string | undefined {
  const found = /^"([^"\\]*)"$|^'([^']*)'$/.exec(value)

  return found === null ? undefined : (found[1] ?? found[2])
}
