import { expect, test } from 'bun:test'
import { acceptShift } from '../src/flows'
import { atPlaces } from '../src/layout'
import { loadProject } from '../src/project'
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings'
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
  expect(parseSettings('commit = true')).toMatchObject({ settings: { ...DEFAULT_SETTINGS, commit: true } })
  expect(parseSettings('knowledge = "a # b"')).toContain('`knowledge` is one of')
})

test('a wrong value, an unknown key or a broken line is named', () => {
  expect(parseSettings('enabled = "no"')).toContain('`enabled` is true or false')
  expect(parseSettings('enable = false')).toContain('unknown key `enable`')
  expect(parseSettings('[hints]\nsoft = 3')).toContain('unknown table `[hints]`')
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
    [`${R}/TASKS.md`]: 'none',
  }
  const broken = await acceptShift(await loadProject(memoryStore({ ...files, [`${R}/settings.toml`]: 'knowledge = "docs"' }), ROOT), call)
  expect(broken).toEqual({ deny: expect.stringContaining('`knowledge` is one of') })

  const store = memoryStore({ ...files, [`${R}/settings.toml`]: 'knowledge = "split"' })
  const accepted = await acceptShift(await loadProject(store, ROOT), call)
  if ('deny' in accepted) throw new Error(accepted.deny)
  expect(store.files.get(`${accepted.shift.dir}/settings.toml`)).toBe('knowledge = "split"')
})

test('the map of knowledge says where knowledge goes', () => {
  const work = {
    board: BOARD,
    owner: null,
    tasks: [],
    knowledge: [],
    taskList: null,
    glossary: null,
    shift: null,
    archived: [],
    oldOwner: false,
  }
  expect(renderWork(work, null, '.shift/OWNER.md')).toContain(
    'goes="here until the owner sets knowledge in .shift/settings.toml; ask them once"',
  )
  expect(renderWork(work, 'project', '.shift/OWNER.md')).toContain('goes="to the project\'s docs')
})

test('a moved OWNER.md is named where it is: in refusals, the doctrine, the guide and the summarizer', async () => {
  const seed = {
    [`${R}/settings.toml`]: '[files]\nowner = "docs/OWNER.md"',
    [`${R}/letter.md`]: LETTER,
    [`${R}/board.md`]: BOARD,
    [`${R}/TASKS.md`]: 'none',
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
