import { expect, test } from 'bun:test'
import { acceptShift } from '../src/flows'
import { loadProject } from '../src/project'
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings'
import { renderWork } from '../src/texts/prompts'
import { memoryStore } from './memory'

const ROOT = '/p'
const R = `${ROOT}/.shift`
const LETTER = ['## Where I am', 'x', '## Next', 'y', '## Unverified', 'none', '## Hold', 'h'].join('\n')
const BOARD = ['## Goal', 'g', '## Decisions', 'none', '## Dead ends', 'none'].join('\n')

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
  expect(parseSettings('[hints]\nsoft = 3')).toContain('unknown key `hints.soft`')
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
  expect(renderWork(work, null)).toContain('goes="here until the owner sets knowledge in .shift/settings.toml; ask them once"')
  expect(renderWork(work, 'project')).toContain('goes="to the project\'s docs')
})
