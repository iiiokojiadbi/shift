import { expect, test } from 'bun:test'
import { MAP_END, refreshDocs, renderMap } from '../src/docs'
import { acceptShift, sessionFiles } from '../src/flows'
import { checkGlossary } from '../src/glossary'
import { loadProject } from '../src/project'
import { readSaved } from '../src/saved'
import { DEFAULT_SETTINGS, type DocsSettings, parseSettings } from '../src/settings'
import type { Store } from '../src/store'
import { renderSessionFiles } from '../src/texts/prompts'
import { BOARD, LETTER, R, ROOT } from './fixtures'
import { memoryStore } from './memory'

const docsOf = (dirs: string[]) => ({ ...DEFAULT_SETTINGS.docs, dirs })

const at = (store: Store) => loadProject(store, ROOT)
const withDocs = async (store: Store, docs: DocsSettings) => ({ ...(await at(store)), settings: { ...DEFAULT_SETTINGS, docs } })
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
  const map = renderMap(many, docsOf(['docs']), [])
  expect(map.match(/ {2}sections: s$/gm)).toHaveLength(many.length)
  expect(map).toContain(`- \`docs/x/399.md\` — ${'d'.repeat(80)}\n  sections: s`)
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

test('every session gets SHIFT.md, OWNER.md, GLOSSARY.md and configured files, at the places the settings give', async () => {
  const store = memoryStore({
    [`${R}/settings.toml`]: '[files]\nowner = "OWNER.md"\nalways = ["OWNER.md", "always.md"]\n[docs]\ndirs = ["notes"]',
    [`${ROOT}/OWNER.md`]: '# Owner decisions\n\nnone',
    [`${ROOT}/always.md`]: 'none',
    [`${ROOT}/notes/n.md`]: '---\ndescription: N\n---',
  })
  const block = renderSessionFiles(await sessionFiles(await at(store))) ?? ''
  expect(block.split('<file path="OWNER.md">')).toHaveLength(2)
  expect(block).toContain('<file path="always.md">')
  expect(block).toContain('`notes/n.md` — N')
  expect(await sessionFiles(await at(memoryStore({ [`${R}/settings.toml`]: 'enabled = false', [`${ROOT}/always.md`]: 'none' })))).toEqual(
    [],
  )
  expect(parseSettings('[docs]\ndirs = ["../out"]')).toContain('folders or documents inside the project')
})

test('older boards still shift and knowledge refusals stay actionable', async () => {
  const call = { input: { letter: '.shift/letter.md', after: 'wait' as const, about: 'a' }, at: 0, sessionId: 's' }
  const base = {
    [`${R}/letter.md`]: LETTER,
    [`${R}/board.md`]: BOARD,
    [`${R}/OWNER.md`]: '# Owner decisions\n\nnone',
  }
  const deny = async (extra: Record<string, string>) => {
    const result = await acceptShift(await at(memoryStore({ ...base, ...extra })), call)
    return 'deny' in result ? result.deny : null
  }
  expect(await deny({})).toBeNull()
  expect(await deny({ [`${R}/board.md`]: '## Goal\nold goal\n## Decisions\nold choice\n## Dead ends\nnone' })).toBeNull()
  expect(await deny({ [`${R}/knowledge/glossary.md`]: '---\nkind: glossary\nabout: a\n---' })).toContain('GLOSSARY.md now')
})

test('saving a native shift uses only its own board and the configured owner file', async () => {
  const current = '# Owner decisions\n\n- Ship when tested.'
  const project = await at(
    memoryStore({
      [`${R}/letter.md`]: LETTER,
      [`${R}/board.md`]: BOARD,
      [`${R}/OWNER.md`]: current,
      [`${R}/owner.md`]: 'unrelated lowercase file',
      [`${ROOT}/.infinity-shift/board.md`]: 'unrelated folder',
    }),
  )
  const result = await acceptShift(project, { input: { letter: '.shift/letter.md', after: 'continue' }, sessionId: 's', at: 0 })
  if ('deny' in result) throw new Error(result.deny)
  const saved = await readSaved(project, result.shift.dir)
  expect(saved.files['OWNER.md']).toBe(current)
  expect(saved.files['board.md']).toBe(BOARD)
  expect(Object.values(saved.files)).not.toContain('unrelated lowercase file')
  expect(await project.store.read(`${R}/owner.md`)).toBe('unrelated lowercase file')
  expect(await project.store.read(`${ROOT}/.infinity-shift/board.md`)).toBe('unrelated folder')
})

test('a conflicting workspace is refused before writing its records or documentation', async () => {
  const call = { input: { letter: '.shift/letter.md', after: 'wait' as const }, at: 0, sessionId: 's' }
  const skill = memoryStore({ [`${R}/sessions/example/unfinished.md`]: 'x', [`${R}/SHIFT.md`]: 'keep', [`${ROOT}/docs/a.md`]: '# A' })
  const project = await at(skill)
  expect(await acceptShift(project, call)).toMatchObject({ deny: expect.stringContaining("shift skill's") })
  expect(await sessionFiles(project)).toEqual([])
  expect(skill.files.get(`${R}/SHIFT.md`)).toBe('keep')
})
