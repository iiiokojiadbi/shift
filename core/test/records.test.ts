import { expect, test } from 'bun:test'
import {
  addGrowth,
  addToIndex,
  checkArchive,
  checkLetter,
  compactInstructions,
  contentChars,
  FRESH_GAUGE,
  frontmatter,
  indexLine,
  knowledgeMap,
  OUTCOME,
  parseArchiveInput,
  parseHistoryCount,
  parseShiftInput,
  readAbout,
  renderAbout,
  renderHistory,
  renderRecent,
  renderStatus,
  sections,
  segment,
  shiftDir,
  shiftFill,
  shiftHint,
} from '../src/index'
import { BOARD, boardWith, check, LETTER, listWith, OWNER, TESTS, TRAPS, taskMd, WORK } from './fixtures'

// The checks of the records, about.md and the history, the hint rule and the texts: pure logic over plain values.

test('parseShiftInput refuses an empty letter, an unknown after and a bad about', () => {
  expect(parseShiftInput({ letter: ' ', after: 'wait', about: 'a' })).toContain('letter')
  expect(parseShiftInput({ letter: 'l.md', after: 'later', about: 'a' })).toContain('after')
  expect(parseShiftInput({ letter: 'l.md', after: 'wait', about: '' })).toContain('about')
  expect(parseShiftInput({ letter: 'l.md', after: 'wait', about: 'a\nb' })).toContain('one line')
  expect(parseShiftInput({ letter: 'l.md', after: 'wait', about: 'x'.repeat(401) })).toContain('401')
  expect(parseShiftInput({ letter: ' l.md ', after: 'continue', about: ' a ' })).toEqual({ letter: 'l.md', after: 'continue', about: 'a' })
})

test('about.md lists what the tracks closed in this stretch, what was archived and what is open', () => {
  const previous = {
    work: { ...WORK, tasks: [{ ...TESTS, track: '- [done] schema — applied\n- [in progress] webhooks' }] },
    index: null,
  }
  const now = {
    work: {
      ...WORK,
      taskList: listWith(['- [in progress] [tests](tasks/tests/) — red', '- [deferred] [refunds](tasks/refunds/) — waits for the API']),
      tasks: [{ ...TESTS, track: '- [done] schema — applied\n- [done] webhooks — HMAC\n- [dropped] retries — the provider does it' }],
    },
    index: '# Archive\n\n- [done] [Old](old/) — finished',
  }
  const seg = segment(now, previous)
  expect(seg).toEqual({
    done: ['tests: webhooks — HMAC'],
    dropped: ['tests: retries — the provider does it'],
    archived: ['[done] [Old](old/) — finished'],
    open: ['[in progress] [tests](tasks/tests/) — red', '[deferred] [refunds](tasks/refunds/) — waits for the API'],
  })
  const about = renderAbout({ about: 'webhooks ready', sessionId: 's', at: 0, after: 'wait', segment: seg, result: 'pending' })
  expect(about).toContain('description: webhooks ready')
  expect(about).toContain('## Done\n\n- tests: webhooks — HMAC')
  expect(about).toContain('## Archived\n\n- [done] [Old](old/) — finished')
  expect(about).toContain('tokens: unknown')
})

test('the letter needs every section, none empty', () => {
  expect(checkLetter(LETTER)).toBeNull()
  expect(checkLetter('## Where I am\nhere')).toContain('"## Next"')
  expect(checkLetter(LETTER.replace('none', ''))).toContain('"Unverified"')
  expect(sections(LETTER).get('Hold')).toBe('HOLD-THIS')
})

test('the board is a state, not a diary', () => {
  expect(check(WORK, null)).toBeNull()
  expect(check({ ...WORK, board: '## Goal\nmod' }, null)).toContain('"## Decisions"')
  expect(check({ ...WORK, board: boardWith(['- tests go first, 2026-10-23']) }, null)).toContain('date')
  expect(check({ ...WORK, taskList: listWith(['- [done] [tests](tasks/tests/) — red']) }, null)).toContain('task_archive')
  const long = boardWith(Array.from({ length: 200 }, (_, i) => `- decision ${i}`))
  expect(check({ ...WORK, board: long }, null)).toContain('diary')
  expect(check({ ...WORK, board: `${BOARD}\n## Owner decisions\nnone` }, null)).toContain('live in .shift/OWNER.md')
  expect(check({ ...WORK, board: boardWith(['- one port — two adapters; rejected: copies']) }, null)).toContain('needs its reason')
  expect(check({ ...WORK, board: boardWith(['- one port — two adapters; rejected: copies — they drift']) }, null)).toBeNull()
})

test("the owner's decisions are a code of rules beside the board", () => {
  expect(check({ ...WORK, owner: null }, null)).toContain('No .shift/OWNER.md')
  expect(check({ ...WORK, owner: ' ' }, null)).toContain('"none"')
  expect(check({ ...WORK, owner: `${OWNER} (19.10.2026)` }, null)).toContain('rewrites the older line')
  const long = Array.from({ length: 160 }, (_, i) => `- rule ${i}`).join('\n')
  expect(check({ ...WORK, owner: long }, null)).toContain('a log')
  expect(check({ ...WORK, owner: 'none' }, null)).toBeNull()
})

test('knowledge files have a kind, an about, their entry fields and room', () => {
  const file = (name: string, text: string) => check({ ...WORK, knowledge: [{ name, text }] }, null)
  expect(file('traps.md', TRAPS)).toBeNull()
  expect(file('traps-tooling.md', TRAPS)).toBeNull()
  expect(file('notes.md', TRAPS.replace('kind: traps', 'kind: notes'))).toContain('one of traps, lessons, runbook, facts')
  expect(file('lessons.md', TRAPS)).toContain('traps.md or traps-<topic>.md')
  expect(file('traps.md', TRAPS.replace(/about: .*/, 'about:'))).toContain('"about"')
  expect(file('traps.md', TRAPS.replace('**Do.**', 'Do:'))).toContain('"### The script stopped on the third replacement"')
  expect(file('traps.md', `${TRAPS}\n\nConfirmed 2026-10-19.`)).toContain('date')
  expect(file('traps.md', `${TRAPS}\n${'x\n'.repeat(400)}`)).toContain('split the rest by topic')
  const runbook = '---\nkind: runbook\nabout: commands\n---\n\n### Check\n\n**Shows.** green.'
  expect(file('runbook.md', runbook)).toContain('a command block')
  expect(file('runbook.md', runbook.replace('**Shows.**', '    bun run check\n\n**Shows.**'))).toBeNull()
  expect(file('facts.md', '---\nkind: facts\nabout: how the harness behaves\n---\n\n### Plugins load from the cache\n\nA copy.')).toContain(
    '"**Source.**"',
  )
  expect(file('glossary.md', '---\nkind: glossary\nabout: terms\n---\n\n- **shift** — the boundary')).toContain('GLOSSARY.md now')
  expect(knowledgeMap(WORK.knowledge)).toBe('- .shift/knowledge/traps.md — traps of edits and tests; lessons — lessons.md (1 entries)')
})

test('TASKS.md and the task folders match, and each task is whole', () => {
  expect(check({ ...WORK, tasks: [] }, null)).toContain('without a folder')
  expect(check({ ...WORK, tasks: [TESTS, { ...TESTS, name: 'extra' }] }, null)).toContain('missing from .shift/TASKS.md: extra')
  expect(check({ ...WORK, tasks: [{ ...TESTS, track: null }] }, null)).toContain('no track.md')
  expect(check({ ...WORK, tasks: [{ ...TESTS, task: '## Goal\ng' }] }, null)).toContain('title')
  expect(check({ ...WORK, tasks: [{ ...TESTS, task: '# T\n## Goal\ng' }] }, null)).toContain('"## Done when"')
  expect(check({ ...WORK, tasks: [{ ...TESTS, track: '- fix it' }] }, null)).toContain('Track items without a status')
  expect(check({ ...WORK, tasks: [{ ...TESTS, track: '- [done] fixed 23.10.2026' }] }, null)).toContain('date')
})

test('something must change between shifts, on the board or in a task', () => {
  expect(check(WORK, WORK)).toContain('Nothing changed')
  expect(check({ ...WORK, tasks: [{ ...TESTS, track: '- [done] fix the parser' }] }, WORK)).toBeNull()
  expect(check({ ...WORK, owner: 'none' }, WORK)).toBeNull()
  expect(check({ ...WORK, knowledge: [] }, WORK)).toBeNull()
})

test('archiving: done needs every item closed, the index line carries the title and the links', () => {
  expect(parseArchiveInput({ name: 'Tests!', outcome: 'done', about: 'a' })).toContain('name')
  expect(parseArchiveInput({ name: 'tests', outcome: 'later', about: 'a' })).toContain('outcome')
  const input = { name: 'tests', outcome: 'done' as const, about: 'green' }
  expect(checkArchive(input, TESTS, false)).toContain('Not every item is closed')
  expect(checkArchive({ ...input, outcome: 'dropped' }, TESTS, false)).toBeNull()
  expect(checkArchive(input, TESTS, true)).toContain('already exists')
  expect(checkArchive(input, { ...TESTS, task: null }, false)).toContain('task.md is missing')

  const line = indexLine(input, taskMd('Green tests'), ['old-tests', 'parser'])
  expect(line).toBe('- [done] [Green tests](tests/) — green; continues old-tests, parser')
  const index = addToIndex(null, line)
  expect(index).toContain('# Archive')
  expect(addToIndex(index, '- [dropped] [X](x/) — no')).toMatch(/green; continues old-tests, parser\n- \[dropped\]/)
})

test('the summarizer gets the hold and is told not to plan', () => {
  const text = compactInstructions({ hold: 'goal: ship the mod', board: '/b.md', owner: '/OWNER.md', dir: '/d' })
  expect(text).toContain('goal: ship the mod')
  expect(text).toContain('Do not write next steps')
  expect(text).not.toContain('working on now')
  const focused = compactInstructions({
    hold: 'h',
    board: '/b.md',
    owner: '/OWNER.md',
    dir: '/d',
    focus: ['delivery: the core; pi', 'unify'],
  })
  expect(focused).toContain('fuller than the rest:\n- delivery: the core; pi\n- unify\n\nWhat the agent asked to hold:')
})

test('shiftDir names the folder by UTC time', () => {
  expect(shiftDir('/proj', Date.UTC(2026, 9, 23, 14, 5, 9))).toBe('/proj/.shift/shifts/20261023-140509')
})

test('hints: soft every max(100K, 25%) of the limit, none right before the final, final at 80% and every 5% after', () => {
  let gauge = FRESH_GAUGE
  const step = (tokens: number | undefined, window: number, threshold?: number) => {
    const hint = shiftHint(gauge, { tokens, window, threshold })
    gauge = hint.gauge
    return hint.text
  }
  const big = (tokens: number | undefined) => step(tokens, 1_000_000)

  expect(big(undefined)).toBeNull()
  expect(big(20_000)).toBeNull()
  expect(big(200_000)).toBeNull()
  expect(big(270_000)).toContain('grown by 250K')
  expect(big(300_000)).toBeNull()
  expect(big(520_000)).toContain('grown by 500K')
  expect(big(770_000)).toBeNull()
  expect(big(800_000)).toContain('800K of 1000K used')
  expect(big(820_000)).toBeNull()
  expect(big(850_000)).toContain('850K of 1000K')

  gauge = FRESH_GAUGE
  const mid = (tokens: number) => step(tokens, 272_000)
  expect(mid(9_000)).toBeNull()
  expect(mid(109_000)).toContain('grown by 100K')
  expect(mid(209_000)).toBeNull()
  expect(mid(218_000)).toContain('218K of 272K')

  gauge = FRESH_GAUGE
  const small = (tokens: number) => step(tokens, 200_000, 128_000)
  expect(small(9_000)).toBeNull()
  expect(small(100_000)).toBeNull()
  expect(small(103_000)).toContain('103K of 128K')

  gauge = FRESH_GAUGE
  expect(big(850_000)).toBeNull()
  expect(big(855_000)).toBeNull()
  expect(big(900_000)).toContain('900K of 1000K')

  gauge = { ...FRESH_GAUGE, unassisted: true }
  expect(big(undefined)).toBeNull()
  expect(big(40_000)).toContain('without your shift')
  expect(big(41_000)).toBeNull()

  gauge = FRESH_GAUGE
  expect(big(280_000)).toBeNull()
  expect(renderStatus(gauge, { tokens: 70_000, window: 1_000_000, threshold: undefined })).toContain('next soft hint at 320K')
  expect(big(70_000)).toBeNull()
  expect(big(310_000)).toBeNull()
  expect(big(320_000)).toContain('grown by 250K')
})

test('a hint and the status name what the history grew from', () => {
  expect(contentChars([{ type: 'text', text: 'abcd' }, { type: 'tool_use', input: { a: 1 } }, { type: 'image' }])).toBe(4 + 7 + 6000)
  expect(contentChars([{ type: 'tool_result', content: [{ type: 'text', text: 'xyz' }] }])).toBe(3)

  let gauge = addGrowth(addGrowth(addGrowth(FRESH_GAUGE, 'Read', 600), 'Bash', 300), 'your responses', 30)
  gauge = addGrowth(gauge, 'Read', 70)
  gauge = shiftHint(gauge, { tokens: 20_000, window: 1_000_000, threshold: undefined }).gauge
  expect(shiftHint(gauge, { tokens: 270_000, window: 1_000_000, threshold: undefined }).text).toContain('Mostly from: Read 67%, Bash 30%.')

  const status = renderStatus(gauge, { tokens: 300_000, window: 1_000_000, threshold: 800_000 })
  expect(status).toContain('Used: 300K of 1000K window; the harness lets the history go by itself at 800K.')
  expect(status).toContain('Since the last shift: +280K.')
  expect(status).toContain('next soft hint at 220K; final at 640K.')
  expect(status).toContain('Grown mostly from: Read 67%, Bash 30%.')
  expect(renderStatus(FRESH_GAUGE, { tokens: undefined, window: 1_000_000, threshold: undefined })).toContain('No reading yet')
})

test('history: count defaults to 10, entries read oldest first, the last one shows what is open', () => {
  expect(parseHistoryCount({})).toBe(10)
  expect(parseHistoryCount({ count: 0 })).toContain('count')
  const seg = { done: ['tests: webhooks'], dropped: [], archived: ['[done] [Old](old/) — finished'], open: ['[in progress] refunds'] }
  const about = renderAbout({ about: 'webhooks ready', sessionId: 's', at: 0, after: 'wait', segment: seg, result: 'pending' })
  expect(frontmatter(about).get('description')).toBe('webhooks ready')
  const text = renderHistory(
    [
      { name: 'a', about: null },
      { name: 'b', about },
    ],
    7,
  )
  expect(text).toContain('2 of 7')
  expect(text).toContain('### b · wait · pending')
  expect(text).toContain('Done: tests: webhooks')
  expect(text).toContain('Archived: [done] [Old](old/) — finished')
  expect(text).toContain('Open: [in progress] refunds')
  expect(renderHistory([], 0)).toContain('No shifts')
})

test('recent shifts: descriptions oldest first, a pointer to the earlier ones, no wait or continue', () => {
  const about = (description: string, after: 'wait' | 'continue') =>
    renderAbout({
      about: description,
      sessionId: 's',
      at: 0,
      after,
      segment: { done: [], dropped: [], archived: [], open: [] },
      result: 'pending',
    })
  const text = renderRecent({
    entries: [
      { name: 'a', about: about('parser started', 'wait') },
      { name: 'b', about: about('parser done', 'continue') },
    ],
    total: 14,
  })
  expect(text).toContain('12 shifts before them are not listed: shift_history reads them')
  expect(text.indexOf('- a · parser started')).toBeLessThan(text.indexOf('- b · parser done'))
  expect(text.indexOf('12 shifts before')).toBeLessThan(text.indexOf('<shifts>'))
  expect(text).not.toMatch(/wait|continue/)
  const one = renderRecent({ entries: [{ name: 'a', about: null }], total: 2 })
  expect(one).toContain('the last 1 shift, oldest first')
  expect(one).toContain('1 shift before them is not listed')
  expect(renderRecent({ entries: [{ name: 'a', about: null }], total: 1 })).not.toContain('not listed')
})

test('about.md is read back by one reader: the base of a fill under 1K too, only from a shift of this session that let go', () => {
  const about = (result: string, tokens: string) =>
    `---\ndescription: d\nafter: wait\nresult: ${result}\ntokens: ${tokens}\nsession: s1\n---\n`
  expect(shiftFill(about(OUTCOME.waiting('2K → 950', 'waiting for the owner'), '2K → 950'), 's1')).toBe(950)
  expect(shiftFill(about(OUTCOME.continuing('300K → 20K'), '300K → 20K'), 's1')).toBe(20_000)
  expect(shiftFill(about(OUTCOME.continuing('300K → 20K'), '300K → 20K'), 's2')).toBeNull()
  expect(shiftFill(about(OUTCOME.unsettled('disk'), '300K → 20K'), 's1')).toBeNull()
  expect(readAbout(about(OUTCOME.pending, 'unknown'))).toMatchObject({ description: 'd', after: 'wait', shifted: false, tokensAfter: null })
})
