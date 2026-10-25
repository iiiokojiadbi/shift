import { expect, test } from 'bun:test'
import { acceptShift, archiveTask, resumeShift, settleShift, shiftBase, shiftHistory, shiftNotMade } from '../src/flows'
import { frontmatter } from '../src/markdown'
import type { PendingShift, ShiftInput } from '../src/types'
import { BOARD, LETTER, R, ROOT, taskMd } from './fixtures'
import { memoryProject } from './memory'

const AT = Date.UTC(2026, 0, 2, 3, 4, 5)
const DIR = `${R}/shifts/20260102-030405`

const TASK_LIST = '# Tasks\n\n- [in progress] [tests](tasks/tests/) — red'
const TASK = taskMd('Green tests')
const TRACK = '- [done] fix the parser\n- [open] cover the archive'
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
      [`${R}/TASKS.md`]: TASK_LIST,
      [`${R}/tasks/tests/task.md`]: TASK,
      [`${R}/tasks/tests/track.md`]: TRACK,
      ...extra,
    },
    ROOT,
    ignored,
  )
}

async function accepted(store: Awaited<ReturnType<typeof project>>): Promise<PendingShift> {
  const result = await acceptShift(store, { input: INPUT, at: AT, sessionId: 's1' })
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

test('an accepted shift snapshots the records and leaves a pending about.md', async () => {
  const store = await project({ [`${R}/knowledge/traps.md`]: TRAPS, [`${R}/archive/index.md`]: '- [done] [Old](old/) — gone' })
  const shift = await accepted(store)

  expect(shift.dir).toBe(DIR)
  expect(shift.hold).toBe('HOLD-THIS')
  expect(shift.segment.done).toEqual(['tests: fix the parser'])
  for (const name of [
    'letter.md',
    'board.md',
    'OWNER.md',
    'TASKS.md',
    'index.md',
    'tasks/tests/task.md',
    'tasks/tests/track.md',
    'knowledge/traps.md',
  ]) {
    expect(store.files.has(`${DIR}/${name}`)).toBe(true)
  }
  const about = frontmatter(store.files.get(`${DIR}/about.md`) ?? '')
  expect(about.get('result')).toBe('pending')
  expect(about.get('description')).toBe('the parser fixed')
})

test('archiving moves the folder and adds the index line; a second time is refused', async () => {
  const store = await project({ [`${R}/tasks/tests/track.md`]: '- [done] fix the parser' })
  const input = { name: 'tests', outcome: 'done' as const, about: 'green' }
  const result = await archiveTask(store, input)

  expect(result).toEqual({ result: expect.stringContaining('Archived to .shift/archive/tests/') })
  expect(store.files.has(`${R}/archive/tests/task.md`)).toBe(true)
  expect(store.files.has(`${R}/tasks/tests/task.md`)).toBe(false)
  expect(store.files.get(`${R}/archive/index.md`)).toContain('[Green tests](tests/) — green')
  store.files.set(`${R}/tasks/tests/task.md`, TASK)
  store.files.set(`${R}/tasks/tests/track.md`, '- [done] again')
  expect(await archiveTask(store, input)).toHaveProperty('deny')
})

test('the history reads the last shifts, oldest first', async () => {
  const store = await project()
  for (const name of ['20260101-000000', '20260101-000001', '20260101-000002']) {
    store.files.set(`${R}/shifts/${name}/about.md`, `---\ndescription: did ${name}\nafter: wait\nresult: shifted\n---\n`)
  }
  const text = await shiftHistory(store, 2)

  expect(text).toContain('2 of 3')
  expect(text).not.toContain('did 20260101-000000')
  expect(text.indexOf('did 20260101-000001')).toBeLessThan(text.indexOf('did 20260101-000002'))
})

test('resume says why there is nothing, else hands the letter last', async () => {
  expect((await resumeShift(await project())).text).toContain('No shifts in this project')
  const store = await project({ [`${R}/shifts/20260101-000000/about.md`]: 'x' })
  expect((await resumeShift(store)).text).toContain('No letter.md')

  store.files.set(`${R}/shifts/20260101-000000/letter.md`, LETTER)
  const resumed = await resumeShift(store)
  expect(resumed.text).toBe('Picking up shift 20260101-000000.')
  expect(resumed.prompt?.indexOf('<file path=".shift/board.md">')).toBeLessThan(resumed.prompt?.indexOf('<letter path=') ?? 0)
})

test('after the let-go: continue counts the streak, a capped continue and a wait leave the note', async () => {
  const store = await project()
  const shift = await accepted(store)
  const letGo = { shift, messages: [{ role: 'user', text: 'DIGEST' }], before: 300_000, after: 20_000, streak: 0 }

  const going = await settleShift(store, letGo)
  expect(going).toMatchObject({
    after: 'continue',
    streak: 1,
    row: `shift 20260102-030405 done (300K → 20K), continuing from the letter — ${DIR}/letter.md`,
  })
  expect(store.files.get(`${DIR}/summary.md`)).toContain('DIGEST')
  expect(frontmatter(store.files.get(`${DIR}/about.md`) ?? '').get('result')).toBe('shifted (300K → 20K), continuing')

  const capped = await settleShift(store, { ...letGo, streak: 3 })
  expect(capped.after).toBe('wait')
  expect(capped.row).toContain('3 in a row without you')
  expect(frontmatter(store.files.get(`${DIR}/about.md`) ?? '').get('result')).toBe(
    'shifted (300K → 20K), waiting: 3 shifts in a row without the owner',
  )

  const waiting = await settleShift(store, { ...letGo, shift: { ...shift, after: 'wait' } })
  if (waiting.after !== 'wait') throw new Error('expected a wait')
  expect(waiting.note.dir).toBe(DIR)
  expect(waiting.note.files).toContain('board.md')
  expect(waiting.note.context).toContain('HOLD-THIS')
})

test('a let-go that failed is written down; the base comes back only from this session', async () => {
  const store = await project()
  const shift = await accepted(store)
  expect(await shiftNotMade(store, shift, 'busy', 100_000)).toBe('shift 20260102-030405 not made — busy')
  expect(frontmatter(store.files.get(`${DIR}/about.md`) ?? '').get('result')).toBe('not shifted: busy')
  expect(await shiftBase(store, 's1')).toBeNull()

  await settleShift(store, { shift, messages: [], before: 300_000, after: 20_000, streak: 0 })
  expect(await shiftBase(store, 's1')).toBe(20_000)
  expect(await shiftBase(store, 's2')).toBeNull()
})
