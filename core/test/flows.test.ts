import { expect, test } from 'bun:test'
import { acceptShift, changedRecords, resumeShift, settleShift, shiftBase, shiftHistory, shiftNotMade } from '../src/flows'
import { frontmatter } from '../src/markdown'
import { readSaved } from '../src/saved'
import { setupReport } from '../src/setup'
import type { PendingShift, ShiftInput } from '../src/types'
import { BOARD, LETTER, R, ROOT } from './fixtures'
import { memoryProject } from './memory'

const AT = Date.UTC(2026, 0, 2, 3, 4, 5)
const DIR = 's-0000000000000001'

const TRAPS = [
  '---',
  'kind: traps',
  'about: traps of edits',
  '---',
  '',
  '## Edits',
  '',
  '### A pattern matched twice',
  '',
  '**Cause.** c.',
  '',
  '**Do.** d.',
].join('\n')
const INPUT: ShiftInput = { letter: '.shift/letter.md', after: 'continue', about: 'the parser fixed' }

function project(extra: Record<string, string> = {}, ignored = true) {
  return memoryProject(
    {
      [`${R}/letter.md`]: LETTER,
      [`${R}/board.md`]: BOARD,
      [`${R}/OWNER.md`]: '# Owner decisions\n\n## Work\n\n- «green first»',
      ...extra,
    },
    ROOT,
    ignored,
  )
}

async function accepted(store: Awaited<ReturnType<typeof project>>, at = AT): Promise<PendingShift> {
  const result = await acceptShift(store, { input: INPUT, at, sessionId: 's1' })
  if ('deny' in result) throw new Error(result.deny)

  return result.shift
}

test('a shift is refused without a letter, with a bad letter or without a board', async () => {
  const call = { input: INPUT, at: AT, sessionId: 's1' }
  const deny = async (store: Awaited<ReturnType<typeof project>>) => {
    const result = await acceptShift(store, call)
    return 'deny' in result ? result.deny : null
  }
  const noLetter = await project()
  noLetter.files.delete(`${R}/letter.md`)
  expect(await deny(noLetter)).toContain('No letter at .shift/letter.md')
  expect(await deny(await project({ [`${R}/letter.md`]: '## Where I am\nx' }))).not.toBeNull()
  const noBoard = await project()
  noBoard.files.delete(`${R}/board.md`)
  expect(await deny(noBoard)).toContain('No board')
})

test('a revised file-backed legacy decision must acquire a scope before its next snapshot', async () => {
  const p = await project()
  await accepted(p)
  expect(await setupReport(p, null)).toContain('They pass every check')
  await p.store.write(`${R}/OWNER.md`, '- Keep the preview private.')
  expect(await setupReport(p, null)).toContain('follow the decision with "Permanent"')
  const call = { input: INPUT, at: AT + 1, sessionId: 'another-chat' }
  expect(await acceptShift(p, call)).toEqual({ deny: expect.stringContaining('Permanent') })
  await p.store.write(`${R}/OWNER.md`, '- Keep the preview private.\n  [tasks preview-1] · Until the owner approves access')
  expect(await acceptShift(p, call)).toHaveProperty('shift')
})

test("records the project's git does not ignore are excluded locally, unless the owner lets them be committed", async () => {
  const call = { input: INPUT, at: AT, sessionId: 's1' }
  const store = await project({ [`${ROOT}/.git/info/exclude`]: '# git ls-files --others --exclude-from=.git/info/exclude' }, false)
  const accepted = await acceptShift(store, call)
  if ('deny' in accepted) throw new Error(accepted.deny)
  expect(accepted.result).toContain('the mod added ".shift/" to /p/.git/info/exclude')
  expect(store.files.get(`${ROOT}/.git/info/exclude`)).toBe('# git ls-files --others --exclude-from=.git/info/exclude\n.shift/\n')

  const committed = await project({ [`${R}/settings.toml`]: 'commit = true' }, false)
  const kept = await acceptShift(committed, call)
  if ('deny' in kept) throw new Error(kept.deny)
  expect(kept.result).not.toContain('exclude')
  expect(committed.files.has(`${ROOT}/.git/info/exclude`)).toBe(false)

  const noRepo = await project({}, false)
  const git = async (_root: string, args: readonly string[]) => ({ code: args[0] === 'check-ignore' ? 1 : 128, stdout: '' })
  const noRepoFile = { ...noRepo, store: { ...noRepo.store, git } }
  expect(await acceptShift(noRepoFile, call)).toEqual({ deny: expect.stringContaining('commit = true') })
  // No repository at all, or no git to run: nothing to keep the records out of.
  const noGit = { ...noRepo, store: { ...noRepo.store, git: async () => null } }
  expect(await acceptShift(noGit, call)).toHaveProperty('shift')
})

test('the history description comes from the opening paragraph while the letter keeps its detail', async () => {
  const save = async (opening: string) => {
    const store = await project({ [`${R}/letter.md`]: LETTER.replace('fixing tests', opening) })
    return acceptShift(store, { input: { letter: INPUT.letter, after: 'wait' }, at: AT, sessionId: 's1' })
  }
  const saved = await save('Verified the fix.\r\nThe input survives restart.\r\n \r\nLonger evidence stays here.')
  if ('deny' in saved) throw new Error(saved.deny)
  expect(saved.shift.about).toBe('Verified the fix. The input survives restart.')
  expect(saved.shift.letter).toContain('Longer evidence stays here.')
  const list = await save(`<!-- template -->\n\nA short opening.\n- ${'x'.repeat(401)}`)
  if ('deny' in list) throw new Error(list.deny)
  expect(list.shift.about).toBe('A short opening.')
  const details = await save(`Done. Verified.\n<details>\n${'x'.repeat(401)}\n</details>`)
  if ('deny' in details) throw new Error(details.deny)
  expect(details.shift.about).toBe('Done. Verified.')
  const crlf = LETTER.replace('HOLD-THIS', '~~~md\n## Where I am\nFenced example.\n~~~').replaceAll('\n', '\r\n')
  const store = await project({ [`${R}/letter.md`]: crlf })
  const result = await acceptShift(store, { input: { letter: INPUT.letter, after: 'wait' }, at: AT, sessionId: 's1' })
  if ('deny' in result) throw new Error(result.deny)
  expect(result.shift.about).toBe('fixing tests')
  expect(await save('x'.repeat(401))).toMatchObject({ deny: expect.stringContaining('opening paragraph') })
})

test('an accepted shift snapshots the records and leaves a pending about.md', async () => {
  const store = await project({ [`${R}/knowledge/traps.md`]: TRAPS })
  const shift = await accepted(store)

  expect(shift.dir).toBe(DIR)
  expect(shift.hold).toBe('HOLD-THIS')
  const saved = await readSaved(store, DIR)
  expect(saved.files['letter.md']).toBe(LETTER)
  expect(saved.files['board.md']).toBe(BOARD)
  expect(saved.files['OWNER.md']).toBe(store.files.get(`${R}/OWNER.md`))
  expect(saved.files['knowledge/traps.md']).toBe(TRAPS)
  const about = frontmatter(saved.about)
  expect(about.get('result')).toBe('pending')
  expect(about.get('description')).toBe('the parser fixed')
})

test('the history reads the last shifts, oldest first', async () => {
  const store = await project()
  for (const [index, name] of ['one', 'two', 'three'].entries()) {
    store.files.set(`${R}/board.md`, BOARD.replace('the mod', name))
    const result = await acceptShift(store, { input: { ...INPUT, about: name }, sessionId: 's1', at: AT + index })
    if ('deny' in result) throw Error(result.deny)
    await settleShift(store, { shift: result.shift, before: 100, after: 10, messages: [] })
  }
  const text = await shiftHistory(store, 2)
  expect(text).toContain('2 of 3')
  expect(text).not.toContain('s-0000000000000001')
  expect(text.indexOf('two')).toBeLessThan(text.indexOf('three'))
})

test('resume restores the saved letter last', async () => {
  const store = await project()
  expect((await resumeShift(store)).text).toContain('No shifts')
  const shift = await accepted(store)
  await settleShift(store, { shift, before: 100, after: 10, messages: [] })
  const resumed = await resumeShift(store)
  expect(resumed.text).toContain(shift.dir)
  expect(resumed.prompt).toContain(LETTER)
  expect(resumed.prompt?.indexOf('<file path=".shift/board.md">')).toBeLessThan(resumed.prompt?.indexOf('<letter shift=') ?? 0)
})

test('after the let-go: continue goes on from the letter, however many came before; a wait leaves the note', async () => {
  const store = await project()
  const shift = await accepted(store)
  const letGo = { shift, messages: [{ role: 'user', text: 'DIGEST' }], before: 300_000, after: 20_000 }

  const going = await settleShift(store, letGo)
  expect(going).toMatchObject({
    after: 'continue',
    row: `shift s-0000000000000001 done (300K → 20K), continuing from the letter — shift_history ${DIR}`,
  })
  expect((await readSaved(store, DIR)).files['summary.md']).toContain('DIGEST')
  expect(frontmatter((await readSaved(store, DIR)).about).get('result')).toBe('shifted (300K → 20K), continuing')

  // No count of shifts without the owner: the agent works on through as many as the work takes.
  for (let n = 0; n < 5; n++) expect((await settleShift(store, letGo)).after).toBe('continue')

  const other = await project()
  const waiting = await settleShift(other, { ...letGo, shift: { ...(await accepted(other)), after: 'wait' } })
  if (waiting.after !== 'wait') throw new Error('expected a wait')
  expect(waiting.note.dir).toBe(DIR)
  expect(waiting.note.files).toContain('board.md')
  expect(waiting.note.context).toContain('HOLD-THIS')
})

test('a let-go that failed is written down; the base comes back only from this session', async () => {
  const store = await project()
  const shift = await accepted(store)
  expect(await shiftNotMade(store, shift, 'busy', 100_000)).toBe('shift s-0000000000000001 not made — busy')
  expect(frontmatter((await readSaved(store, DIR)).about).get('result')).toBe('not shifted: busy')
  expect(await shiftBase(store, 's1')).toBeNull()
  // Not shifted, so the same records may shift again, with a new request key.
  const retried = await acceptShift(store, { input: INPUT, at: AT + 1, sessionId: 's1' })
  if ('deny' in retried) throw new Error(retried.deny)
  const retry = retried.shift
  expect(retry.dir).toBe('s-0000000000000002')
  expect(frontmatter((await readSaved(store, DIR)).about).get('result')).toBe('not shifted: busy')

  await settleShift(store, { shift: retry, messages: [], before: 300_000, after: 20_000 })
  expect(await shiftBase(store, 's1')).toBe(20_000)
  expect(await shiftBase(store, 's2')).toBeNull()
})

test("records changed by the agent's tools are told only when broken, by someone else always", async () => {
  const p = await project()
  const put = (path: string, text: string) => p.store.write(`${R}/${path}`, text)
  const first = await changedRecords(p, null, 'agent')
  expect(first.body).toBeNull()
  expect(Object.keys(first.seen)).toContain('.shift/board.md')
  expect((await changedRecords(p, first.seen, 'agent')).body).toBeNull()

  await put('board.md', BOARD.replace('the mod', 'Green tests'))
  const whole = await changedRecords(p, first.seen, 'agent')
  expect(whole.body).toBeNull()

  await put('board.md', '## Goal\nthe mod')
  await put('letter.md', '## Where I am\nhere')
  const broken = await changedRecords(p, whole.seen, 'agent')
  expect(broken.body).toContain('`.shift/board.md`: The board lacks sections: "## Current focus"')
  expect(broken.body).toContain('`.shift/letter.md`: The letter')
  expect(broken.body).toContain('if you are still writing them, go on')
  // Told once: unchanged since, the same broken board says nothing more; another record is not this look's.
  expect((await changedRecords(p, broken.seen, 'agent')).body).toBeNull()
  // Rewritten with the same text: a new stamp, no change.
  await put('board.md', '## Goal\nthe mod')
  expect((await changedRecords(p, broken.seen, 'other')).body).toBeNull()

  await put('OWNER.md', '# Owner decisions\n\n## Work\n\n- «green first, always»\n  Permanent')
  const outside = (await changedRecords(p, broken.seen, 'other')).body ?? ''
  expect(outside).toContain('`.shift/OWNER.md` changed outside your tools — by the owner or another session')
  expect(outside).not.toContain('board.md')
  expect(outside).not.toContain('refuses')
})

test('an OWNER.md the settings put in the root is looked at as one in .shift/', async () => {
  const p = await project({ [`${R}/settings.toml`]: '[files]\nowner = "OWNER.md"', [`${ROOT}/OWNER.md`]: '# Owner decisions\n\nnone' })
  const first = await changedRecords(p, null, 'agent')
  expect(Object.keys(first.seen)).toContain('OWNER.md')
  await p.store.write(`${ROOT}/OWNER.md`, '# Owner decisions\n\n## Work\n\n- «green first»')
  expect((await changedRecords(p, first.seen, 'other')).body).toContain('`OWNER.md` changed outside your tools')
})

test('a later failure preserves the base of the completed shift', async () => {
  const store = await project()
  const shift = await accepted(store)
  await settleShift(store, { shift, before: 300000, after: 20000, messages: [] })
  store.files.set(`${R}/board.md`, BOARD.replace('the mod', 'a new goal'))
  await shiftNotMade(store, await accepted(store, AT + 1), 'busy', 100000)
  expect(await shiftBase(store, 's1')).toBe(20000)
})

test('an unchanged shift is refused against the last complete archive entry of this session', async () => {
  const store = await project()
  const shift = await accepted(store)
  await settleShift(store, { shift, before: 100, after: 10, messages: [] })
  const input = { input: INPUT, sessionId: 's1', at: AT + 1 }
  expect(await acceptShift(store, input)).toMatchObject({ deny: expect.stringContaining('Nothing changed') })
  store.files.set(`${R}/OWNER.md`, 'none')
  expect(await acceptShift(store, input)).toHaveProperty('shift')
})

test('a folder with a letter cannot restore or appear in history without a native archive', async () => {
  const path = `${R}/shifts/20250101-000000/letter.md`
  const store = await project({ [path]: 'foreign letter' })
  expect(await resumeShift(store)).not.toHaveProperty('prompt')
  expect(await shiftHistory(store, 10)).toContain('No shifts')
  expect(() => readSaved(store, path)).toThrow('saved shift ID')
  const shift = await accepted(store)
  expect(shift.dir).toBe(DIR)
  expect(store.files.get(path)).toBe('foreign letter')
})

test('a retained record checkpoint reports only deleted files still watched by this version', async () => {
  const knowledge = '.shift/knowledge/traps.md'
  const store = await project({ [`${ROOT}/${knowledge}`]: TRAPS })
  const first = await changedRecords(store, null, 'other')
  const seen = { ...first.seen, '.shift/TASKS.md': '1#1' }
  store.files.delete(`${ROOT}/${knowledge}`)
  store.files.delete(`${R}/letter.md`)
  const changed = await changedRecords(store, seen, 'other')
  expect(changed.body?.split('\n').sort()).toEqual([
    '`.shift/knowledge/traps.md` was removed outside your tools.',
    '`.shift/letter.md` was removed outside your tools.',
  ])
  expect(changed.seen).not.toHaveProperty('.shift/TASKS.md')
  expect((await changedRecords(store, changed.seen, 'other')).body).toBeNull()
})
