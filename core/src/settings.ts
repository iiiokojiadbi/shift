import { DOCS_MAP_MAX_CHARS, GLOSSARY, OWNER, SETTINGS, SHIFT_FILE } from './layout'

// The owner's settings for one project; the agent does not edit them.
export type Settings = {
  // false turns the mod off in this project: no tools, no doctrine, no hints, no shifts.
  enabled: boolean
  // Where knowledge goes; null until the owner said, and then it stays in the records' knowledge folder.
  knowledge: Placement | null
  // true lets the project's git take the records in; false keeps them out, the mod excludes them itself.
  commit: boolean
  // Where the files loaded into every session live, relative to the project's root; `always` are the project's own
  // files the owner wants whole in every session too.
  files: { shift: string; owner: string; glossary: string; always: string[] }
  docs: DocsSettings
}

// The project's documents the mod keeps: the folders, relative to the project's root (none — the mod touches no
// document), how long the map in SHIFT.md may be, whether each document carries a toc, and the limits a document is
// checked against after an edit (null — no such check).
export type DocsSettings = {
  dirs: string[]
  maxChars: number
  toc: boolean
  maxDescription: number | null
  maxLines: number | null
}

export const PLACEMENTS = ['local', 'project', 'split'] as const
export type Placement = (typeof PLACEMENTS)[number]

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  knowledge: null,
  commit: false,
  files: { shift: SHIFT_FILE, owner: OWNER, glossary: GLOSSARY, always: [] },
  docs: { dirs: ['docs'], maxChars: DOCS_MAP_MAX_CHARS, toc: false, maxDescription: null, maxLines: null },
}

type Value = string | boolean | number | string[]

// A key of the settings file: the mod's version it came in, what it does, its value in the settings, and how a value
// from the file goes in — or what is wrong with it. One row is all a new key needs.
type Key = {
  key: string
  since: string
  about: string
  get: (settings: Settings) => unknown
  put: (settings: Settings, value: Value) => string | null
}

const flag = (key: string, get: (s: Settings) => boolean, set: (s: Settings, value: boolean) => void) => ({
  get,
  put: (settings: Settings, value: Value) => {
    if (typeof value !== 'boolean') return `\`${key}\` is true or false, got ${JSON.stringify(value)}.`
    set(settings, value)
    return null
  },
})

const place = (key: string, get: (s: Settings) => string, set: (s: Settings, value: string) => void) => ({
  get,
  put: (settings: Settings, value: Value) => {
    if (typeof value !== 'string' || !isInside(value)) return `\`${key}\` is a path inside the project, got ${JSON.stringify(value)}.`
    set(settings, value)
    return null
  },
})

const places = (key: string, what: string, get: (s: Settings) => string[], set: (s: Settings, value: string[]) => void) => ({
  get,
  put: (settings: Settings, value: Value) => {
    if (!Array.isArray(value) || !value.every(isInside))
      return `\`${key}\` is a list of ${what} inside the project, got ${JSON.stringify(value)}.`
    set(settings, value)
    return null
  },
})

const limit = (key: string, get: (s: Settings) => number | null, set: (s: Settings, value: number) => void) => ({
  get,
  put: (settings: Settings, value: Value) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
      return `\`${key}\` is a whole number above 0, got ${JSON.stringify(value)}.`
    set(settings, value)
    return null
  },
})

// Every key, so an agent after an update sees what is new.
export const SETTING_KEYS: readonly Key[] = [
  {
    key: 'enabled',
    since: '0.2.9',
    about: 'false turns the mod off in this project from the next session: no tools, no doctrine, no hints',
    ...flag(
      'enabled',
      s => s.enabled,
      (s, value) => (s.enabled = value),
    ),
  },
  {
    key: 'knowledge',
    since: '0.2.9',
    about: 'where knowledge goes: "local", "project" or "split"; unset — local, and ask the owner once',
    get: s => s.knowledge,
    put: (settings, value) => {
      if (!(PLACEMENTS as readonly unknown[]).includes(value))
        return `\`knowledge\` is one of ${PLACEMENTS.map(each => `"${each}"`).join(', ')}, got ${JSON.stringify(value)}.`
      settings.knowledge = value as Placement
      return null
    },
  },
  {
    key: 'commit',
    since: '0.2.9',
    about: "true lets the project's git take the records in; false — the mod keeps them out by the local exclude file",
    ...flag(
      'commit',
      s => s.commit,
      (s, value) => (s.commit = value),
    ),
  },
  {
    key: 'files.shift',
    since: '0.3.0',
    about: "where SHIFT.md lives, from the project's root",
    ...place(
      'files.shift',
      s => s.files.shift,
      (s, value) => (s.files.shift = value),
    ),
  },
  {
    key: 'files.owner',
    since: '0.3.0',
    about: "where OWNER.md lives, from the project's root",
    ...place(
      'files.owner',
      s => s.files.owner,
      (s, value) => (s.files.owner = value),
    ),
  },
  {
    key: 'files.glossary',
    since: '0.3.0',
    about: "where GLOSSARY.md lives, from the project's root",
    ...place(
      'files.glossary',
      s => s.files.glossary,
      (s, value) => (s.files.glossary = value),
    ),
  },
  {
    key: 'files.always',
    since: '0.5.0',
    about: "the project's own files loaded whole into every session, beside SHIFT.md and OWNER.md",
    ...places(
      'files.always',
      'files',
      s => s.files.always,
      (s, value) => (s.files.always = value),
    ),
  },
  {
    key: 'docs.dirs',
    since: '0.3.0',
    about:
      'the folders of documents the mod keeps, or single documents such as "AGENTS.md" (since 0.9.0): the map in SHIFT.md, the toc, the checks, the docs tools; [] — none, the docs are left alone',
    ...places(
      'docs.dirs',
      'folders or documents',
      s => s.docs.dirs,
      (s, value) => (s.docs.dirs = value),
    ),
  },
  {
    key: 'docs.max_chars',
    since: '0.4.3',
    about: 'how long the map may be: past it the sections go, then the descriptions, and the map says so',
    ...limit(
      'docs.max_chars',
      s => s.docs.maxChars,
      (s, value) => (s.docs.maxChars = value),
    ),
  },
  {
    key: 'docs.toc',
    since: '0.5.0',
    about: 'true — the mod keeps a toc in each document under its # title',
    ...flag(
      'docs.toc',
      s => s.docs.toc,
      (s, value) => (s.docs.toc = value),
    ),
  },
  {
    key: 'docs.max_description',
    since: '0.5.0',
    about: "a document's description longer than this is a remark; unset — no such check",
    ...limit(
      'docs.max_description',
      s => s.docs.maxDescription,
      (s, value) => (s.docs.maxDescription = value),
    ),
  },
  {
    key: 'docs.max_lines',
    since: '0.5.0',
    about: 'a document longer than this many lines is a remark; unset — no such check',
    ...limit(
      'docs.max_lines',
      s => s.docs.maxLines,
      (s, value) => (s.docs.maxLines = value),
    ),
  },
]

// The settings a file gives and the keys it sets itself; what is wrong with it otherwise.
export type ParsedSettings = { settings: Settings; set: ReadonlySet<string> }

// A flat subset of TOML: `key = value` lines with a string, a boolean, a number or a one-line array of strings,
// `#` comments, `[table]` headers that prefix the keys after them. A key outside the known ones is a mistake, not a
// setting the mod skips.
export function parseSettings(text: string): ParsedSettings | string {
  const settings: Settings = { ...DEFAULT_SETTINGS, files: { ...DEFAULT_SETTINGS.files }, docs: { ...DEFAULT_SETTINGS.docs } }
  const set = new Set<string>()
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
    const name = `${table}${pair[1]}`
    const key = SETTING_KEYS.find(each => each.key === name)
    if (key === undefined)
      return `${SETTINGS}: unknown key \`${name}\`; the keys are ${SETTING_KEYS.map(each => `\`${each.key}\``).join(', ')}.`
    const problem = key.put(settings, value)
    if (problem !== null) return `${SETTINGS}: ${problem}`
    set.add(name)
  }

  return { settings, set }
}

// A key's value in the settings, as TOML; null when the key is unset and has no value of its own.
export function settingValue(settings: Settings, key: string): string | null {
  const value = SETTING_KEYS.find(each => each.key === key)?.get(settings)

  return value === null || value === undefined ? null : JSON.stringify(value).replace(/","/g, '", "')
}

// Relative, without a way out of the project.
function isInside(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.split('/').includes('..')
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
