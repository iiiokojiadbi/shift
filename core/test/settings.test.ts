import { expect, test } from 'bun:test'
import { acceptShift, sessionFiles } from '../src/flows'
import { atPlaces } from '../src/layout'
import { loadProject } from '../src/project'
import { readSaved } from '../src/saved'
import { DEFAULT_SETTINGS, parseSettings, SETTING_KEYS } from '../src/settings'
import { renderWork, unassistedInstructions } from '../src/texts/prompts'
import { startSession, TOOLS } from '../src/tools'
import { BOARD, LETTER, R, ROOT } from './fixtures'
import { memoryStore } from './memory'

test('settings parse the keys, comments and tables; a missing key keeps its default', () => {
  expect(parseSettings('')).toEqual({ settings: DEFAULT_SETTINGS, set: new Set() })
  expect(parseSettings('# off here\nenabled = false  # for now\n')).toEqual({
    settings: { ...DEFAULT_SETTINGS, enabled: false },
    set: new Set(['enabled']),
  })
  expect(parseSettings("knowledge = 'split'")).toMatchObject({ settings: { ...DEFAULT_SETTINGS, knowledge: 'split' } })
  expect(DEFAULT_SETTINGS.history).toEqual({ full: 1, brief: 9 })
  expect(parseSettings('history_limit = 40')).toMatchObject({ settings: { history: { full: 1, brief: 9 } } })
  expect(parseSettings('commit = true')).toMatchObject({ settings: { ...DEFAULT_SETTINGS, commit: true } })
  expect(parseSettings('knowledge = "a # b"')).toContain('`knowledge` is one of')
})

test('a wrong value, an unknown key or a broken line is named', () => {
  expect(parseSettings('enabled = "no"')).toContain('`enabled` is true or false')
  expect(parseSettings('enable = false')).toContain('unknown key `enable`')
  expect(parseSettings('[hints]\nsoft = 3')).toContain('true or false')
  expect(parseSettings('history_limit = 100000000000000000000')).toContain('safe whole number')
  expect(parseSettings('enabled false')).toContain('line 1')
})

test('no file means the defaults; a broken file leaves the mod on and says why', async () => {
  expect(await loadProject(memoryStore({}), ROOT)).toMatchObject({ settings: DEFAULT_SETTINGS, problem: null, settingsText: null })
  const off = await loadProject(memoryStore({ [`${R}/settings.toml`]: 'enabled = false' }), ROOT)
  expect(off.settings.enabled).toBe(false)
  expect(off.set).toEqual(new Set(['enabled']))
  const broken = await loadProject(memoryStore({ [`${R}/settings.toml`]: 'enabled = nope' }), ROOT)
  expect(broken.settings.enabled).toBe(true)
  expect(broken.problem).toContain('line 1')
  expect(broken.settingsText).toBe('enabled = nope')
})

test('a shift snapshots the settings and is refused while they do not parse', async () => {
  const call = { input: { letter: '.shift/letter.md', after: 'wait' as const, about: 'a' }, at: 0, sessionId: 's' }
  const files = {
    [`${R}/letter.md`]: LETTER,
    [`${R}/board.md`]: BOARD,
    [`${R}/OWNER.md`]: '# Owner decisions\n\nnone',
  }
  const broken = await acceptShift(await loadProject(memoryStore({ ...files, [`${R}/settings.toml`]: 'knowledge = "docs"' }), ROOT), call)
  expect(broken).toEqual({ deny: expect.stringContaining('`knowledge` is one of') })

  const store = memoryStore({ ...files, [`${R}/settings.toml`]: 'knowledge = "split"' })
  const project = await loadProject(store, ROOT)
  const accepted = await acceptShift(project, call)
  if ('deny' in accepted) throw new Error(accepted.deny)
  expect((await readSaved(project, accepted.shift.dir)).files['settings.toml']).toBe('knowledge = "split"')
})

test('the map of knowledge says where knowledge goes', () => {
  const work = {
    board: BOARD,
    owner: null,
    knowledge: [],
    glossary: null,
    shift: null,
  }
  expect(renderWork(work, null, '.shift/OWNER.md')).toContain(
    'Knowledge placement: here until the owner sets knowledge in .shift/settings.toml; ask them once',
  )
  expect(renderWork(work, 'project', '.shift/OWNER.md')).toContain("Knowledge placement: to the project's docs")
})

test('a moved OWNER.md is named where it is: in refusals, the doctrine, the guide and the summarizer', async () => {
  const seed = {
    [`${R}/settings.toml`]: '[files]\nowner = "docs/OWNER.md"',
    [`${R}/letter.md`]: LETTER,
    [`${R}/board.md`]: BOARD,
  }
  const call = { input: { letter: '.shift/letter.md', after: 'wait' as const, about: 'a' }, at: 0, sessionId: 's' }
  const project = await loadProject(memoryStore(seed), ROOT)
  expect(await acceptShift(project, call)).toEqual({ deny: expect.stringContaining('No docs/OWNER.md: create it') })
  const start = await startSession(project)
  expect(start.doctrine).toContain('`docs/OWNER.md` is the owner')
  expect(start.doctrine).not.toContain('.shift/OWNER.md')
  const guide = await TOOLS.find(tool => tool.name === 'shift_guide')?.run({}, { project: async () => project } as never)
  expect(guide && 'result' in guide && guide.result).not.toContain('.shift/OWNER.md')
  expect(unassistedInstructions(project.settings.files)).toContain('decisions at docs/OWNER.md')
})

test('a moved path is moved once, even when it holds a default inside it', () => {
  const files = { owner: 'pkg/.shift/OWNER.md', glossary: '.shift/OWNER.md', shift: '.shift/SHIFT.md' }
  expect(atPlaces('see .shift/OWNER.md and .shift/GLOSSARY.md', files)).toBe('see pkg/.shift/OWNER.md and .shift/OWNER.md')
})

const settingsPath = `${R}/settings.toml`
const open = (store: ReturnType<typeof memoryStore>) => loadProject(store, ROOT, 'session', undefined, 'start')

test('first startup writes usable defaults once and leaves optional choices unset', async () => {
  const store = memoryStore()
  const started = await open(store)
  expect(started.problem).toBeNull()
  expect(started.settings).toEqual(DEFAULT_SETTINGS)
  expect(started.settingsText).toContain('schema_version = 2')
  for (const key of SETTING_KEYS) expect(started.settingsText).toContain(`# Shift: ${key.about}\n`)
  expect(started.set.has('knowledge')).toBe(false)
  expect(started.set.has('files.owner')).toBe(false)
  expect(started.set.has('files.glossary')).toBe(false)
  const stamps = await store.stamps(R)
  expect((await open(store)).settingsText).toBe(started.settingsText)
  expect(await store.stamps(R)).toEqual(stamps)
})

test.each(['', 'schema_version = 0\n'])('upgrade from schema zero retains choices and removes retired keys', async version => {
  const store = memoryStore({
    [settingsPath]:
      version +
      '# Private rules\nknowledge = "split" # keep\nenabled = false\n[retired]\nvalue = 4\n[files]\nowner = ".shift/OWNER.md"\nshift = "docs/rules.md"\n[docs]\nmax_chars = 1\ndirs = ["docs", "AGENTS.md"]\ntoc = true',
    [`${ROOT}/docs/rules.md`]: 'Owner rules',
  })
  const current = await open(store)
  expect(current.problem).toBeNull()
  expect(current.settings).toMatchObject({
    enabled: false,
    knowledge: 'split',
    docs: { dirs: ['docs', 'AGENTS.md'], exclude: ['docs/rules.md'], toc: true },
  })
  expect(current.set.has('files.owner')).toBe(true)
  expect(current.settingsText).toContain('knowledge = "split" # keep')
  expect(current.settingsText).not.toMatch(/max_chars|\[retired\]|^shift =/m)
  expect(store.files.get(`${R}/SHIFT.md`)).toBe('Owner rules')
  expect((await open(store)).settingsText).toBe(current.settingsText)
})

test('a current sparse file keeps its layout and leaves newly unsupported entries until startup', async () => {
  const text = 'schema_version = 2\r\nenabled = false # keep\r\n'
  const store = memoryStore({ [settingsPath]: text })
  const annotated = (await open(store)).settingsText
  expect(annotated).toContain('enabled = false # keep\r\n')
  expect(annotated).not.toContain('[history]')
  store.files.set(settingsPath, `${annotated}retired = 5\r\n`)
  await loadProject(store, ROOT)
  expect(store.files.get(settingsPath)).toContain('retired')
  expect((await open(store)).settingsText).toBe(annotated)
})

test.each([
  'schema_version = 3\nfuture = 5',
  'schema_version = -1',
  'schema_version = 1.5',
  'enabled = "no"',
  'enabled false',
  '[files]\nshift = "/outside.md"',
  'schema_version = 1\nschema_version = 1',
])('a refused migration preserves the original file: %s', async source => {
  const store = memoryStore({ [settingsPath]: source })
  expect((await open(store)).problem).toBeTruthy()
  expect(store.files.get(settingsPath)).toBe(source)
})

test('initialization skips the previous skill layout and preserves unreadable files', async () => {
  const foreign = memoryStore({ [`${R}/sessions/example`]: '' })
  await open(foreign)
  expect(foreign.files.has(settingsPath)).toBe(false)
  const store = memoryStore({ [settingsPath]: 'private' })
  store.read = async () => null
  expect((await open(store)).problem).toContain('Cannot read')
  expect(store.files.get(settingsPath)).toBe('private')
})

test('a failed map import retries from the original schema and an existing internal map takes priority', async () => {
  const source = '[files]\nshift = "docs/former.md"'
  const former = `${ROOT}/docs/former.md`
  const store = memoryStore({ [settingsPath]: source, [former]: 'former rules' })
  const read = store.read
  store.read = path => (path === former ? Promise.resolve(null) : read(path))
  expect((await open(store)).problem).toContain('Cannot read the former map')
  store.files.set(settingsPath, `enabled = false\nretired = true\n${source}`)
  const disabled = await open(store)
  expect(disabled.problem).toContain('Cannot read the former map')
  expect((await startSession(disabled)).enabled).toBe(false)
  expect((await loadProject(store, ROOT)).settings.enabled).toBe(false)
  store.files.set(settingsPath, source)
  expect(store.files.get(settingsPath)).toBe(source)
  store.read = read
  store.files.set(`${R}/SHIFT.md`, 'current rules')
  expect((await open(store)).problem).toBeNull()
  expect(store.files.get(`${R}/SHIFT.md`)).toBe('current rules')
  expect(store.files.get(former)).toBe('former rules')
})

test.each([1, 4, 40])('schema 1 migrates the effective history limit %i and annotates existing optional examples once', async limit => {
  const store = memoryStore({
    [settingsPath]: `schema_version = 1\nhistory_limit = ${limit} # project choice\n# knowledge = "local"\n[files]\n# owner = ".shift/OWNER.md"\n`,
  })
  const started = await open(store)
  expect(started.settings.history).toEqual({ full: 1, brief: Math.min(10, limit) - 1 })
  expect(started.settingsText).not.toContain('history_limit')
  expect(started.settingsText).toContain('# project choice')
  expect(started.settingsText?.match(/^# knowledge =/gm)).toHaveLength(1)
  expect(started.settingsText?.match(/^# owner =/gm)).toHaveLength(1)
  expect((await open(store)).settingsText).toBe(started.settingsText)
})

test('a failed map upgrade can retry after a full session start with project documents', async () => {
  const store = memoryStore({
    [settingsPath]: '[files]\nshift = "docs/old.md"',
    [`${ROOT}/docs/old.md`]: '# Local owner rules',
    [`${ROOT}/docs/topic.md`]: '# Topic',
  })
  const read = store.read
  store.read = path => (path.endsWith('/docs/old.md') ? Promise.resolve(null) : read(path))
  const failed = await open(store)
  expect(failed.problem).toContain('Cannot read the former map')
  await startSession(failed)
  await sessionFiles(failed)
  expect(store.files.has(`${R}/SHIFT.md`)).toBe(false)
  store.read = read
  const retried = await open(store)
  expect(retried.problem).toBeNull()
  expect((await sessionFiles(retried)).find(f => f.path.endsWith('/SHIFT.md'))?.text).toContain('# Local owner rules')
})

test('settings migration keeps owner comments, including notes on removed keys', async () => {
  const store = memoryStore({
    [settingsPath]:
      '# Shift: team convention\nschema_version = 1 # owned by team 1\nretired = true # former option\n[unused] # table note\n# additional note\nold = 1 # trailing note',
  })
  const text = (await open(store)).settingsText
  for (const comment of [
    '# Shift: team convention',
    'schema_version = 2 # owned by team 1',
    '# former option',
    '# table note',
    '# additional note',
    '# trailing note',
  ])
    expect(text).toContain(comment)
  expect((await open(store)).settingsText).toBe(text)
})

test('a project note inserted next to generated help survives once with the help at its setting', async () => {
  const store = memoryStore()
  const first = (await open(store)).settingsText ?? ''
  const help = first.split('\n').find(line => line.startsWith('# Shift: true enables Shift'))
  store.files.set(settingsPath, first.replace('enabled = true', '# Shift: needed for delivery\nenabled = true'))
  const next = (await open(store)).settingsText ?? ''
  expect(next).toContain(`# Shift: needed for delivery\n${help}\nenabled = true`)
  expect(next.split(help ?? 'unexpected')).toHaveLength(2)
  expect((await open(store)).settingsText).toBe(next)
})

test('a retry imports the newly selected source after settings change during the map write', async () => {
  const source = '[files]\nshift = "docs/a.md"'
  const store = memoryStore({ [settingsPath]: source, [`${ROOT}/docs/a.md`]: 'rules A', [`${ROOT}/docs/b.md`]: 'rules B' })
  const write = store.write
  store.write = async (path, text, expected) => {
    await write(path, text, expected)
    if (path === `${R}/SHIFT.md`) store.files.set(settingsPath, source.replace('a.md', 'b.md'))
  }
  expect((await open(store)).problem).toContain('Settings changed')
  store.write = write
  await sessionFiles(await loadProject(store, ROOT))
  expect((await open(store)).problem).toBeNull()
  expect(store.files.get(`${R}/SHIFT.md`)).toBe('rules B')
  expect(store.files.get(settingsPath)).toContain('docs/b.md')
})

test('a restart finishes publishing the rules after the settings upgrade committed', async () => {
  const store = memoryStore({ [settingsPath]: '[files]\nshift = "docs/map.md"', [`${ROOT}/docs/map.md`]: 'saved rules' })
  const write = store.write
  store.write = async (path, text, expected) => {
    if (path === `${R}/SHIFT.md` && text === 'saved rules') throw new Error('interrupted')
    await write(path, text, expected)
  }
  expect((await open(store)).problem).toContain('interrupted')
  expect(store.files.get(settingsPath)).toContain('schema_version = 2')
  store.write = write
  expect((await open(store)).problem).toBeNull()
  expect(store.files.get(`${R}/SHIFT.md`)).toBe('saved rules')
})
