import { expect, test } from 'bun:test'
import { MAP_END, refreshDocs, renderMap } from '../src/docs'
import { acceptShift, archiveTask, sessionFiles } from '../src/flows'
import { checkGlossary } from '../src/glossary'
import { migrateRecords } from '../src/migration'
import { loadProject } from '../src/project'
import { usesNewStorage } from '../src/saved'
import { DEFAULT_SETTINGS, type DocsSettings, parseSettings } from '../src/settings'
import { readRecords, type Store } from '../src/store'
import { archiveInList, checkTaskList } from '../src/tasks'
import { renderSessionFiles } from '../src/texts/prompts'
import { BOARD, LETTER, R, ROOT, taskMd } from './fixtures'
import { memoryStore } from './memory'

const docsOf = (dirs: string[], maxChars = 100000) => ({ ...DEFAULT_SETTINGS.docs, dirs, maxChars })

const at = (store: Store) => loadProject(store, ROOT)
const withDocs = async (store: Store, docs: DocsSettings) => ({ ...(await at(store)), settings: { ...DEFAULT_SETTINGS, docs } })
const TASK = taskMd('T')
const LIST = [
  '# Tasks',
  '',
  '- [in progress] [adapters](tasks/adapters/) — the shift in other harnesses',
  '  - needs: [core](tasks/core/) — the port first',
  '  - continues: [old](archive/old/)',
  '- [deferred] [core](tasks/core/) — the storage port',
].join('\n')

test('an older client creating TASKS.md cannot switch an initialized project back to task files', async () => {
  for (const marker of ['history.db', 'migration.json']) {
    const store = memoryStore({ [`${R}/TASKS.md`]: 'none' })
    store.beads = async () => {
      throw new Error('Storage selection should only inspect paths.')
    }
    const project = await at(store)
    expect(await usesNewStorage(project)).toBe(false)
    await store.write(`${R}/beads/.beads/metadata.json`, 'metadata from sbd prime')
    expect(await usesNewStorage(project)).toBe(false)
    await store.write(`${R}/${marker}`, '')
    expect(await usesNewStorage(project)).toBe(true)
  }
})

test('the current owner file on a case-insensitive volume does not trigger legacy migration', async () => {
  const store = memoryStore({ [`${R}/board.md`]: BOARD, [`${R}/OWNER.md`]: 'current' })
  const project = await at({ ...store, exists: path => store.exists(path === `${R}/owner.md` ? `${R}/OWNER.md` : path) })
  expect(await readRecords(project)).toMatchObject({ owner: 'current', oldOwner: false })
})

test('invalid settings at cleanup keep the configured document in its legacy directory', async () => {
  const store = memoryStore({
    [`${R}/settings.toml`]: '[docs]\ndirs = [".shift/archive/handbook.md"]\ntypo = true',
    [`${R}/archive/handbook.md`]: 'working document',
    [`${R}/migration.json`]: JSON.stringify({ backup: 'legacy-backup-test', confirmed: {}, done: false }),
  })
  store.beads = async () => {
    throw new Error('Unexpected native operation during refused cleanup.')
  }
  const project = await at(store)
  await expect(migrateRecords(project, { action: 'cleanup', id: 's-0000000000000001' })).rejects.toThrow('settings.toml')
  expect(await store.read(`${R}/archive/handbook.md`)).toBe('working document')
})

test('TASKS.md lists every folder once, with links that lead somewhere', () => {
  const folders = ['adapters', 'core']
  expect(checkTaskList(LIST, folders, ['old'])).toBeNull()
  expect(checkTaskList(null, folders, [])).toContain('No .shift/TASKS.md')
  expect(checkTaskList(LIST, [...folders, 'extra'], ['old'])).toContain('missing from .shift/TASKS.md: extra')
  expect(checkTaskList(LIST, folders, [])).toContain('archive/old/, which is not there')
  expect(checkTaskList(LIST.replace('[in progress]', '[done]'), folders, ['old'])).toContain('without a status')
  expect(checkTaskList(LIST.replace('needs: [core](tasks/core/)', 'needs: [old](archive/old/)'), folders, ['old'])).toContain(
    'write "after:"',
  )
  expect(checkTaskList(`${LIST}\n  - needs: [adapters](tasks/adapters/)`, folders, ['old'])).toContain(
    'in a circle: adapters → core → adapters',
  )
  expect(checkTaskList(LIST.replace('[adapters](tasks/adapters/)', '[adapter](tasks/adapters/)'), folders, ['old'])).toContain('differ')
  expect(checkTaskList('none', [], [])).toBeNull()
})

test('archiving takes the task out of TASKS.md and points the links into the archive', () => {
  const after = archiveInList(LIST, 'core')
  expect(after).not.toContain('[deferred] [core]')
  expect(after).toContain('  - after: [core](archive/core/) — the port first')
  expect(archiveInList(archiveInList(LIST, 'core'), 'adapters')).toBe('# Tasks\n\nnone\n')
})

test('the glossary: one article a word, Means present, an avoided word used nowhere', () => {
  const where = 'GLOSSARY.md'
  const good =
    '# Glossary\n\n## Shift\nVariants: shifts\nMeans: the boundary between stretches.\nAvoid: compaction\n\n## ОПЕРУ\nMeans: old name of УРПЗ.\nUnconfirmed: is it renamed already?'
  expect(checkGlossary(good, where)).toBeNull()
  expect(checkGlossary('## Shift\nVariants: x', where)).toContain('no "Means:"')
  expect(checkGlossary('## Shift\nMeans: a\nSee: b', where)).toContain('not a signed line')
  expect(checkGlossary(`${good}\n\n## Shifts\nMeans: dup`, where)).toContain('"Shifts" is in both "Shift" and "Shifts"')
  expect(checkGlossary(`${good}\n\n## Compaction\nMeans: the harness's own let-go.`, where)).toContain('says to avoid "compaction"')
})

test('the docs map lists each document with its description and sections, and rewrites only its block', async () => {
  const store = memoryStore({
    [`${ROOT}/docs/a.md`]: '---\ndescription: what A holds\n---\n\n# A\n\n## One\n\n```\n## not a heading\n```\n\n## Two',
    [`${ROOT}/docs/deep/b.md`]: '# B',
  })
  await refreshDocs(await withDocs(store, docsOf(['docs'])))
  const first = store.files.get(`${R}/SHIFT.md`) ?? ''
  expect(first).toContain('- `docs/a.md` — what A holds\n  sections: One · Two')
  expect(first).toContain('- `docs/deep/b.md` — no description')

  store.files.set(`${R}/SHIFT.md`, first.replace('# Shift', '# Shift\n\nMY RULES'))
  store.files.set(`${ROOT}/docs/c.md`, '---\ndescription: C\n---')
  await refreshDocs(await withDocs(store, docsOf(['docs'])))
  const second = store.files.get(`${R}/SHIFT.md`) ?? ''
  expect(second).toContain('MY RULES')
  expect(second).toContain('`docs/c.md` — C')
  expect(second.split(MAP_END).length).toBe(2)

  const many = Array.from({ length: 400 }, (_, i) => ({ path: `docs/x/${i}.md`, description: 'd'.repeat(80), sections: ['s'], pins: [] }))
  const map = renderMap(many, docsOf(['docs'], 24000), [])
  expect(map.match(/ {2}sections: s$/gm)).toHaveLength(many.length)
  expect(map).toContain(`- \`docs/x/399.md\` — ${'d'.repeat(80)}\n  sections: s`)
  expect(parseSettings('[docs]\nmax_chars = 0')).toContain('above 0')
})

test('a folder with nothing to list is named as missing or empty; with no SHIFT.md and no documents nothing is written', async () => {
  const store = memoryStore({ [`${R}/SHIFT.md`]: '# Shift\n\nMY RULES' })
  await refreshDocs(await withDocs(store, docsOf(['docs/'])))
  const shift = store.files.get(`${R}/SHIFT.md`) ?? ''
  expect(shift).toContain('MY RULES')
  expect(shift).toContain('## Documents\n\nnone:\n- `docs/` — no such folder')
  expect(shift).not.toContain('Open a document')

  store.files.set(`${ROOT}/notes/n.md`, '# N')
  store.files.set(`${ROOT}/empty/.keep`, '')
  await refreshDocs(await withDocs(store, docsOf(['docs', 'notes', 'empty'])))
  const some = store.files.get(`${R}/SHIFT.md`) ?? ''
  expect(some).toContain('`notes/n.md`')
  expect(some).toContain('Nothing to list:\n- `docs/` — no such folder\n- `empty/` — no documents')

  await refreshDocs(await withDocs(store, docsOf([])))
  const off = store.files.get(`${R}/SHIFT.md`) ?? ''
  expect(off).toContain('## Documents\n\noff: the owner set `[docs] dirs = []`')
  expect(off).not.toContain('notes/n.md')

  const bare = memoryStore()
  await refreshDocs(await withDocs(bare, docsOf(['docs'])))
  expect(bare.files.size).toBe(0)
})

test('every session gets SHIFT.md, OWNER.md, GLOSSARY.md and TASKS.md, at the places the settings give', async () => {
  const store = memoryStore({
    [`${R}/settings.toml`]: '[files]\nowner = "OWNER.md"\nalways = ["OWNER.md", ".shift/TASKS.md"]\n[docs]\ndirs = ["notes"]',
    [`${ROOT}/OWNER.md`]: '# Owner decisions\n\nnone',
    [`${R}/TASKS.md`]: 'none',
    [`${ROOT}/notes/n.md`]: '---\ndescription: N\n---',
  })
  const block = renderSessionFiles(await sessionFiles(await at(store))) ?? ''
  expect(block.split('<file path="OWNER.md">')).toHaveLength(2)
  expect(block).toContain('<file path=".shift/TASKS.md">')
  expect(block).toContain('`notes/n.md` — N')
  expect(await sessionFiles(await at(memoryStore({ [`${R}/settings.toml`]: 'enabled = false', [`${R}/TASKS.md`]: 'none' })))).toEqual([])
  expect(parseSettings('[docs]\ndirs = ["../out"]')).toContain('folders or documents inside the project')
})

test('a shift refuses the old owner.md, a board with Tasks, continues in task.md and a rejected option without its reason', async () => {
  const call = { input: { letter: '.shift/letter.md', after: 'wait' as const, about: 'a' }, at: 0, sessionId: 's' }
  const base = {
    [`${R}/letter.md`]: LETTER,
    [`${R}/board.md`]: BOARD,
    [`${R}/OWNER.md`]: '# Owner decisions\n\nnone',
    [`${R}/TASKS.md`]: '- [in progress] [t](tasks/t/) — t',
    [`${R}/tasks/t/task.md`]: TASK,
    [`${R}/tasks/t/track.md`]: '- [open] x',
  }
  const deny = async (extra: Record<string, string>) => {
    const result = await acceptShift(await at(memoryStore({ ...base, ...extra })), call)
    return 'deny' in result ? result.deny : null
  }
  expect(await deny({})).toBeNull()
  expect(await deny({ [`${R}/owner.md`]: 'x' })).toContain('owner.md is the old name')
  expect(await deny({ [`${R}/board.md`]: `${BOARD}\n## Tasks\n- [in progress] t — t` })).toContain('Preserve any task details')
  expect(await deny({ [`${R}/tasks/t/task.md`]: TASK.replace('# T', '# T\ncontinues: .shift/archive/x/') })).toContain(
    'continues: [<name>](archive/<name>/)',
  )
  expect(await deny({ [`${R}/board.md`]: BOARD.replace('## Decisions\nnone', '## Decisions\n- A — b; rejected: C') })).toContain(
    'needs its reason',
  )
  expect(await deny({ [`${R}/knowledge/glossary.md`]: '---\nkind: glossary\nabout: a\n---' })).toContain('GLOSSARY.md now')
})

test('task_archive writes the index line with what the task continued, and updates TASKS.md', async () => {
  const store = memoryStore({
    [`${R}/TASKS.md`]: '- [in progress] [t](tasks/t/) — t\n  - continues: [old](archive/old/)',
    [`${R}/tasks/t/task.md`]: TASK,
    [`${R}/tasks/t/track.md`]: '- [done] x',
    [`${R}/archive/old/task.md`]: TASK,
  })
  await archiveTask(await at(store), { name: 't', outcome: 'done', about: 'it ended.' })
  expect(store.files.get(`${R}/archive/index.md`)).toContain('— it ended; continues old')
  expect(store.files.get(`${R}/TASKS.md`)).toBe('none\n')
})

test('the old folder name and the shift skill folder are named, and nothing is written into them', async () => {
  const call = { input: { letter: '.shift/letter.md', after: 'wait' as const, about: 'a' }, at: 0, sessionId: 's' }
  const old = memoryStore({ [`${ROOT}/.infinity-shift/board.md`]: BOARD })
  expect(await acceptShift(await at(old), call)).toEqual({ deny: expect.stringContaining('rename the folder to .shift/') })

  const skill = memoryStore({
    [`${R}/sessions/2026-10-01/unfinished.md`]: 'x',
    [`${R}/SHIFT.md`]: '# the skill',
    [`${ROOT}/docs/a.md`]: '# A',
  })
  expect(await acceptShift(await at(skill), call)).toEqual({ deny: expect.stringContaining("the shift skill's") })
  expect(await sessionFiles(await at(skill))).toEqual([])
  expect(skill.files.get(`${R}/SHIFT.md`)).toBe('# the skill')
})
