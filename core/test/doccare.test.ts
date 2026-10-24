import { expect, test } from 'bun:test'
import { afterWrite, docOutline, docsMentioning, docsReport, outline, withToc } from '../src/doccare'
import { sessionFiles } from '../src/flows'
import { parseSettings } from '../src/settings'
import { setupReport } from '../src/setup'
import { renderSessionFiles } from '../src/texts/prompts'
import { memoryStore } from './memory'

const ROOT = '/p'
const R = `${ROOT}/.shift`
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
  expect(parsed).toMatchObject({ files: { always: ['docs/dates.md'] }, docs: { toc: true, maxDescription: 200, maxLines: 150 } })
  expect(parseSettings('[docs]\nmax_lines = -1')).toContain('above 0')
  expect(parseSettings('[docs]\nnope = 1')).toContain('`docs.max_lines`')
})

test('after a write: the toc and the map follow the document, remarks once, silence when all is well', async () => {
  const store = memoryStore({
    [SETTINGS]: '[docs]\ntoc = true\nmax_description = 20\nmax_lines = 30',
    [`${ROOT}/docs/a.md`]: DOC,
    [`${ROOT}/docs/b.md`]: '---\ndescription: B\n---\n\n# B\n\n<!-- toc -->\n<!-- /toc -->\n\nSee [A](a.md) and docs/a.md.\n',
  })
  const first = await afterWrite(store, ROOT, `${ROOT}/docs/a.md`)
  expect(first).toContain('rewrote the toc of `docs/a.md`')
  expect(store.files.get(`${ROOT}/docs/a.md`)).toContain('<!-- toc -->\n- One - the first')
  expect(store.files.get(`${R}/SHIFT.md`)).toContain('`docs/a.md` — what A holds')
  expect(await afterWrite(store, ROOT, `${ROOT}/docs/a.md`)).toBeNull()
  expect(await afterWrite(store, ROOT, `${ROOT}/docs/b.md`)).toBeNull()

  store.files.set(
    `${ROOT}/docs/c.md`,
    `# C\n\n<!-- toc -->\n<!-- /toc -->\n${'x\n'.repeat(40)}[gone](../docs/gone.md), docs/old.md, docs/<name>.md`,
  )
  const remarks = (await afterWrite(store, ROOT, `${ROOT}/docs/c.md`)) ?? ''
  expect(remarks).toContain('no `description:`')
  expect(remarks).toContain('over `[docs] max_lines = 30`')
  expect(remarks).toContain('a link to `../docs/gone.md` that is not there')
  expect(remarks).toContain('a link to `docs/old.md`')
  expect(remarks).not.toContain('<name>')

  store.files.set(`${ROOT}/src/run.ts`, "// see docs/a.md and docs/missing.md\nconst x = '/abs/docs/elsewhere.md'")
  const code = (await afterWrite(store, ROOT, `${ROOT}/src/run.ts`)) ?? ''
  expect(code).toContain('`src/run.ts`: a link to `docs/missing.md` that is not there.')
  expect(code).not.toContain('elsewhere')
  expect(await afterWrite(store, ROOT, `${R}/board.md`)).toBeNull()

  store.files.set(SETTINGS, '[docs]\ndirs = []')
  expect(await afterWrite(store, ROOT, `${ROOT}/docs/c.md`)).toBeNull()
})

test('the report at a shift, the outline and mentions tools, and [files] always', async () => {
  const store = memoryStore({
    [SETTINGS]: '[files]\nalways = ["docs/dates.md"]\n[docs]\ntoc = true',
    [`${ROOT}/docs/a.md`]: DOC,
    [`${ROOT}/docs/dates.md`]: '---\ndescription: dates\n---\n\n# Dates\n\n| when | what |\n\nruns `fetch.js` daily',
    [`${ROOT}/AGENTS.md`]: 'map: docs/a.md, docs/gone.md',
    [`${R}/TASKS.md`]: 'none',
  })
  expect(await docsReport(store, ROOT)).toBe('- `AGENTS.md`: a link to `docs/gone.md` that is not there')

  const files = await sessionFiles(store, ROOT)
  expect(files.map(file => file.path)).toContain('docs/dates.md')
  expect(store.files.get(`${ROOT}/docs/a.md`)).toContain('<!-- toc -->')

  const head = await docOutline(store, ROOT, 'docs/a.md')
  expect(head).toContain('docs/a.md — ')
  expect(head).toContain('  what A holds')
  expect(head).toMatch(/\n {3,}\d+ {2}One - the first/)
  expect(head).toMatch(/\n {5,}\d+ {2}Deep/)
  expect(await docOutline(store, ROOT, 'docs/none.md')).toBe('No file at docs/none.md.')

  expect(await docsMentioning(store, ROOT, 'src/n8n/fetch.js')).toBe('`fetch.js` is mentioned in:\n- docs/dates.md')
  expect(await docsMentioning(store, ROOT, 'prefetch.js')).toBe('No document in `docs/` mentions `prefetch.js`.')
})

test('the setup report: every key with its value here and its version, and which session files changed', async () => {
  const store = memoryStore({
    [SETTINGS]: '[docs]\ntoc = true # the toc',
    [`${R}/OWNER.md`]: '# Owner decisions\n\nnone',
    [`${R}/TASKS.md`]: 'none',
  })
  const fresh = await setupReport(store, ROOT, null)
  expect(fresh).toContain('- `[docs] toc` = true — set here, since 0.5.0:')
  expect(fresh).toContain('- `[docs] max_lines` = unset — default, since 0.5.0:')
  expect(fresh).toContain('- `enabled` = true — default, since 0.2.9:')
  expect(fresh).toContain('- `.shift/OWNER.md`')
  expect(fresh).toContain("This session's block matches them.")
  expect(fresh).toContain('## Coming from the earlier layout')

  const loaded = renderSessionFiles(await sessionFiles(store, ROOT))
  store.files.set(`${R}/OWNER.md`, '# Owner decisions\n\n## Scope\n\n- new')
  expect(await setupReport(store, ROOT, loaded)).toContain("Changed since this session's block was read: `.shift/OWNER.md`.")
  store.files.set(SETTINGS, 'enabled = maybe')
  expect(await setupReport(store, ROOT, null)).toContain('It does not parse')
})

test('the report after a shift folds the undescribed documents into one line and names at most ten others', async () => {
  const seed: Record<string, string> = { [`${R}/TASKS.md`]: 'none' }
  for (let i = 0; i < 30; i++) seed[`${ROOT}/docs/${String(i).padStart(2, '0')}.md`] = `# D\n\nsee [x](gone-${i}.md)`
  const report = (await docsReport(memoryStore(seed), ROOT)) ?? ''
  expect(report.split('\n')[0]).toBe(
    '- 30 documents without `description:`: `docs/00.md`, `docs/01.md`, `docs/02.md` and the rest the map marks',
  )
  expect(report).toContain('- `docs/09.md`: a link to `gone-9.md` that is not there')
  expect(report).not.toContain('docs/10.md`:')
  expect(report.split('\n').at(-1)).toBe('- and 20 more documents with remarks: each comes after its next edit')
})
