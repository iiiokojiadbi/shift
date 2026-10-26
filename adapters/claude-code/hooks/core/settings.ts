// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { DOCS_MAP_MAX_CHARS, DOCS_PINNED_MAX_CHARS, GLOSSARY, OWNER, SETTINGS, SHIFT_FILE } from './layout'
import { quote } from './markdown'
import { isInside, normalize } from './paths'

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
  maxPinned: number
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
  docs: {
    dirs: ['docs'],
    maxChars: DOCS_MAP_MAX_CHARS,
    maxPinned: DOCS_PINNED_MAX_CHARS,
    toc: false,
    maxDescription: null,
    maxLines: null,
  },
}

type Value = string | boolean | number | string[]

// What a key's value is, and what is wrong with a value of another sort; null when it fits.
const KINDS = {
  flag: (value: Value) => (typeof value === 'boolean' ? null : 'true or false'),
  path: (value: Value) => (typeof value === 'string' && isInside(value) ? null : 'a path inside the project'),
  files: (value: Value) => (Array.isArray(value) && value.every(isInside) ? null : 'a list of files inside the project'),
  docs: (value: Value) => (Array.isArray(value) && value.every(isInside) ? null : 'a list of folders or documents inside the project'),
  limit: (value: Value) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? null : 'a whole number above 0'),
  placement: (value: Value) => ((PLACEMENTS as readonly unknown[]).includes(value) ? null : `one of ${quote(PLACEMENTS)}`),
}

// A key of the settings file: the mod's version it came in, what it does, the sort of its value and where it lives in
// the settings — a field, or a table and a field. One row is all a new key needs.
type Key = { key: string; since: string; kind: keyof typeof KINDS; at: [keyof Settings] | ['files' | 'docs', string]; about: string }

// Every key, so an agent after an update sees what is new.
export const SETTING_KEYS: readonly Key[] = [
  {
    key: 'enabled',
    since: '0.2.9',
    kind: 'flag',
    at: ['enabled'],
    about: 'false turns the mod off in this project from the next session: no tools, no doctrine, no hints',
  },
  {
    key: 'knowledge',
    since: '0.2.9',
    kind: 'placement',
    at: ['knowledge'],
    about: 'where knowledge goes: "local", "project" or "split"; unset — local, and ask the owner once',
  },
  {
    key: 'commit',
    since: '0.2.9',
    kind: 'flag',
    at: ['commit'],
    about: "true lets the project's git take the records in; false — the mod keeps them out by the local exclude file",
  },
  { key: 'files.shift', since: '0.3.0', kind: 'path', at: ['files', 'shift'], about: "where SHIFT.md lives, from the project's root" },
  { key: 'files.owner', since: '0.3.0', kind: 'path', at: ['files', 'owner'], about: "where OWNER.md lives, from the project's root" },
  {
    key: 'files.glossary',
    since: '0.3.0',
    kind: 'path',
    at: ['files', 'glossary'],
    about: "where GLOSSARY.md lives, from the project's root",
  },
  {
    key: 'files.always',
    since: '0.5.0',
    kind: 'files',
    at: ['files', 'always'],
    about: "the project's own files loaded whole into every session, beside SHIFT.md and OWNER.md",
  },
  {
    key: 'docs.dirs',
    since: '0.3.0',
    kind: 'docs',
    at: ['docs', 'dirs'],
    about:
      'the folders of documents the mod keeps, or single documents such as "AGENTS.md" (since 0.9.0): the map in SHIFT.md, the toc, the checks, the docs tools; [] — none, the docs are left alone',
  },
  {
    key: 'docs.max_chars',
    since: '0.4.3',
    kind: 'limit',
    at: ['docs', 'maxChars'],
    about: 'how long the map may be: past it the sections go, then the descriptions, and the map says so',
  },
  {
    key: 'docs.max_pinned',
    since: '0.13.0',
    kind: 'limit',
    at: ['docs', 'maxPinned'],
    about: 'how long the pinned `> [!IMPORTANT]` blocks of the docs may be together: past it the map says so and still shows them all',
  },
  {
    key: 'docs.toc',
    since: '0.5.0',
    kind: 'flag',
    at: ['docs', 'toc'],
    about: 'true — the mod keeps a toc in each document under its # title',
  },
  {
    key: 'docs.max_description',
    since: '0.5.0',
    kind: 'limit',
    at: ['docs', 'maxDescription'],
    about: "a document's description longer than this is a remark; unset — no such check",
  },
  {
    key: 'docs.max_lines',
    since: '0.5.0',
    kind: 'limit',
    at: ['docs', 'maxLines'],
    about: 'a document longer than this many lines is a remark; unset — no such check',
  },
]

// Where a key's value lives: the settings or one of their tables, and the field in it.
function slot(settings: Settings, { at }: Key): [Record<string, unknown>, string] {
  const [first, second] = at

  return second === undefined ? [settings, first] : [settings[first as 'files' | 'docs'], second]
}

// The settings a file gives and the keys it sets itself; what is wrong with it otherwise.
export type ParsedSettings = { settings: Settings; set: ReadonlySet<string> }

// A flat subset of TOML: `key = value` lines with a string, a boolean, a number or a one-line array of strings,
// `#` comments, `[table]` headers that prefix the keys after them. A key outside the known ones is a mistake, not a
// setting the mod skips.
export function parseSettings(text: string): ParsedSettings | string {
  const settings: Settings = { ...DEFAULT_SETTINGS, files: { ...DEFAULT_SETTINGS.files }, docs: { ...DEFAULT_SETTINGS.docs } }
  const set = new Set<string>()
  let table = ''
  const tables = new Set<string>()
  for (const [index, raw] of text.split('\n').entries()) {
    const line = withoutComment(raw).trim()
    if (line === '') continue
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line)
    if (header !== null) {
      if (!TABLES.has(header[1] ?? ''))
        return `${SETTINGS}, line ${index + 1}: unknown table \`[${header[1]}]\`; the tables are ${[...TABLES].map(each => `\`[${each}]\``).join(', ')}.`
      if (tables.has(header[1] ?? '')) return `${SETTINGS}, line ${index + 1}: \`[${header[1]}]\` is opened twice; keep its keys under one.`
      tables.add(header[1] ?? '')
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
    if (set.has(name)) return `${SETTINGS}, line ${index + 1}: \`${name}\` is set twice; keep one.`
    const given = PATH_KINDS.has(key.kind) ? asPaths(value) : value
    const wanted = KINDS[key.kind](given)
    if (wanted !== null) return `${SETTINGS}: \`${name}\` is ${wanted}, got ${JSON.stringify(value)}.`
    const [holder, field] = slot(settings, key)
    holder[field] = given
    set.add(name)
  }

  return { settings, set }
}

// A key's value in the settings, as TOML; null when the key is unset and has no value of its own.
export function settingValue(settings: Settings, key: string): string | null {
  const row = SETTING_KEYS.find(each => each.key === key)
  if (row === undefined) return null
  const [holder, field] = slot(settings, row)
  const value = holder[field]

  return value === null || value === undefined ? null : JSON.stringify(value).replace(/","/g, '", "')
}

// The tables the keys live in: a header naming anything else is a mistake.
const TABLES = new Set(SETTING_KEYS.flatMap(({ key }) => (key.includes('.') ? [key.slice(0, key.indexOf('.'))] : [])))

// Paths as the mod writes them, from the root: `./OWNER.md` is `OWNER.md`, `.` the root itself (no file or folder),
// a path that climbs out left as given for the check to refuse.
const PATH_KINDS = new Set<string>(['path', 'files', 'docs'])

function asPaths(value: Value): Value {
  const one = (path: string) => (path.startsWith('/') ? path : (normalize(path) ?? path))

  return typeof value === 'string' ? one(value) : Array.isArray(value) ? value.map(one) : value
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
  if (list !== null) return strings(list[1] ?? '')

  return quoted(value)
}

// The strings of a one-line array, each quoted, commas between them and one allowed after the last; undefined for
// anything else, such as `[,]`. A comma inside quotes is part of its string.
function strings(inside: string): string[] | undefined {
  const items: string[] = []
  const item = /\s*("[^"\\]*"|'[^']*')\s*(,|$)/y
  let at = 0
  while (at < inside.length && inside.slice(at).trim() !== '') {
    item.lastIndex = at
    const found = item.exec(inside)
    if (found === null) return undefined
    const value = quoted(found[1] ?? '')
    if (value === undefined) return undefined
    items.push(value)
    at = item.lastIndex
    if (found[2] === '' && at < inside.length) return undefined
  }

  return items
}

function quoted(value: string): string | undefined {
  const found = /^"([^"\\]*)"$|^'([^']*)'$/.exec(value)

  return found === null ? undefined : (found[1] ?? found[2])
}
