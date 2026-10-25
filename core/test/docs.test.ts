import { expect, test } from 'bun:test'
import { afterWrite, docOutline, docsMentioning, docsReport, outline, renderMap, withToc } from '../src/docs'
import { sessionFiles } from '../src/flows'
import { pinned } from '../src/markdown'
import { loadProject } from '../src/project'
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings'
import { setupReport } from '../src/setup'
import type { Store } from '../src/store'
import { renderSessionFiles } from '../src/texts/prompts'
import { R, ROOT } from './fixtures'
import { memoryStore } from './memory'

const at = (store: Store) => loadProject(store, ROOT)
const SETTINGS = `${R}/settings.toml`
const DOC = '---\ndescription: what A holds\n---\n\n# A\n\n## One\n> the first\n\n```\n## not a heading\n```\n\n### Deep\n\n## Two\n'

test('the outline and the toc: ## and ### outside fences, a > line as the note, the block under the title', () => {
  expect(outline(DOC).map(h => [h.level, h.title, h.note, h.line])).toEqual([
    [2, 'One', 'the first', 7],
    [3, 'Deep', '', 14],
    [2, 'Two', '', 16],
  ])
  const first = withToc(DOC) ?? ''
  expect(first).toContain('# A\n\n<!-- toc -->\n- One - the first\n  - Deep\n- Two\n<!-- /toc -->\n')
  expect(withToc(first)).toBe(first)
  expect(withToc(first.replace('## Two', '## Three'))).toContain('- Three\n<!-- /toc -->')
  expect(withToc('no title\n\n## One')).toBeNull()
})

test('settings: toc, limits and the files every session gets', () => {
  const parsed = parseSettings('[files]\nalways = ["docs/dates.md"]\n[docs]\ntoc = true\nmax_description = 200\nmax_lines = 150')
  expect(parsed).toMatchObject({
    settings: { files: { always: ['docs/dates.md'] }, docs: { toc: true, maxDescription: 200, maxLines: 150 } },
    set: new Set(['files.always', 'docs.toc', 'docs.max_description', 'docs.max_lines']),
  })
  expect(parseSettings('[docs]\nmax_lines = -1')).toContain('above 0')
  expect(parseSettings('[docs]\nnope = 1')).toContain('`docs.max_lines`')
})

test('after a write: the toc and the map follow the document, remarks once, silence when all is well', async () => {
  const store = memoryStore({
    [SETTINGS]: '[docs]\ntoc = true\nmax_description = 20\nmax_lines = 30',
    [`${ROOT}/docs/a.md`]: DOC,
    [`${ROOT}/docs/b.md`]: '---\ndescription: B\n---\n\n# B\n\n<!-- toc -->\n<!-- /toc -->\n\nSee [A](a.md) and docs/a.md.\n',
  })
  const first = await afterWrite(await at(store), `${ROOT}/docs/a.md`)
  expect(first).toContain('rewrote the toc of `docs/a.md`')
  expect(store.files.get(`${ROOT}/docs/a.md`)).toContain('<!-- toc -->\n- One - the first')
  expect(store.files.get(`${R}/SHIFT.md`)).toContain('`docs/a.md` — what A holds')
  expect(await afterWrite(await at(store), `${ROOT}/docs/a.md`)).toBeNull()
  expect(await afterWrite(await at(store), `${ROOT}/docs/b.md`)).toBeNull()

  store.files.set(
    `${ROOT}/docs/c.md`,
    `# C\n\n<!-- toc -->\n<!-- /toc -->\n${'x\n'.repeat(40)}[gone](../docs/gone.md), docs/old.md, docs/<name>.md`,
  )
  const remarks = (await afterWrite(await at(store), `${ROOT}/docs/c.md`)) ?? ''
  expect(remarks).toContain('no `description:`')
  expect(remarks).toContain('over `[docs] max_lines = 30`')
  expect(remarks).toContain('a link to `../docs/gone.md` that is not there')
  expect(remarks).toContain('a link to `docs/old.md`')
  expect(remarks).not.toContain('<name>')

  store.files.set(`${ROOT}/src/run.ts`, "// see docs/a.md and docs/missing.md\nconst x = '/abs/docs/elsewhere.md'")
  const code = (await afterWrite(await at(store), `${ROOT}/src/run.ts`)) ?? ''
  expect(code).toContain('`src/run.ts`: a link to `docs/missing.md` that is not there.')
  expect(code).not.toContain('elsewhere')
  expect(await afterWrite(await at(store), `${R}/board.md`)).toBeNull()

  store.files.set(SETTINGS, '[docs]\ndirs = []')
  expect(await afterWrite(await at(store), `${ROOT}/docs/c.md`)).toBeNull()
})

test('the report at a shift, the outline and mentions tools, and [files] always', async () => {
  const store = memoryStore({
    [SETTINGS]: '[files]\nalways = ["docs/dates.md"]\n[docs]\ntoc = true',
    [`${ROOT}/docs/a.md`]: DOC,
    [`${ROOT}/docs/dates.md`]: '---\ndescription: dates\n---\n\n# Dates\n\n| when | what |\n\nruns `fetch.js` daily',
    [`${ROOT}/AGENTS.md`]: 'map: docs/a.md, docs/gone.md',
    [`${R}/TASKS.md`]: 'none',
  })
  expect(await docsReport(await at(store))).toBe('- `AGENTS.md`: a link to `docs/gone.md` that is not there')

  const files = await sessionFiles(await at(store))
  expect(files.map(file => file.path)).toContain('docs/dates.md')
  expect(store.files.get(`${ROOT}/docs/a.md`)).toContain('<!-- toc -->')

  const head = await docOutline(await at(store), 'docs/a.md')
  expect(head).toContain('docs/a.md — ')
  expect(head).toContain('  what A holds')
  expect(head).toMatch(/\n {3,}\d+ {2}One - the first/)
  expect(head).toMatch(/\n {5,}\d+ {2}Deep/)
  expect(await docOutline(await at(store), 'docs/none.md')).toBe('No file at docs/none.md.')

  expect(await docsMentioning(await at(store), 'src/n8n/fetch.js')).toBe('`fetch.js` is mentioned in:\n- docs/dates.md')
  expect(await docsMentioning(await at(store), 'prefetch.js')).toBe('No document in `docs/` mentions `prefetch.js`.')
})

test('the setup report: every key with its value here and its version, and which session files changed', async () => {
  const store = memoryStore({
    [SETTINGS]: '[docs]\ntoc = true # the toc',
    [`${R}/OWNER.md`]: '# Owner decisions\n\nnone',
    [`${R}/TASKS.md`]: 'none',
  })
  const fresh = await setupReport(await at(store), null)
  expect(fresh).toContain('- `[docs] toc` = true — set here, since 0.5.0:')
  expect(fresh).toContain('- `[docs] max_lines` = unset — default, since 0.5.0:')
  expect(fresh).toContain('- `enabled` = true — default, since 0.2.9:')
  expect(fresh).toContain('- `.shift/OWNER.md`')
  expect(fresh).toContain("This session's block matches them.")
  expect(fresh).toContain('## Documents\n\nNo remarks.')
  expect(fresh).toContain('## Coming from the earlier layout')

  const loaded = renderSessionFiles(await sessionFiles(await at(store)))
  store.files.set(`${R}/OWNER.md`, '# Owner decisions\n\n## Scope\n\n- new')
  expect(await setupReport(await at(store), loaded)).toContain("Changed since this session's block was read: `.shift/OWNER.md`.")
  store.files.set(SETTINGS, 'enabled = maybe')
  expect(await setupReport(await at(store), null)).toContain('It does not parse')
})

test('the report after a shift folds the undescribed documents into one line and names at most ten others', async () => {
  const seed: Record<string, string> = { [`${R}/TASKS.md`]: 'none' }
  for (let i = 0; i < 30; i++) seed[`${ROOT}/docs/${String(i).padStart(2, '0')}.md`] = `# D\n\nsee [x](gone-${i}.md)`
  const report = (await docsReport(await at(memoryStore(seed)))) ?? ''
  expect(report.split('\n')[0]).toBe(
    '- 30 documents without `description:`: `docs/00.md`, `docs/01.md`, `docs/02.md` and the rest the map marks',
  )
  expect(report).toContain('- `docs/09.md`: a link to `gone-9.md` that is not there')
  expect(report).not.toContain('docs/10.md`:')
  expect(report.split('\n').at(-1)).toBe('- and 20 more documents with remarks: each comes after its next edit')
})

test('a document at the root named in [docs] dirs is kept like a folder of them', async () => {
  const store = memoryStore({
    [SETTINGS]: '[docs]\ndirs = ["docs", "AGENTS.md", "README.md"]\ntoc = true',
    [`${ROOT}/AGENTS.md`]: '---\ndescription: the map of the repo\n---\n\n# repo\n\n## Tree\n\nsee docs/gone.md',
    [`${ROOT}/docs/a.md`]: DOC,
  })
  const note = (await afterWrite(await at(store), `${ROOT}/AGENTS.md`)) ?? ''
  expect(note).toContain('rewrote the toc of `AGENTS.md`')
  expect(note).toContain('a link to `docs/gone.md` that is not there')
  expect(store.files.get(`${ROOT}/AGENTS.md`)).toContain('# repo\n\n<!-- toc -->\n- Tree\n<!-- /toc -->')
  const map = store.files.get(`${R}/SHIFT.md`) ?? ''
  expect(map).toContain('### ./\n\n- `AGENTS.md` — the map of the repo\n  sections: Tree')
  expect(map).toContain('### docs/\n\n- `docs/a.md` — what A holds')
  expect(map).toContain('Nothing to list:\n- `README.md` — no such file')
  expect(await docsMentioning(await at(store), 'docs/a.md')).toBe('No document in `docs/`, `AGENTS.md`, `README.md` mentions `a.md`.')
})

test('a > [!IMPORTANT] block is pinned under its document with its section, at every level of the map; past the limit it is told, never refused', async () => {
  const PINNED = [
    '---',
    'description: releases',
    '---',
    '',
    '# Dev',
    '',
    '> [!IMPORTANT]',
    '> Users get only tagged releases.',
    '',
    '## Release',
    '',
    '> [!IMPORTANT]',
    '> Tag first,',
    '> then the catalog.',
    '',
    '```md',
    '> [!IMPORTANT]',
    '> an example, not a pin',
    '```',
    '',
    '> [!NOTE]',
    '> not pinned either',
  ].join('\n')
  expect(pinned(PINNED)).toEqual([
    { section: null, text: 'Users get only tagged releases.' },
    { section: 'Release', text: 'Tag first,\nthen the catalog.' },
  ])

  const store = memoryStore({ [SETTINGS]: '[docs]\nmax_pinned = 30', [`${ROOT}/docs/dev.md`]: PINNED, [`${ROOT}/docs/a.md`]: DOC })
  const note = (await afterWrite(await at(store), `${ROOT}/docs/dev.md`)) ?? ''
  expect(note).toContain('Pinned: 59 characters, over `[docs] max_pinned = 30`')
  expect(await afterWrite(await at(store), `${ROOT}/docs/a.md`)).toBeNull()
  const map = store.files.get(`${R}/SHIFT.md`) ?? ''
  expect(map).toContain(
    '- `docs/dev.md` — releases\n  sections: Release\n  pinned:\n    · Users get only tagged releases.\n  pinned (Release):\n    · Tag first,\n    · then the catalog.',
  )
  expect(map).toContain('every block still shows')
  expect(await docsReport(await at(store))).toContain('- Pinned: 59 characters')

  const docs = [{ path: 'docs/dev.md', description: 'd'.repeat(500), sections: ['s'], pins: pinned(PINNED) }]
  const folders = renderMap(docs, { ...DEFAULT_SETTINGS.docs, maxChars: 50 }, [])
  expect(folders).toContain('- `docs/` — 1 docs: dev.md\n  `docs/dev.md`:\n    pinned:\n      · Users get only tagged releases.')
})
