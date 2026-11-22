import { DOCS_MAX_DEPTH, DOCS_PINNED_MAX_CHARS, GLOSSARY, OWNER, SETTINGS, SHIFT_FILE } from './layout'
import { quote } from './markdown'
import { isInside, normalize } from './paths'

// The owner's settings for one project; the agent does not edit them.
export type Settings = {
  // false turns the mod off in this project: no tools, no doctrine, no hints, no shifts.
  enabled: boolean
  // Where knowledge goes; null until the owner said, and then it stays in the records' knowledge folder.
  knowledge: Placement | null
  history: { full: number; brief: number }
  tasks: { prepare: 'on_demand' | 'on_start' }
  hints: { soft: boolean }
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
  maxDepth: number
  maxPinned: number
  toc: boolean
  maxDescription: number | null
  maxLines: number | null
}

export const PLACEMENTS = ['local', 'project', 'split'] as const
export type Placement = (typeof PLACEMENTS)[number]

export function historyWindow(settings: Settings): number {
  return settings.history.full + settings.history.brief
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  knowledge: null,
  history: { full: 1, brief: 9 },
  tasks: { prepare: 'on_demand' },
  hints: { soft: true },
  commit: false,
  files: { shift: SHIFT_FILE, owner: OWNER, glossary: GLOSSARY, always: [] },
  docs: {
    dirs: ['docs'],
    exclude: [],
    maxDepth: DOCS_MAX_DEPTH,
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
  count: (value: Value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? null : 'a safe whole number of 0 or more',
  prepare: (value: Value) => (value === 'on_start' || value === 'on_demand' ? null : '"on_start" or "on_demand"'),
  placement: (value: Value) => ((PLACEMENTS as readonly unknown[]).includes(value) ? null : `one of ${quote(PLACEMENTS)}`),
}

// A key of the settings file: the mod's version it came in, what it does, the sort of its value and where it lives in
// the settings — a field, or a table and a field. One row is all a new key needs.
type Key = {
  key: string
  since: string
  kind: keyof typeof KINDS
  at: [keyof Settings] | ['files' | 'docs' | 'history' | 'tasks' | 'hints', string]
  about: string
}

// Every key, so an agent after an update sees what is new.
export const SETTING_KEYS: readonly Key[] = [
  {
    key: 'enabled',
    since: '0.2.9',
    kind: 'flag',
    at: ['enabled'],
    about: 'true enables Shift in this project. false turns off its tools, instructions and reminders.',
  },
  {
    key: 'knowledge',
    since: '0.2.9',
    kind: 'placement',
    at: ['knowledge'],
    about:
      'Choose "local" for private knowledge, "project" for project docs, or "split" for both. Unset keeps knowledge local until the owner chooses.',
  },
  {
    key: 'commit',
    since: '0.2.9',
    kind: 'flag',
    at: ['commit'],
    about: 'true allows the project to commit Shift records. false keeps them private using the local Git exclude file.',
  },
  {
    key: 'history.full',
    since: 'schema 2',
    kind: 'limit',
    at: ['history', 'full'],
    about: 'Number of recent letters returned in full, including the current letter (integer >= 1).',
  },
  {
    key: 'history.brief',
    since: 'schema 2',
    kind: 'count',
    at: ['history', 'brief'],
    about: 'Number of earlier descriptions (integer >= 0). The archive retains full + brief completed shifts.',
  },
  {
    key: 'tasks.prepare',
    since: 'schema 2',
    kind: 'prepare',
    at: ['tasks', 'prepare'],
    about: 'Prepare the optional tracker on first request ("on_demand") or at session start ("on_start").',
  },
  {
    key: 'hints.soft',
    since: 'schema 2',
    kind: 'flag',
    at: ['hints', 'soft'],
    about: 'true allows an early reminder when the host has room. false delivers only the final reminder.',
  },
  {
    key: 'docs.max_depth',
    since: 'schema 2',
    kind: 'count',
    at: ['docs', 'maxDepth'],
    about: 'Subfolder levels below each listed directory (integer >= 0). Zero reads its direct files. Explicit files are always eligible.',
  },
  {
    key: 'files.owner',
    since: '0.3.0',
    kind: 'path',
    at: ['files', 'owner'],
    about: 'Project-relative path to the owner Markdown file. Unset uses the project record store.',
  },
  {
    key: 'files.glossary',
    since: '0.3.0',
    kind: 'path',
    at: ['files', 'glossary'],
    about: 'Project-relative path to the glossary Markdown file. Unset uses the project record store.',
  },
  {
    key: 'files.always',
    since: '0.5.0',
    kind: 'files',
    at: ['files', 'always'],
    about: 'List of project-relative files to load in full in every session. [] adds none.',
  },
  {
    key: 'docs.exclude',
    since: 'schema 1',
    kind: 'files',
    at: ['docs', 'exclude'],
    about: 'List of individual project-relative documents to omit from the map, tocs and checks. [] excludes none.',
  },
  {
    key: 'docs.dirs',
    since: '0.3.0',
    kind: 'docs',
    at: ['docs', 'dirs'],
    about: 'List of project-relative directories or individual Markdown files to map and maintain. [] disables project documentation.',
  },
  {
    key: 'docs.max_pinned',
    since: '0.13.0',
    kind: 'limit',
    at: ['docs', 'maxPinned'],
    about: 'Combined character budget for pinned blocks (integer >= 1). Excess produces a remark. All pins still appear.',
  },
  {
    key: 'docs.toc',
    since: '0.5.0',
    kind: 'flag',
    at: ['docs', 'toc'],
    about: 'true maintains a table of contents below each document title. false leaves the document as written.',
  },
  {
    key: 'docs.max_description',
    since: '0.5.0',
    kind: 'limit',
    at: ['docs', 'maxDescription'],
    about: 'Maximum description length in characters (integer >= 1). Unset disables this check.',
  },
  {
    key: 'docs.max_lines',
    since: '0.5.0',
    kind: 'limit',
    at: ['docs', 'maxLines'],
    about: 'Maximum document length in lines (integer >= 1). Unset disables this check.',
  },
]

// Where a key's value lives: the settings or one of their tables, and the field in it.
function slot(settings: Settings, { at }: Key): [Record<string, unknown>, string] {
  const [first, second] = at

  return second === undefined ? [settings, first] : [settings[first as 'files' | 'docs' | 'history' | 'tasks' | 'hints'], second]
}

// The settings a file gives and the keys it sets itself; what is wrong with it otherwise.
export type ParsedSettings = { settings: Settings; set: ReadonlySet<string> }

// An index in this table is the source schema. Each step sees the original
// keys, including retired ones. Cleanup and validation run after the last step.
const MIGRATIONS = [migrateUnversioned, migrateHistoryWindow]
export const SETTINGS_SCHEMA = MIGRATIONS.length

const EXAMPLES: Record<string, string> = {
  knowledge: '"local"',
  'files.owner': `"${OWNER}"`,
  'files.glossary': `"${GLOSSARY}"`,
  'docs.max_description': '200',
  'docs.max_lines': '150',
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

function migrateHistoryWindow(sections: Sections): Record<string, never> | string {
  const root = sections.get('') ?? []
  const old = root.find(row => row.name === 'history_limit')
  if (!old) return {}
  if (typeof old.value !== 'number' || KINDS.limit(old.value)) return `${SETTINGS}: history_limit must be a safe whole number above 0.`
  const history = sections.get('history') ?? [{ raw: '[history]' }]
  // Schema 1 silently capped the old total at ten, even when the file said more.
  for (const [name, value] of [
    ['full', 1],
    ['brief', Math.min(10, old.value) - 1],
  ] as const) {
    if (!history.some(row => row.name === name)) history.push({ name, value, raw: `${name} = ${value}` })
  }
  const comment = old.raw.slice(withoutComment(old.raw).length)
  root.splice(root.indexOf(old), 1, ...(comment ? [{ raw: comment }] : []))
  sections.set('history', history)
  return {}
}

function exampleName(row: Row): string | undefined {
  return row.name ?? /^\s*#\s*([a-z_]+)\s*=/.exec(row.raw)?.[1]
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
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    history: { ...DEFAULT_SETTINGS.history },
    tasks: { ...DEFAULT_SETTINGS.tasks },
    hints: { ...DEFAULT_SETTINGS.hints },
    files: { ...DEFAULT_SETTINGS.files },
    docs: { ...DEFAULT_SETTINGS.docs },
  }
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
          holder[field] = given
          set.add(name)
        }
      }
      kept.push(row)
    }
    sections.set(table, kept)
  }
  if (!Number.isSafeInteger(historyWindow(settings))) return `${SETTINGS}: history.full + history.brief must be a safe whole number.`
  if (!upgrade) return { settings, set, next: text }
  if (version < SETTINGS_SCHEMA) {
    sections.get('')?.unshift({ name: 'schema_version', raw: `schema_version = ${SETTINGS_SCHEMA}` })
    for (const { key } of SETTING_KEYS) {
      if (set.has(key)) continue
      const [group, name] = key.includes('.') ? key.split('.') : ['', key]
      const section = group ?? ''
      const rows = sections.get(section) ?? [{ raw: `[${section}]` }]
      if (rows.some(row => exampleName(row) === name)) continue
      const example = EXAMPLES[key]
      rows.push({
        ...(example ? {} : { name }),
        raw: example ? `# ${name} = ${example}` : `${name} = ${settingValue(DEFAULT_SETTINGS, key)}`,
      })
      sections.set(section, rows)
    }
  }
  for (const [table, rows] of sections) {
    const annotated: Row[] = []
    for (const row of rows) {
      if (row.raw.startsWith('# Shift: ')) continue
      const name = exampleName(row)
      const key = table ? `${table}.${name}` : name
      const about =
        key === 'schema_version'
          ? 'Settings format version, maintained by Shift during migration.'
          : SETTING_KEYS.find(setting => setting.key === key)?.about
      if (about) annotated.push({ raw: `# Shift: ${about}` })
      annotated.push(row)
    }
    if (annotated.length !== rows.length || annotated.some((row, index) => row.raw !== rows[index]?.raw)) changed = true
    sections.set(table, annotated)
  }
  if (!changed) return { settings, set, next: text }
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
