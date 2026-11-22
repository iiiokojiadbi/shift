import { DOCS_MAX_DEPTH, DOCS_PINNED_MAX_CHARS, GLOSSARY, OWNER, SETTINGS, SHIFT_FILE } from './layout'
import { quote } from './markdown'
import { isInside, normalize } from './paths'

// The owner's settings for one project; the agent does not edit them.
export type Settings = {
  // false turns the mod off in this project: no tools, no doctrine, no hints, no shifts.
  enabled: boolean
  // Where knowledge goes; null until the owner said, and then it stays in the records' knowledge folder.
  knowledge: Placement | null
  historyLimit: number
  // true lets the project's git take the records in; false keeps them out, the mod excludes them itself.
  commit: boolean
  // Where the files loaded into every session live, relative to the project's root; `always` are the project's own
  // files the owner wants whole in every session too.
  files: { legacyMap?: string; shift: string; owner: string; glossary: string; always: string[] }
  docs: DocsSettings
}

// The project's documents the mod keeps: the folders, relative to the project's root (none — the mod touches no
// document), whether each document carries a toc, and the limits a document is
// checked against after an edit (null — no such check).
export type DocsSettings = {
  dirs: string[]
  exclude: string[]
  maxPinned: number
  toc: boolean
  maxDescription: number | null
  maxLines: number | null
}

export const PLACEMENTS = ['local', 'project', 'split'] as const
export type Placement = (typeof PLACEMENTS)[number]

export const HISTORY_CAPACITY = 10

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  knowledge: null,
  historyLimit: HISTORY_CAPACITY,
  commit: false,
  files: { shift: SHIFT_FILE, owner: OWNER, glossary: GLOSSARY, always: [] },
  docs: {
    dirs: ['docs'],
    exclude: [],
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
  limit: (value: Value) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? null : 'a safe whole number above 0'),
  placement: (value: Value) => ((PLACEMENTS as readonly unknown[]).includes(value) ? null : `one of ${quote(PLACEMENTS)}`),
}

// A key of the settings file: the mod's version it came in, what it does, the sort of its value and where it lives in
// the settings — a field, or a table and a field. One row is all a new key needs.
type Key = { key: string; since: string; kind: keyof typeof KINDS; at: [keyof Settings] | ['files' | 'docs', string]; about: string }

// Every key, so an agent after an update sees what is new.
export const SETTING_KEYS: readonly Key[] = [
  {
    key: 'history_limit',
    since: 'storage roadmap',
    kind: 'limit',
    at: ['historyLimit'],
    about: `completed shifts to retain, up to ${HISTORY_CAPACITY} including the current shift; earlier descriptions use the remaining slots`,
  },
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
    key: 'docs.exclude',
    since: 'schema 1',
    kind: 'files',
    at: ['docs', 'exclude'],
    about: 'individual document paths to omit from the map, tocs and checks',
  },
  {
    key: 'docs.dirs',
    since: '0.3.0',
    kind: 'docs',
    at: ['docs', 'dirs'],
    about: `the folders of documents the mod keeps, ${DOCS_MAX_DEPTH} folders deep at most, or single documents such as "AGENTS.md" (since 0.9.0): the map in SHIFT.md, the toc, the checks, the docs tools; [] — none, the docs are left alone`,
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

// An index in this table is the source schema. Each step sees the original
// keys, including retired ones. Cleanup and validation run after the last step.
const MIGRATIONS = [migrateUnversioned]
export const SETTINGS_SCHEMA = MIGRATIONS.length

const EXAMPLES: Record<string, string> = {
  knowledge: '"local"  # choose local, project or split',
  'files.owner': `"${OWNER}"  # uncomment to use a Markdown file`,
  'files.glossary': `"${GLOSSARY}"  # uncomment to use a Markdown file`,
  'docs.max_description': '200  # optional character limit',
  'docs.max_lines': '150  # optional line limit',
}

type Row = { raw: string; name?: string; value?: Value }
type Sections = Map<string, Row[]>
type Document = ParsedSettings & { next: string }

function migrateUnversioned(sections: Sections): { legacyMap?: string } | string {
  const documents = sections.get('docs')
  if (documents)
    sections.set(
      'docs',
      documents.filter(row => row.name !== 'max_chars'),
    )
  const files = sections.get('files') ?? []
  const old = files.find(row => row.name === 'shift')
  if (!old) return {}
  const former = old.value === undefined ? null : asPaths(old.value)
  if (typeof former !== 'string' || !isInside(former)) return `${SETTINGS}: \`files.shift\` must be a path inside the project.`
  files.splice(files.indexOf(old), 1)
  if (former === SHIFT_FILE) return {}
  const docs = sections.get('docs') ?? [{ raw: '[docs]' }]
  const exclude = docs.find(row => row.name === 'exclude')
  if (exclude && !Array.isArray(exclude.value)) return `${SETTINGS}: \`docs.exclude\` must be a list of files inside the project.`
  const paths = exclude && Array.isArray(exclude.value) ? exclude.value : []
  if (!paths.some(path => (normalize(path) ?? path) === former)) {
    const value = [...paths, former]
    // Both forms are accepted by the flat reader. A literal string can include a backslash or double quote.
    const array = value.map(path => (/["\\]/.test(path) ? `'${path}'` : `"${path}"`)).join(', ')
    const comment = exclude ? exclude.raw.slice(withoutComment(exclude.raw).length) : ''
    const row = { name: 'exclude', value, raw: `exclude = [${array}]${comment ? ` ${comment}` : ''}` }
    if (exclude) docs[docs.indexOf(exclude)] = row
    else docs.push(row)
    sections.set('docs', docs)
  }
  return { legacyMap: former }
}

function readSections(text: string): { sections: Sections; version: number } | string {
  let rows: Row[] = []
  const sections: Sections = new Map([['', rows]])
  const names = new Set<string>()
  let table = ''
  let version = 0
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = withoutComment(raw).trim()
    const problem = (message: string) => `${SETTINGS}, line ${index + 1}: ${message}.`
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line)
    if (header) {
      table = header[1] ?? ''
      if (sections.has(table)) return problem(`\`[${table}]\` is opened twice; keep its keys under one`)
      rows = [{ raw }]
      sections.set(table, rows)
    } else if (!line) rows.push({ raw })
    else {
      const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
      const value = pair ? tomlValue(pair[2] ?? '') : undefined
      if (!pair?.[1] || value === undefined)
        return problem(`expected \`key = value\` with a string, true/false, a number or ["strings"], got "${raw.trim()}"`)
      const name = table ? `${table}.${pair[1]}` : pair[1]
      if (names.has(name)) return problem(`\`${name}\` is set twice; keep one`)
      names.add(name)
      if (name === 'schema_version') {
        if (typeof value !== 'number' || !/^\d+$/.test(pair[2]?.trim() ?? '') || !Number.isSafeInteger(value))
          return problem('schema_version must be a nonnegative integer')
        if (value > SETTINGS_SCHEMA) return problem(`schema ${value} requires a newer Shift (this build supports ${SETTINGS_SCHEMA})`)
        version = value
      }
      rows.push({ raw, name: pair[1], value })
    }
  }
  return { sections, version }
}

// Normal reads diagnose unknown names; a session start removes them. Both use the same checks.
export function settingsDocument(text: string, upgrade: boolean): Document | string {
  const file = readSections(text)
  if (typeof file === 'string') return file
  const { sections, version } = file
  const settings: Settings = { ...DEFAULT_SETTINGS, files: { ...DEFAULT_SETTINGS.files }, docs: { ...DEFAULT_SETTINGS.docs } }
  const set = new Set<string>()
  for (const migrate of MIGRATIONS.slice(version)) {
    const result = migrate(sections)
    if (typeof result === 'string') return result
    Object.assign(settings.files, result)
  }
  let changed = version < SETTINGS_SCHEMA
  for (const [table, rows] of sections) {
    if (table && !TABLES.has(table)) {
      if (!upgrade) return `${SETTINGS}: unknown table \`[${table}]\`.`
      sections.delete(table)
      changed = true
      continue
    }
    const kept: Row[] = []
    for (const row of rows) {
      if (row.name && row.value !== undefined) {
        const name = table ? `${table}.${row.name}` : row.name
        if (name === 'schema_version' && version < SETTINGS_SCHEMA) continue
        if (name !== 'schema_version') {
          const key = SETTING_KEYS.find(each => each.key === name)
          if (!key) {
            if (!upgrade)
              return `${SETTINGS}: unknown key \`${name}\`; the keys are ${SETTING_KEYS.map(each => `\`${each.key}\``).join(', ')}.`
            changed = true
            continue
          }
          const given = PATH_KINDS.has(key.kind) ? asPaths(row.value) : row.value
          const wanted = KINDS[key.kind](given)
          if (wanted !== null) return `${SETTINGS}: \`${name}\` is ${wanted}, got ${JSON.stringify(row.value)}.`
          const [holder, field] = slot(settings, key)
          holder[field] = name === 'history_limit' && typeof given === 'number' ? Math.min(given, HISTORY_CAPACITY) : given
          set.add(name)
        }
      }
      kept.push(row)
    }
    sections.set(table, kept)
  }
  if (!upgrade || !changed) return { settings, set, next: text }
  if (version < SETTINGS_SCHEMA) {
    sections.get('')?.unshift({ raw: `schema_version = ${SETTINGS_SCHEMA}` })
    for (const { key } of SETTING_KEYS) {
      if (set.has(key)) continue
      const [group, name] = key.includes('.') ? key.split('.') : ['', key]
      const section = group ?? ''
      const rows = sections.get(section) ?? [{ raw: `[${section}]` }]
      const example = EXAMPLES[key]
      rows.push({ raw: example ? `# ${name} = ${example}` : `${name} = ${settingValue(DEFAULT_SETTINGS, key)}` })
      sections.set(section, rows)
    }
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const blocks = [...sections.values()].map(rows =>
    rows
      .map(row => row.raw)
      .join(newline)
      .trimEnd(),
  )
  return { settings, set, next: blocks.join(newline + newline) + newline }
}

export function parseSettings(text: string): ParsedSettings | string {
  const parsed = settingsDocument(text, false)
  return typeof parsed === 'string' ? parsed : { settings: parsed.settings, set: parsed.set }
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
