import { expect, test } from 'bun:test'
import { afterWrite, atPrompt, type Courier, FRESH_LOOKS, type Looks } from '../src/delivery'
import { brokenLinks, docOutline, docsReport, MAP_END, MAP_START, settleDocs, withMap, withToc } from '../src/docs'
import { checkGlossary } from '../src/glossary'
import { FRESH_GAUGE, type GaugeKeeper, letGoGauge, offerHint } from '../src/hint'
import { segment } from '../src/history'
import { FRESH_LOOP, type LoopState } from '../src/loop'
import { findDate } from '../src/markdown'
import { parseSettings } from '../src/settings'
import { setupReport } from '../src/setup'
import { shiftNames } from '../src/store'
import { archiveInList, checkTaskList } from '../src/tasks'
import type { Gauge } from '../src/types'
import { R, ROOT, taskMd, WORK } from './fixtures'
import { memoryProject, memoryStore } from './memory'

// Cases the review of the documents found: owner text lost to a marker, links checked wrongly, a write left unchecked.

test('a marker named in a sentence or an example is the owner’s, never the block', () => {
  const shift = `# Shift\nThe marker begins with \`<!-- shift:docs\`.\n\nOWNER RULE\n\n${MAP_START}\nold map\n${MAP_END}\nOWNER TAIL\n`
  const out = withMap(shift, `${MAP_START}\nnew map\n${MAP_END}`)
  expect(out).toContain('OWNER RULE')
  expect(out).toContain('new map\n')
  expect(out).not.toContain('old map')
  expect(out).toContain('OWNER TAIL')

  const example = '# Guide\n\n```md\n<!-- toc -->\nKEEP THIS EXAMPLE\n<!-- /toc -->\n```\n\n## Actual\n'
  const toc = withToc(example) ?? ''
  expect(toc).toContain('KEEP THIS EXAMPLE')
  expect(toc).toStartWith('# Guide\n\n<!-- toc -->\n- Actual\n<!-- /toc -->\n')
})

test('a toc goes under the title, never into the frontmatter; a CRLF file keeps its line ends', () => {
  const meta = '---\n# metadata comment\ndescription: valid\n---\n\n# Title\n\n## Section\n'
  expect(withToc(meta)).toBe(
    '---\n# metadata comment\ndescription: valid\n---\n\n# Title\n\n<!-- toc -->\n- Section\n<!-- /toc -->\n\n## Section\n',
  )
  const crlf = withToc('# A\r\n\r\n## One\r\n') ?? ''
  expect(crlf).toBe('# A\r\n\r\n<!-- toc -->\r\n- One\r\n<!-- /toc -->\r\n\r\n## One\r\n')
  expect(withToc(crlf)).toBe(crlf)
})

test('links: relative in Markdown, outside fences, decoded, without query, by reference, never a URL', async () => {
  const store = memoryStore({ [`${ROOT}/docs/nested/docs/good.md`]: '# good', [`${ROOT}/docs/my guide.md`]: '# good' })
  const broken = (path: string, text: string) => brokenLinks(store, ROOT, path, text, ['docs'])
  expect(await broken('docs/nested/readme.md', '[good](docs/good.md)')).toEqual([])
  expect(await broken('docs/readme.md', '```md\n[example](missing.md)\n```')).toEqual([])
  expect(await broken('docs/readme.md', '[remote](//example.com/guide.md) [ok](https://example.com/a.md) [s](#s)')).toEqual([])
  expect(await broken('docs/readme.md', '[space](my%20guide.md)')).toEqual([])
  expect(await broken('docs/readme.md', '[missing](missing.md?raw=1)')).toEqual(['missing.md'])
  expect(await broken('docs/readme.md', '[x][ref]\n\n[ref]: gone.md')).toEqual(['gone.md'])
  expect(await broken('AGENTS.md', 'see `docs/gone.md`')).toEqual(['docs/gone.md'])
  expect(await broken('src/a.ts', '// docs/my guide.md is not a path: it has a space; docs/gone.md is')).toEqual(['docs/gone.md'])
})

test('a document at the root is reported once; `./docs` is the folder docs', async () => {
  const pinnedAgents = await memoryProject(
    {
      [`${R}/settings.toml`]: '[docs]\ndirs = ["AGENTS.md"]\nmax_pinned = 15',
      [`${ROOT}/AGENTS.md`]: '---\ndescription: good\n---\n# A\n\n> [!IMPORTANT]\n> 1234567890\n',
    },
    ROOT,
  )
  expect(await docsReport(pinnedAgents)).toBeNull()

  const dotted = await memoryProject(
    {
      [`${R}/settings.toml`]: '[docs]\ndirs = ["./docs/"]\ntoc = true',
      [`${ROOT}/docs/a.md`]: '---\ndescription: a\n---\n# A\n\n## One\n',
    },
    ROOT,
  )
  const settled = await settleDocs(dotted, ['docs/a.md'])
  expect(settled.lines[0]).toContain('docs/a.md')
})

test('a document written again before its note went is settled again', async () => {
  const project = await memoryProject({ [`${R}/settings.toml`]: '[docs]\ntoc = false', [`${ROOT}/docs/a.md`]: '# A' }, ROOT)
  let looks: Looks = FRESH_LOOKS
  let loop: LoopState = FRESH_LOOP
  let gauge: Gauge = { ...FRESH_GAUGE, whole: true }
  const courier: Courier = {
    project: async () => project,
    looks: async () => looks,
    updateLooks: async change => {
      looks = change(looks)
    },
    loop: {
      read: async () => loop,
      update: async change => {
        loop = change(loop)
      },
      tell: () => {},
    },
    gauge: {
      read: async () => gauge,
      update: async change => {
        gauge = change(gauge)
      },
      base: async () => null,
      history: async () => ({}),
      reading: async () => ({ tokens: undefined, window: 1_000_000, threshold: undefined }),
    },
  }
  await afterWrite(courier, `${ROOT}/docs/a.md`)
  const first = await atPrompt(courier, { runStarts: true, owner: true })
  expect(first.notes.join('')).toContain('no `description:`')
  await project.store.write(`${ROOT}/docs/a.md`, '# A\n\n[broken](gone.md)')
  await afterWrite(courier, `${ROOT}/docs/a.md`)
  await first.delivered()
  expect(looks.written).toEqual(['docs/a.md'])
  expect((await atPrompt(courier, { runStarts: true, owner: true })).notes.join('')).toContain('gone.md')
})

test('a hint offered before a let-go is not taken into the stretch after it', async () => {
  let gauge: Gauge = { ...FRESH_GAUGE, base: 20_000, hinted: 800_000, whole: true }
  let reset = true
  const keeper: GaugeKeeper = {
    read: async () => gauge,
    update: async change => {
      gauge = change(gauge)
      if (reset) {
        reset = false
        gauge = letGoGauge(true)
      }
    },
    history: async () => ({}),
    base: async () => 20_000,
    reading: async () => ({ tokens: 850_000, window: 1_000_000, threshold: undefined }),
  }
  const offered = await offerHint(keeper)
  await offered?.take()
  expect(gauge.unassisted).toBe(true)
  expect(gauge.hinted).toBeNull()
})

test('dates in names and ranges are found; versions and impossible days are not', () => {
  expect(findDate('see report-2026-10-26.md')).not.toBeNull()
  expect(findDate('2026-10-26-2026-10-27')).not.toBeNull()
  expect(findDate('v1.2.2026')).toBeNull()
  expect(findDate('build 2026-02-31')).toBeNull()
  expect(findDate('on 29.02.2028')).not.toBeNull()
})

test('two articles of one title clash; a needs joined by "and" keeps the task still open', () => {
  expect(checkGlossary('# Glossary\n\n## OAuth\nMeans: a.\n\n## OAuth\nMeans: b.\n', 'GLOSSARY.md')).toContain('in both')
  const row = (name: string) => `- [in progress] [${name}](tasks/${name}/) — ${name}`
  const list = `# Tasks\n\n${row('a')}\n  - needs: [b](tasks/b/) and [c](tasks/c/)\n${row('b')}\n${row('c')}\n`
  const left = archiveInList(list, 'b')
  expect(left).toContain('  - needs: [c](tasks/c/)\n  - after: [b](archive/b/)')
  expect(checkTaskList(left, ['a', 'c'], ['b'])).toBeNull()
})

test("the map's opener is the mod's whole comment; a link decodes every escape and may sit in angle brackets", async () => {
  const shift = `# Shift\n<!-- shift:docs --> marks the start of the map.\n\nOWNER RULE\n\n${MAP_START}\nold\n${MAP_END}\n`
  expect(withMap(shift, `${MAP_START}\nnew\n${MAP_END}`)).toContain('marks the start of the map.\n\nOWNER RULE\n\n')
  const store = memoryStore({ [`${ROOT}/docs/a#b.md`]: '# a' })
  expect(await brokenLinks(store, ROOT, 'docs/readme.md', '[ok](a%23b.md) [gone](<my guide.md>)', ['docs'])).toEqual(['my guide.md'])
})

test("a hint found by a change the harness ran again on a newer gauge is the last run's, or none", async () => {
  let gauge: Gauge = { ...FRESH_GAUGE, base: 20_000, hinted: 800_000, whole: true }
  let first = true
  const keeper: GaugeKeeper = {
    read: async () => gauge,
    // A compare-and-set that loses its first write: a tool's hint went meanwhile, and the change runs again.
    update: async change => {
      if (first) {
        first = false
        change(gauge)
        gauge = { ...gauge, hinted: 850_000 }
      }
      gauge = change(gauge)
    },
    history: async () => ({}),
    base: async () => 20_000,
    reading: async () => ({ tokens: 850_000, window: 1_000_000, threshold: undefined }),
  }
  expect(await offerHint(keeper)).toBeNull()
})

// Cases the review of the plumbing found.

test('settings: a key set twice, an unknown table, an empty item are refused; quoted commas and ./ are paths', () => {
  expect(parseSettings('enabled = false\nenabled = true')).toContain('set twice')
  expect(parseSettings('enabled = false\n[enabled]')).toContain('unknown table `[enabled]`')
  expect(parseSettings('[docs]\ndirs = [,]')).toContain('line 2')
  expect(parseSettings('[docs]\ndirs = ["docs,old", "x",]')).toMatchObject({ settings: { docs: { dirs: ['docs,old', 'x'] } } })
  expect(parseSettings('[files]\nowner = "./OWNER.md"')).toMatchObject({ settings: { files: { owner: 'OWNER.md' } } })
  expect(parseSettings('[docs]\ndirs = ["."]')).toContain('inside the project')
})

test("shift folders are the mod's names only; a closed item is known by its id when both have one", async () => {
  const project = await memoryProject({ [`${R}/shifts/20260102-030405/about.md`]: 'x', [`${R}/shifts/backup/letter.md`]: 'old' }, ROOT)
  expect(await shiftNames(project)).toEqual(['20260102-030405'])
  const work = (track: string) => ({ ...WORK, tasks: [{ name: 't', task: taskMd('T'), track, notes: [] }] })
  expect(segment({ work: work('- [done] #3 deploy'), index: null }, { work: work('- [done] #1 deploy'), index: null }).done).toEqual([
    't: #3 deploy',
  ])
})

test("the map's opener is one comment; a reference may sit in angle brackets; an outline reads an absolute path", async () => {
  const shift = `# Shift\n${MAP_START} explained <!-- note -->\n\nOWNER RULE\n\n${MAP_START}\nold\n${MAP_END}\n`
  expect(withMap(shift, `${MAP_START}\nnew\n${MAP_END}`)).toContain('OWNER RULE')
  const store = memoryStore({})
  expect(await brokenLinks(store, ROOT, 'docs/a.md', '[x][r]\n\n[r]: <my guide.md>', ['docs'])).toEqual(['my guide.md'])
  const project = await memoryProject({ '/elsewhere/guide.md': '# G\n\n## One\n' }, ROOT)
  expect(await docOutline(project, '/elsewhere/guide.md')).toContain('One')
})

test('shift_setup writes nothing, names what is missing, and moves its paths where the settings put them', async () => {
  const doc = '---\ndescription: d\n---\n# D\n\n## One\n'
  const project = await memoryProject(
    { [`${R}/settings.toml`]: '[docs]\ntoc = true\n[files]\nowner = "OWNER.md"', [`${ROOT}/docs/d.md`]: doc },
    ROOT,
  )
  const report = await setupReport(project, null)
  expect(await project.store.read(`${ROOT}/docs/d.md`)).toBe(doc)
  expect(report).toContain('None yet: none of')
  expect(report).toContain('→ `OWNER.md`, renamed as it is')
})

test('shift_setup: a file tag inside a record is no file; a moved record is named under the tree', async () => {
  const owner = '# Owner decisions\n\n```\n<file path="example.md">\n```\n'
  const project = await memoryProject(
    { [`${R}/settings.toml`]: '[files]\nowner = "rules/OWNER.md"', [`${ROOT}/rules/OWNER.md`]: owner, [`${R}/TASKS.md`]: 'none' },
    ROOT,
  )
  const loaded = `<file path="rules/OWNER.md">\n${owner.trim()}\n</file>\n\n<file path=".shift/TASKS.md">\nnone\n</file>`
  const report = await setupReport(project, loaded)
  expect(report).toContain("This session's block matches them.")
  expect(report).toContain('Moved by the settings: `.shift/OWNER.md` is at `rules/OWNER.md` here.')
})

test('a document a script changed gets its toc with the next prompt, once', async () => {
  const doc = '---\ndescription: d\n---\n# D\n\n## One\n'
  const project = await memoryProject({ [`${R}/settings.toml`]: '[docs]\ntoc = true', [`${ROOT}/docs/d.md`]: doc }, ROOT)
  let looks: Looks = FRESH_LOOKS
  let loop: LoopState = FRESH_LOOP
  let gauge: Gauge = { ...FRESH_GAUGE, whole: true }
  const courier: Courier = {
    project: async () => project,
    looks: async () => looks,
    updateLooks: async change => {
      looks = change(looks)
    },
    loop: {
      read: async () => loop,
      update: async change => {
        loop = change(loop)
      },
      tell: () => {},
    },
    gauge: {
      read: async () => gauge,
      update: async change => {
        gauge = change(gauge)
      },
      base: async () => null,
      history: async () => ({}),
      reading: async () => ({ tokens: undefined, window: 1_000_000, threshold: undefined }),
    },
  }
  expect((await atPrompt(courier, { runStarts: true, owner: true })).notes).toEqual([])
  await project.store.write(`${ROOT}/docs/d.md`, `${doc}\n## Two\n`)
  const after = await atPrompt(courier, { runStarts: true, owner: true })
  expect(after.notes.join('')).toContain('The mod wrote the toc of `docs/d.md`')
  await after.delivered()
  expect(await project.store.read(`${ROOT}/docs/d.md`)).toContain('<!-- toc -->\n- One\n- Two\n<!-- /toc -->')
  expect((await atPrompt(courier, { runStarts: true, owner: true })).notes).toEqual([])
})
