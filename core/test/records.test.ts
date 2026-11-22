import { expect, test } from 'bun:test'
import { replacePassage } from '../src/editing'
import {
  addGrowth,
  checkLetter,
  compactInstructions,
  contentChars,
  FRESH_GAUGE,
  frontmatter,
  knowledgeMap,
  OUTCOME,
  parseHistoryCount,
  parseShiftInput,
  readAbout,
  renderAbout,
  renderHistory,
  renderRecent,
  renderStatus,
  sections,
  shiftFill,
  shiftHint,
} from '../src/index'
import { BOARD, boardWith, check, LETTER, OWNER, TRAPS, WORK } from './fixtures'

// The checks of the records, about.md and the history, the hint rule and the texts: pure logic over plain values.

test('parseShiftInput refuses an empty letter, an unknown after and a bad about', () => {
  expect(parseShiftInput({ letter: ' ', after: 'wait', about: 'a' })).toContain('letter')
  expect(parseShiftInput({ letter: 'l.md', after: 'later', about: 'a' })).toContain('after')
  expect(parseShiftInput({ letter: 'l.md', after: 'wait', about: '' })).toContain('about')
  expect(parseShiftInput({ letter: 'l.md', after: 'wait', about: 'a\nb' })).toContain('one line')
  expect(parseShiftInput({ letter: 'l.md', after: 'wait', about: 'x'.repeat(401) })).toContain('401')
  expect(parseShiftInput({ letter: ' l.md ', after: 'continue', about: ' a ' })).toEqual({ letter: 'l.md', after: 'continue', about: 'a' })
})

test('the letter needs every section, none empty', () => {
  expect(checkLetter(LETTER)).toBeNull()
  expect(checkLetter('## Where I am\nhere')).toContain('"## Next"')
  expect(checkLetter(LETTER.replace('none', ''))).toContain('"Unverified"')
  expect(sections(LETTER).get('Hold')).toBe('HOLD-THIS')
})

test('the board is a state, not a diary', () => {
  expect(check(WORK)).toBeNull()
  expect(check({ ...WORK, board: '## Goal\nmod' })).toContain('"## Current focus"')
  expect(check({ ...WORK, board: boardWith(['- tests go first, 2026-10-23']) })).toContain('date')
  const long = boardWith(Array.from({ length: 200 }, (_, i) => `- decision ${i}`))
  expect(check({ ...WORK, board: long })).toContain('diary')
  expect(check({ ...WORK, board: `${BOARD}\n## Owner decisions\nnone` })).toContain('live in .shift/OWNER.md')
  expect(check({ ...WORK, board: '## Goal\n- First outcome\n- Second outcome\n## Current focus\nVerifying both.' })).toBeNull()
  expect(check({ ...WORK, board: '## Goal\nOne outcome\n## Current focus\nReviewing results.' })).toBeNull()
})

test("the owner's decisions are a code of rules beside the board", () => {
  expect(check({ ...WORK, owner: null })).toContain('No .shift/OWNER.md')
  expect(check({ ...WORK, owner: ' ' })).toContain('"none"')
  expect(check({ ...WORK, owner: `${OWNER} (19.10.2026)` })).toContain('rewrites the older line')
  const long = Array.from({ length: 160 }, (_, i) => `- rule ${i}`).join('\n')
  expect(check({ ...WORK, owner: long })).toContain('a log')
  expect(check({ ...WORK, owner: 'none' })).toBeNull()
})

test('knowledge files have a kind, an about, their entry fields and room', () => {
  const file = (name: string, text: string) => check({ ...WORK, knowledge: [{ name, text }] })
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

test('the summarizer gets the hold and is told not to plan', () => {
  const text = compactInstructions({ hold: 'goal: ship the mod', board: '/b.md', owner: '/OWNER.md', dir: '/d' })
  expect(text).toContain('goal: ship the mod')
  expect(text).toContain('Do not write next steps')
  expect(text).not.toContain('working on now')
})

test('the effective limit sets the soft and final milestones, once each per stretch', () => {
  let gauge = FRESH_GAUGE
  const step = (tokens: number | undefined, threshold?: number) => {
    const hint = shiftHint(gauge, { tokens, window: 500_000, threshold })
    gauge = hint.gauge
    return hint.text
  }
  expect(step(undefined)).toBeNull()
  expect(step(20_000)).toBeNull()
  expect(step(299_999)).toBeNull()
  expect(step(300_000)).toContain('grown by 280K')
  expect(step(419_999)).toBeNull()
  expect(step(420_000)).toContain('420K of 500K used')
  expect(step(420_000)).toBeNull()
  expect(step(490_000)).toBeNull()

  gauge = FRESH_GAUGE
  const small = (tokens: number) => step(tokens, 258_000)
  expect(small(0)).toBeNull()
  expect(small(154_800)).toBeNull()
  expect(small(200_000)).toBeNull()
  expect(small(216_719)).toBeNull()
  expect(small(216_720)).toContain('Shift now')
  expect(small(257_000)).toBeNull()

  gauge = { ...FRESH_GAUGE, unassisted: true }
  expect(step(undefined)).toBeNull()
  expect(step(430_000)).toContain('without your shift')
  expect(step(454_999)).toBeNull()
  expect(step(455_000)).toContain('455K of 500K')
  gauge = FRESH_GAUGE
  expect(step(490_000)).toBeNull()
  expect(step(494_999)).toBeNull()
  expect(step(495_000)).toContain('495K of 500K')
  expect(step(70_000)).toBeNull()
  expect(step(300_000)).toContain('grown by 230K')
})

test('a late reading skips a soft hint near the final, including on a high starting fill', () => {
  const reading = (tokens: number) => ({ tokens, window: 500_000, threshold: undefined })
  const gauge = { ...FRESH_GAUGE, base: 20_000 }
  expect(shiftHint(gauge, reading(370_001)).text).toBeNull()
  expect(shiftHint(gauge, reading(421_000)).text).toContain('421K of 500K')
  expect(renderStatus({ ...gauge, base: 180_000 }, reading(200_000))).toContain('no soft hint')
})

test('a hint and the status name what the history grew from', () => {
  expect(contentChars([{ type: 'text', text: 'abcd' }, { type: 'tool_use', input: { a: 1 } }, { type: 'image' }])).toBe(4 + 7 + 6000)
  expect(contentChars([{ type: 'tool_result', content: [{ type: 'text', text: 'xyz' }] }])).toBe(3)

  let gauge = addGrowth(addGrowth(addGrowth(FRESH_GAUGE, 'Read', 600), 'Bash', 300), 'your responses', 30)
  gauge = addGrowth(gauge, 'Read', 70)
  gauge = shiftHint(gauge, { tokens: 20_000, window: 1_000_000, threshold: undefined }).gauge
  expect(shiftHint(gauge, { tokens: 600_000, window: 1_000_000, threshold: undefined }).text).toContain('Mostly from: Read 67%, Bash 30%.')

  const status = renderStatus(gauge, { tokens: 300_000, window: 1_000_000, threshold: 800_000 })
  expect(status).toContain('Used: 300K of 1000K window; the harness lets the history go by itself at 800K.')
  expect(status).toContain('Since the last shift: +280K.')
  expect(status).toContain('next soft hint at 480K; final at 672K.')
  expect(status).toContain('Grown mostly from: Read 67%, Bash 30%.')
  expect(renderStatus(FRESH_GAUGE, { tokens: undefined, window: 1_000_000, threshold: undefined })).toContain('No reading yet')
})

test('history: count defaults to 10, entries read oldest first, the last one shows the outcome', () => {
  expect(parseHistoryCount({})).toBe(10)
  expect(parseHistoryCount({ count: 0 })).toContain('count')
  const about = renderAbout({ about: 'webhooks ready', sessionId: 's', at: 0, after: 'wait', result: 'pending' })
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
  expect(renderHistory([], 0)).toContain('No shifts')
})

test('recent shifts: descriptions oldest first, a pointer to the earlier ones, no wait or continue', () => {
  const about = (description: string, after: 'wait' | 'continue') =>
    renderAbout({
      about: description,
      sessionId: 's',
      at: 0,
      after,
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

test('literal replacement uses one Markdown section and rejects ambiguous matches', () => {
  const source = '## Goal\nentry\n```md\n## Inner\n```\n## Next\nentry\n'
  expect(replacePassage(source, 'entry', 'done', 'Goal')).toBe(source.replace('entry', 'done'))
  expect(() => replacePassage(source, 'entry', 'done')).toThrow('one exact match')
  expect(() => replacePassage(source, 'entry', 'done', 'Inner')).toThrow('Section')
  expect(() => replacePassage(`${source}## Goal\n`, 'entry', 'done', 'Goal')).toThrow('Section')
  expect(() => replacePassage(source, 'absent', 'done', 'Next')).toThrow('one exact match')
})
