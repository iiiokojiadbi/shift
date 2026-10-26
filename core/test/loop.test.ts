import { expect, test } from 'bun:test'
import { acceptShift } from '../src/flows'
import { letGoGauge } from '../src/hint'
import {
  afterTurn,
  dropWaiting,
  FRESH_LOOP,
  holdShift,
  type LetGoHarness,
  type Loop,
  type LoopState,
  loopHint,
  waitingNote,
} from '../src/loop'
import { frontmatter } from '../src/markdown'
import { NOT_MADE_NOTE } from '../src/texts/prompts'
import type { Gauge } from '../src/types'
import { BOARD, LETTER, listWith, R, ROOT, taskMd } from './fixtures'
import { memoryProject } from './memory'

// A loop over a variable that keeps its rows, and a project with one shift accepted and held.
async function setUp(after: 'continue' | 'wait' = 'continue') {
  const project = await memoryProject(
    {
      [`${R}/letter.md`]: LETTER,
      [`${R}/board.md`]: BOARD,
      [`${R}/OWNER.md`]: 'none',
      [`${R}/TASKS.md`]: listWith(['- [in progress] [t](tasks/t/) — t']),
      [`${R}/tasks/t/task.md`]: taskMd('T'),
      [`${R}/tasks/t/track.md`]: '- [done] x',
    },
    ROOT,
  )
  const rows: [string, string][] = []
  const kept: { state: LoopState } = { state: { ...FRESH_LOOP } }
  const loop: Loop = {
    read: async () => kept.state,
    update: async change => {
      kept.state = change(kept.state)
    },
    tell: (row, level) => rows.push([level, row]),
  }
  const accepted = await acceptShift(project, { input: { letter: '.shift/letter.md', after, about: 'a' }, at: 0, sessionId: 's' })
  if ('deny' in accepted) throw new Error(accepted.deny)
  await holdShift(loop, accepted.shift)

  return { project, loop, kept, rows, dir: accepted.shift.dir }
}

const harness = (letGo: LetGoHarness['letGo'], prompts: string[] = []): LetGoHarness => ({
  fill: async () => 300_000,
  letGo,
  continueWith: async prompt => {
    prompts.push(prompt)
  },
})
const digest: LetGoHarness['letGo'] = async () => ({ messages: [{ role: 'user', text: 'DIGEST' }], after: 20_000 })

test('an aborted turn lets nothing go; a failed let-go is told as an error; both are written down', async () => {
  const aborted = await setUp()
  await afterTurn(aborted.project, aborted.loop, harness(digest), true)
  expect(aborted.rows).toEqual([['warning', expect.stringContaining('not made — the turn was aborted')]])
  expect(aborted.kept.state.pending).toBeNull()
  expect(frontmatter(aborted.project.files.get(`${aborted.dir}/about.md`) ?? '').get('result')).toBe('not shifted: the turn was aborted')
  // The owner stopped the turn: the agent, told the shift was accepted, learns otherwise with the owner's next message.
  expect(aborted.kept.state.note?.context).toContain('was not made — the turn was aborted. Nothing was let go')

  const prompts: string[] = []
  const failed = await setUp()
  await afterTurn(
    failed.project,
    failed.loop,
    harness(async () => Promise.reject(new Error('busy')), prompts),
    false,
  )
  expect(failed.rows).toEqual([['error', expect.stringContaining('not made — the let-go failed: Error: busy')]])
  // To continue: the agent goes on at once, its history whole.
  expect(prompts).toEqual([expect.stringContaining('<shift note="from the mod: the shift was not made">')])
  expect(failed.kept.state.note).toBeNull()

  // To wait: the note goes with the owner's next message.
  const waiting = await setUp('wait')
  await afterTurn(
    waiting.project,
    waiting.loop,
    harness(async () => Promise.reject(new Error('busy')), prompts),
    false,
  )
  expect(prompts).toHaveLength(1)
  expect(waiting.kept.state.note).toMatchObject({ files: ['the note that the shift failed'] })
})

test('a failure note that cannot start the next turn waits for the owner instead', async () => {
  const { project, loop, kept } = await setUp()
  const stuck: LetGoHarness = {
    ...harness(async () => Promise.reject(new Error('busy'))),
    continueWith: async () => Promise.reject(new Error('dropped')),
  }
  await afterTurn(project, loop, stuck, false)
  expect(kept.state.note).toMatchObject({ files: ['the note that the shift failed'] })
})

test('a failure whose about.md cannot be written is still told, and says so', async () => {
  const { project, loop, rows } = await setUp()
  project.store.write = async () => {
    throw new Error('disk full')
  }
  await afterTurn(project, loop, harness(digest), true)
  expect(rows).toEqual([
    ['warning', expect.stringMatching(/not made — the turn was aborted \(and about\.md was not written: Error: disk full\)$/)],
  ])
})

test('a failure after the let-go is told and written as let go but not settled', async () => {
  const broken = await setUp()
  const throwing = { ...harness(digest), afterLetGo: async () => Promise.reject(new Error('disk')) }
  await afterTurn(broken.project, broken.loop, throwing, false)
  expect(broken.rows).toEqual([['error', expect.stringContaining('the history was let go, but the message after it failed')]])
  // The agent lost its history and got nothing back: it is sent to its records.
  expect(broken.kept.state.note).toBeNull()
  expect(frontmatter(broken.project.files.get(`${broken.dir}/about.md`) ?? '').get('result')).toBe('let go, not settled: Error: disk')
})

test('continue starts the next turn; on wait the note waits for the owner', async () => {
  const prompts: string[] = []
  const going = await setUp()
  await afterTurn(going.project, going.loop, harness(digest, prompts), false)
  expect(prompts[0]).toContain('Shift done')
  expect(going.rows[0]?.[1]).toContain('continuing from the letter')

  const waiting = await setUp('wait')
  await afterTurn(waiting.project, waiting.loop, harness(digest), false)
  expect(waiting.kept.state.note?.context).toContain('HOLD-THIS')
  const note = await waitingNote(waiting.loop)
  expect(waiting.kept.state.note).not.toBeNull()
  await note?.delivered()
  expect(waiting.kept.state.note).toBeNull()
  expect(waiting.rows.at(-1)).toEqual(['info', expect.stringContaining('went with your message: letter.md, board.md')])
  expect(await waitingNote(waiting.loop)).toBeNull()
})

test('no hint while a shift is pending', async () => {
  const { loop } = await setUp()
  let gauge: Gauge | null = letGoGauge(true)
  const keeper = {
    read: async () => gauge,
    update: async (change: (g: Gauge) => Gauge) => {
      gauge = change(gauge ?? letGoGauge(false))
    },
    history: async () => ({}),
    base: async () => null,
    reading: async () => ({ tokens: 20_000, window: 200_000, threshold: undefined }),
  }
  expect(await loopHint(loop, keeper)).toBeNull()
  await loop.update(state => ({ ...state, pending: null }))
  expect(await loopHint(loop, keeper)).toContain('let the history go by itself')
})

test('a turn that does not start after the shift is told, not recorded against the shift', async () => {
  const { project, loop, rows, dir } = await setUp()
  const harness: LetGoHarness = {
    fill: async () => 300_000,
    letGo: async () => ({ messages: [], after: 20_000 }),
    continueWith: async () => Promise.reject(new Error('busy')),
  }
  await afterTurn(project, loop, harness, false)
  expect(frontmatter(project.files.get(`${dir}/about.md`) ?? '').get('result')).toBe('shifted (300K → 20K), continuing')
  expect(rows.at(-1)).toEqual(['error', expect.stringContaining('the next turn did not start after the shift — Error: busy')])
  // The letter waits for the owner's next message instead.
  const note = await waitingNote(loop)
  expect(note?.context).toContain('fixing tests')
})

test('two ends of one turn let go once; a fill that cannot be read does not stop the shift', async () => {
  const { project, loop, dir } = await setUp()
  let letGoes = 0
  const counting: LetGoHarness = {
    ...harness(async () => {
      letGoes++
      return { messages: [], after: 20_000 }
    }),
    fill: async () => Promise.reject(new Error('no reading')),
  }
  await Promise.all([afterTurn(project, loop, counting, false), afterTurn(project, loop, counting, false)])
  expect(letGoes).toBe(1)
  expect(frontmatter(project.files.get(`${dir}/about.md`) ?? '').get('result')).toStartWith('shifted (')
})

test('the owner speaking while a wait shift lets go gets the letter right after their message', async () => {
  const { project, loop, kept } = await setUp('wait')
  const prompts: string[] = []
  const during: LetGoHarness['letGo'] = async instructions => {
    // The owner's message comes in while the history is let go: no letter yet.
    expect(await waitingNote(loop)).toBeNull()
    return digest(instructions)
  }
  await afterTurn(project, loop, harness(during, prompts), false)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('<letter path=')
  expect(kept.state).toMatchObject({ note: null, letting: null })

  const quiet = await setUp('wait')
  await afterTurn(quiet.project, quiet.loop, harness(digest, []), false)
  expect(quiet.kept.state.note?.context).toContain('<letter path=')
  expect(quiet.kept.state.letting).toBeNull()
})

test('the owner speaking after the turn ends and before the let-go is heard too', async () => {
  const { project, loop, kept } = await setUp('wait')
  // The shift is accepted and its turn over, not yet claimed: the owner's message finds no letter.
  expect(await waitingNote(loop)).toBeNull()
  expect(kept.state.letting).toEqual({ heard: true })
  const prompts: string[] = []
  await afterTurn(project, loop, harness(digest, prompts), false)
  expect(prompts[0]).toContain('<letter path=')
  expect(kept.state).toMatchObject({ note: null, letting: null })
})

test('a delivered letter clears only itself; a newer shift or /unshift drops an older one', async () => {
  const waiting = await setUp('wait')
  await afterTurn(waiting.project, waiting.loop, harness(digest), false)
  const offered = await waitingNote(waiting.loop)
  // A newer note parked before the older offer is told as delivered stays.
  const newer = { context: 'NEWER', dir: 'x', files: [] }
  waiting.kept.state = { ...waiting.kept.state, note: newer }
  await offered?.delivered()
  expect(waiting.kept.state.note).toEqual(newer)
  await dropWaiting(waiting.loop)
  expect(waiting.kept.state.note).toBeNull()

  // A letter left waiting is older than the next shift's, which continues.
  const going = await setUp()
  going.kept.state = { ...going.kept.state, note: { context: 'OLD', dir: 'y', files: [] } }
  await afterTurn(going.project, going.loop, harness(digest, []), false)
  expect(going.kept.state.note).toBeNull()
})

test("a harness's reason reaches the agent in the mod's words", () => {
  expect(NOT_MADE_NOTE('s', 'Compaction cancelled: nothing to summarize')).toContain('— let-go cancelled: nothing to let go.')
})
