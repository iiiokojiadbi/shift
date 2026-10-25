import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import type { TaskFiles, Work } from '../hooks/core/index'
import {
  addGrowth,
  addToIndex,
  checkArchive,
  checkLetter,
  checkWork,
  compactInstructions,
  contentChars,
  DEFAULT_SETTINGS,
  doctrine,
  FRESH_GAUGE,
  frontmatter,
  growthOf,
  indexLine,
  knowledgeMap,
  parseArchiveInput,
  parseHistoryCount,
  parseShiftInput,
  renderAbout,
  renderHistory,
  renderRecent,
  renderStatus,
  sections,
  segment,
  shiftDir,
  shiftFill,
  shiftHint,
  withHint,
} from '../hooks/core/index'

const LETTER = ['## Where I am', 'fixing tests', '## Next', 'claude plugin test', '## Unverified', 'none', '## Hold', 'HOLD-THIS'].join(
  '\n',
)

function boardWith(decisions: string[] = ['none']): string {
  return ['## Goal', 'the mod', '## Decisions', ...decisions, '## Dead ends', 'none'].join('\n')
}

function listWith(taskLines: string[]): string {
  return ['# Tasks', '', ...taskLines].join('\n')
}

function taskMd(title: string, extra: string[] = []): string {
  return [
    `# ${title}`,
    ...extra,
    '',
    '## Goal',
    'g',
    '## Done when',
    'd',
    '## Owner decisions',
    'none',
    '## Decisions',
    'none',
    '## Dead ends',
    'none',
  ].join('\n')
}

const BOARD = boardWith()
const LIST = listWith(['- [in progress] [tests](tasks/tests/) — red'])
const TRACK = '- [in progress] fix the parser\n- [open] cover the archive'
const TESTS: TaskFiles = { name: 'tests', task: taskMd('Green tests'), track: TRACK }
const OWNER = '# Owner decisions\n\n## How to work\n\n- «тесты зеленые перед коммитом»'
const TRAPS = [
  '---',
  'kind: traps',
  'about: traps of edits and tests; lessons — lessons.md',
  '---',
  '',
  '## Edits',
  '',
  '### The script stopped on the third replacement',
  '',
  '**Cause.** the pattern matched twice.',
  '',
  '**Do.** check the count before writing.',
].join('\n')
const WORK: Work = {
  board: BOARD,
  owner: OWNER,
  tasks: [TESTS],
  knowledge: [{ name: 'traps.md', text: TRAPS }],
  taskList: LIST,
  glossary: null,
  shift: null,
  archived: [],
  oldOwner: false,
}
// The records checked against a project whose settings are the defaults.
const check = (work: Work, previous: Work | null) => checkWork(work, previous, { settings: DEFAULT_SETTINGS, problem: null })

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

test('a hint goes inside the last tool result, whatever its content is', () => {
  const first = { type: 'tool_result', content: [{ type: 'text', text: 'a' }] }
  const blocks = [first, { type: 'tool_result', content: 'b' }]
  expect(withHint(blocks, 'H')).toEqual([first, { type: 'tool_result', content: 'b\n\n<system-reminder>\nH\n</system-reminder>' }])
  expect(withHint([first], 'H')[0]).toEqual({
    type: 'tool_result',
    content: [
      { type: 'text', text: 'a' },
      { type: 'text', text: '<system-reminder>\nH\n</system-reminder>' },
    ],
  })
  expect(withHint([{ type: 'text' }], 'H')).toEqual([{ type: 'text' }])
})

test('the summarizer gets the hold and is told not to plan', () => {
  const text = compactInstructions({ hold: 'goal: ship the mod', board: '/b.md', owner: '/OWNER.md', dir: '/d' })
  expect(text).toContain('goal: ship the mod')
  expect(text).toContain('Do not write next steps')
})

const AT = Date.UTC(2026, 9, 23, 14, 5, 9)
const DIR = '/proj/.shift/shifts/20261023-140509'

type On = Parameters<TestBody>[1]

function stubSession(
  on: On,
  files: Map<string, string>,
  logs: string[] = [],
  tokens = () => 50000,
  ignored = 0,
  history: { role: string; content: unknown }[] = [],
  session = () => 'sess',
) {
  on('session.root', () => ({ value: '/proj' }))
  on('session.messages', () => ({ value: history as never }))
  on('session.id', () => ({ value: session() }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: tokens() }, rateLimits: [] } }))
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({
    value: [...files.keys()].some(path => path === e.path || path.startsWith(`${e.path}/`)),
  }))
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const names = new Set<string>()
    for (const path of files.keys()) {
      if (path.startsWith(`${e.path}/`)) names.add(path.slice(e.path.length + 1).split('/')[0] ?? '')
    }
    return {
      value: [...names].map(name => ({ name, kind: files.has(`${e.path}/${name}`) ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false })),
    }
  })
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const [command, from, to] = e.argv
    if (command === 'git' && e.argv.includes('rev-parse')) {
      return { value: { exitCode: 0, stdout: '.git/info/exclude\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command === 'git') {
      return { value: { exitCode: ignored, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command === 'mv' && from !== undefined && to !== undefined) {
      for (const [path, text] of [...files]) {
        if (!path.startsWith(`${from}/`)) continue
        files.delete(path)
        files.set(to + path.slice(from.length), text)
      }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.log', (_$: unknown, e: { text: string }) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$: unknown, e: { text: string | undefined }) => {
    logs.push(`status: ${e.text ?? ''}`)
    return { value: undefined }
  })
}

function project(): Map<string, string> {
  return new Map([
    ['/proj/.shift/letter.md', LETTER],
    ['/proj/.shift/board.md', BOARD],
    ['/proj/.shift/OWNER.md', OWNER],
    ['/proj/.shift/TASKS.md', LIST],
    ['/proj/.shift/knowledge/traps.md', TRAPS],
    ['/proj/.shift/tasks/tests/task.md', TESTS.task ?? ''],
    ['/proj/.shift/tasks/tests/track.md', TRACK],
  ])
}

test('shiftDir names the folder by UTC time', () => {
  expect(shiftDir('/proj', AT)).toBe(DIR)
})

test('the shift tool snapshots the letter, the board and the tasks, and accepts once', async ($, on) => {
  const files = project()
  stubSession(on, files)
  mock.clock(on, { now: AT })

  const answer = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'continue',
    about: 'ABOUT',
  })
  expect(answer.deny).toBeUndefined()
  expect(String(answer.result)).toContain('Shift accepted')
  expect(files.get(`${DIR}/letter.md`)).toBe(LETTER)
  expect(files.get(`${DIR}/board.md`)).toBe(BOARD)
  expect(files.get(`${DIR}/tasks/tests/track.md`)).toBe(TRACK)
  expect(files.get(`${DIR}/OWNER.md`)).toBe(OWNER)
  expect(files.get(`${DIR}/knowledge/traps.md`)).toBe(TRAPS)
  expect(files.get(`${DIR}/about.md`)).toContain('result: pending')

  const again = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'wait',
    about: 'ABOUT',
  })
  expect(again.deny).toContain('already accepted')
})

test('the shift tool refuses without a board or a letter', async ($, on) => {
  const files = new Map([['/proj/.shift/letter.md', LETTER]])
  stubSession(on, files)
  mock.clock(on, { now: AT })

  const noBoard = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'wait',
    about: 'ABOUT',
  })
  expect(noBoard.deny).toContain('No board')
  const noLetter = await $.tool.call({ tool: 'mcp__shift__shift', letter: 'missing.md', after: 'wait', about: 'ABOUT' })
  expect(noLetter.deny).toContain('No letter')
})

test('records the project would commit go to its local exclude file, and the shift goes on', async ($, on) => {
  const files = project()
  stubSession(on, files, [], () => 50000, 1)
  mock.clock(on, { now: AT })

  const answer = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'wait',
    about: 'ABOUT',
  })
  expect(answer.deny).toBeUndefined()
  expect(String(answer.result)).toContain('the mod added ".shift/" to /proj/.git/info/exclude')
  expect(files.get('/proj/.git/info/exclude')).toBe('.shift/\n')
})

test('continue: after the turn the history is let go with the hold, and the letter and the work start a turn', async ($, on) => {
  const files = project()
  const compacted: string[] = []
  const submitted: string[] = []
  stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  on('session.compact', (_$: unknown, e: { instructions?: string }) => {
    compacted.push(e.instructions ?? '')
    return { messages: [{ role: 'user', text: 'SUMMARY', toolUses: [], toolResults: [] }], tokensBefore: 120000, tokensAfter: 9000 }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'continue', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(compacted).toEqual([])
  await clock.advance(500)

  expect(compacted.length).toBe(1)
  expect(compacted[0]).toContain('HOLD-THIS')
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('Shift done')
  expect(submitted[0]).toContain('fixing tests')
  expect(submitted[0]).toContain('.shift/tasks/tests/track.md')
  expect(submitted[0]).toContain('cover the archive')
  expect(submitted[0]).not.toContain('«тесты зеленые перед коммитом»')
  expect(submitted[0]).toContain('knowledge/traps.md — traps of edits and tests')
  expect(submitted[0]).not.toContain('third replacement')
  expect(files.get(`${DIR}/summary.md`)).toContain('SUMMARY')
  expect(files.get(`${DIR}/about.md`)).toContain('continuing')
  expect(files.get(`${DIR}/about.md`)).toContain('tokens: 120K → 50K')
})

test("wait: the letter rides along with the owner's next prompt, once", async ($, on) => {
  const files = project()
  const contexts: (readonly string[] | undefined)[] = []
  const logs: string[] = []
  stubSession(on, files, logs)
  const clock = mock.clock(on, { now: AT })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [], toolResults: [] }] }))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    contexts.push(e.context)
    logs.push(`entered: ${e.text}`)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'wait', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(500)
  await $.prompt.submit({ text: 'a notification', origin: { kind: 'unclassified' }, wait: false })
  await $.prompt.submit({ text: 'owner speaks', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: 'owner again', origin: { kind: 'composer' }, wait: false })

  expect(contexts[0] ?? []).toEqual([])
  expect(String(contexts[1])).toContain('fixing tests')
  expect(String(contexts[1])).toMatch(/^<shift folder="[^"]+\/">/)
  expect(String(contexts[1])).toContain('<letter path=')
  expect(String(contexts[1])).toContain('<file path=".shift/board.md">')
  expect(String(contexts[1]).trimEnd().endsWith('</shift>')).toBe(true)
  expect(doctrine(['shift']).startsWith('<shift note=')).toBe(true)
  expect(String(contexts[1])).toContain('fix the parser')
  // The records first, the recent shifts in the middle, the letter last.
  const handed = String(contexts[1])
  expect(handed.indexOf('<file path=".shift/board.md">')).toBeLessThan(handed.indexOf('<shifts>'))
  expect(handed.indexOf('</shifts>')).toBeLessThan(handed.indexOf('<letter path='))
  expect(handed).toMatch(/- \d{8}-\d{6} · ABOUT\n<\/shifts>/)
  expect(contexts[2] ?? []).toEqual([])
  // Rows in the transcript only: the status line under the input was noise.
  expect(logs).toEqual([
    expect.stringContaining('waiting for you, the letter goes with your next message'),
    'entered: a notification',
    'entered: owner speaks',
    expect.stringContaining('went with your message: letter.md, board.md, tasks/tests/, knowledge/ (the map) — '),
    'entered: owner again',
  ])
  expect(logs.some(line => line.startsWith('status:'))).toBe(false)
  expect(files.get(`${DIR}/about.md`)).toContain('waiting for the owner')
})

test('task_archive moves the folder and writes the index line', async ($, on) => {
  const files = project()
  files.set('/proj/.shift/tasks/tests/track.md', '- [done] fix the parser')
  stubSession(on, files)

  const answer = await $.tool.call({ tool: 'mcp__shift__task_archive', name: 'tests', outcome: 'done', about: 'green' })
  expect(answer.deny).toBeUndefined()
  expect(String(answer.result)).toContain('TASKS.md no longer lists it')
  expect(files.get('/proj/.shift/TASKS.md')).toBe('# Tasks\n\nnone\n')
  expect(files.has('/proj/.shift/tasks/tests/task.md')).toBe(false)
  expect(files.get('/proj/.shift/archive/tests/track.md')).toBe('- [done] fix the parser')
  expect(files.get('/proj/.shift/archive/index.md')).toContain('- [done] [Green tests](tests/) — green')

  const again = await $.tool.call({ tool: 'mcp__shift__task_archive', name: 'tests', outcome: 'done', about: 'green' })
  expect(again.deny).toContain('already exists')
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

test('a hint rides on a tool result and on a prompt, and a let-go starts a new stretch', async ($, on) => {
  const files = project()
  let tokens = 20000
  const prompts: (readonly string[] | undefined)[] = []
  const logs: string[] = []
  stubSession(on, files, logs, () => tokens)
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    prompts.push(e.context)
    return { text: e.text }
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [], toolResults: [] }] }))
  const toolResult = () =>
    $.session.append({
      message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
      door: 'tool-result',
      origin: { kind: 'tool', tool: 'Bash' },
      uuid: 'u',
    })

  await toolResult()
  tokens = 165000
  const hinted = (await toolResult()).message?.content
  expect(hinted?.length).toBe(1)
  expect(JSON.stringify(hinted?.[0])).toContain('"content":"ok\\n\\n<system-reminder>\\nShift hint')
  expect(JSON.stringify(hinted?.[0])).toContain('Mostly from: Bash')
  expect(logs.filter(line => line.startsWith('to the agent — Shift hint'))).toHaveLength(1)
  tokens = 170000
  expect(JSON.stringify(await toolResult())).not.toContain('Shift hint')
  tokens = 175000
  await $.prompt.submit({ text: 'owner', origin: { kind: 'composer' }, wait: false })
  expect(String(prompts[0])).toContain('175K of 200K used')

  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'long history', toolUses: [], toolResults: [] }] })
  tokens = 30000
  await $.prompt.submit({ text: 'owner', origin: { kind: 'composer' }, wait: false })
  expect(String(prompts[1])).toContain('without your shift')
  const status = await $.tool.call({ tool: 'mcp__shift__shift_status' })
  expect(String(status.result)).toContain('Since the last shift: +0.')
})

test('a fresh process takes the count back from the last shift and the history', async ($, on) => {
  const files = project()
  const about = (session: string) =>
    `---\ndescription: d\nresult: shifted (95K → 6K), waiting for the owner\ntokens: 95K → 6K\nsession: ${session}\n---\n`
  files.set('/proj/.shift/shifts/20260101-000000/about.md', about('sess'))
  const history = [
    { role: 'user', content: 'summary of the stretch' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000) }] },
  ]
  stubSession(on, files, [], () => 150_000, 0, history)

  const status = String((await $.tool.call({ tool: 'mcp__shift__shift_status' })).result)
  expect(status).toContain('Since the last shift: +144K.')
  expect(status).toContain('Grown mostly from: Read 99%.')

  expect(shiftFill(about('other'), 'sess')).toBeNull()
  expect(shiftFill(about('sess').replace('result: shifted', 'result: not shifted'), 'sess')).toBeNull()
  expect(growthOf([{ role: 'user', content: [{ type: 'text', text: '<system-reminder>\nrules\n</system-reminder>' }] }])).toEqual({
    'attachments and reminders': 42,
  })
})

test('the shift tool refuses a bad call', async $ => {
  const answer = await $.tool.call({ tool: 'mcp__shift__shift', letter: '', after: 'wait', about: 'ABOUT' })
  expect(answer.deny).toContain('letter')
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

test('the history and guide tools answer', async ($, on) => {
  const files = project()
  stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [], toolResults: [] }] }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))

  const guide = await $.tool.call({ tool: 'mcp__shift__shift_guide' })
  expect(String(guide.result)).toContain('strict structure')

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'wait', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(500)
  const history = await $.tool.call({ tool: 'mcp__shift__shift_history' })
  expect(String(history.result)).toContain('20261023-140509')
  expect(String(history.result)).toContain('ABOUT')
})

test('after Edit and Write the docs follow: the toc, the map and remarks in the result; the docs tools answer', async ($, on) => {
  const files = project()
  files.set('/proj/.shift/settings.toml', '[docs]\ntoc = true')
  files.set('/proj/docs/a.md', '---\ndescription: A\n---\n\n# A\n\n## One\n')
  stubSession(on, files)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }) as never)
  on('tool.call', { tool: 'Write' }, (_$, e) => {
    files.set(e.file_path, e.content)
    return { result: 'written' } as never
  })

  const edited = await $.tool.call({ tool: 'Edit', file_path: '/proj/docs/a.md', old_string: 'x', new_string: 'y' } as never)
  expect(edited.context?.[0]).toContain('rewrote the toc of `docs/a.md`')
  expect(files.get('/proj/docs/a.md')).toContain('<!-- toc -->\n- One\n<!-- /toc -->')
  expect(files.get('/proj/.shift/SHIFT.md')).toContain('`docs/a.md` — A')
  const quiet = await $.tool.call({ tool: 'Edit', file_path: '/proj/docs/a.md', old_string: 'x', new_string: 'y' } as never)
  expect(quiet.context).toBeUndefined()

  const written = await $.tool.call({ tool: 'Write', file_path: '/proj/src/x.ts', content: '// docs/gone.md' } as never)
  expect(written.context?.[0]).toContain('`src/x.ts`: a link to `docs/gone.md` that is not there.')

  const head = await $.tool.call({ tool: 'mcp__shift__doc_outline', path: 'docs/a.md' })
  expect(String(head.result)).toMatch(/\d+ {2}One/)
  const mentions = await $.tool.call({ tool: 'mcp__shift__docs_mentioning', file: 'src/a.md' })
  expect(String(mentions.result)).toContain('No document in `docs/` mentions `a.md`.')
})

test('/unshift hands the last letter, the board and the tasks in progress to a fresh session', async ($, on) => {
  const files = project()
  files.set(`${DIR}/letter.md`, LETTER)
  const submitted: string[] = []
  stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  const unshift = (args: string) =>
    $.command.run({ command: 'unshift', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  const run = await unshift('')
  expect(run.text).toContain('20261023-140509')
  expect(run.context?.[0]).toContain('fixing tests')
  expect(run.context?.[0]).toContain('## Goal')
  expect(run.context?.[0]).toContain('# Green tests')
  await clock.advance(200)
  expect(submitted).toEqual([expect.stringContaining('Pick up from the shift above')])

  // The owner's words typed with the command go after the letter, as their own.
  const typed = await unshift('  look at the parser first ')
  expect(typed.context?.[0]).toContain('fixing tests')
  await clock.advance(200)
  expect(submitted.at(-1)).toBe('look at the parser first')

  // The owner's message right after a bare command makes the mod's own prompt needless.
  await unshift('')
  await $.prompt.submit({ text: 'and the docs', origin: { kind: 'composer' } } as never)
  await clock.advance(200)
  expect(submitted.slice(-2)).toEqual(['look at the parser first', 'and the docs'])
})

test('settings turn the mod off in a project: no tools, no doctrine; without docs no docs tools', async ($, on) => {
  const files = project()
  stubSession(on, files)
  const registered: string[] = []
  on('tool.register', (_$: unknown, e: { name: string }) => {
    registered.push(e.name)
    return { value: undefined as never }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', (_$: unknown, e: unknown) => e as never)
  on('prompt.compose', () => ({ sections: [] }))
  const compose = () => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)

  await $.session.start({ cwd: '/proj', surface: null } as never)
  expect(registered).toContain('shift')
  expect((await compose()).sections.map(section => section.id)).toContain('shift:doctrine')
  const loaded = (await compose()).sections.find(section => section.id === 'shift:files')?.text
  expect(loaded).toContain('<file path=".shift/OWNER.md">')
  expect(loaded).toContain('<file path=".shift/TASKS.md">')

  expect(registered).toContain('doc_outline')

  registered.length = 0
  files.set('/proj/.shift/settings.toml', '[docs]\ndirs = []\n')
  await $.session.start({ cwd: '/proj', surface: null } as never)
  expect(registered).toContain('shift')
  expect(registered).not.toContain('doc_outline')
  const doctrineText = (await compose()).sections.find(section => section.id === 'shift:doctrine')?.text
  expect(doctrineText).toContain('- `shift_setup` — ')
  expect(doctrineText).not.toContain('docs_mentioning')

  registered.length = 0
  files.set('/proj/.shift/settings.toml', '# not here\nenabled = false\n')
  await $.session.start({ cwd: '/proj', surface: null } as never)
  expect(registered).toEqual([])
  expect((await compose()).sections).toEqual([])
})

test("a resumed or cleared session reads the session's files again; shift_setup answers", async ($, on) => {
  const files = project()
  let session = 'one'
  stubSession(
    on,
    files,
    [],
    () => 50000,
    0,
    [],
    () => session,
  )
  on('tool.register', () => ({ value: undefined as never }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', (_$: unknown, e: unknown) => e as never)
  on('prompt.compose', () => ({ sections: [] }))
  const compose = async () =>
    (
      await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
    ).sections.find(section => section.id === 'shift:files')?.text

  await $.session.start({ cwd: '/proj', surface: null } as never)
  expect(await compose()).not.toContain('NEW RULE')
  files.set('/proj/.shift/OWNER.md', '# Owner decisions\n\n## Scope\n\n- NEW RULE')
  expect(await compose()).not.toContain('NEW RULE')
  expect(String((await $.tool.call({ tool: 'mcp__shift__shift_setup' })).result)).toContain(
    "Changed since this session's block was read: `.shift/OWNER.md`.",
  )

  session = 'two'
  expect(await compose()).toContain('NEW RULE')
})
