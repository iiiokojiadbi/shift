import { expect, test } from 'bun:test'
import { afterTool, afterWrite, atPrompt, beforeTool, type Courier, FRESH_LOOKS, type Looks, runEnded } from '../src/delivery'
import type { GaugeKeeper } from '../src/hint'
import { FRESH_LOOP, type Loop, type LoopState } from '../src/loop'
import type { Gauge, Reading } from '../src/types'
import { BOARD, LIST, OWNER, R, ROOT, TRACK, taskMd } from './fixtures'
import { memoryProject } from './memory'

const TOOL = { own: false, readOnly: false }

async function setUp(reading: Reading = { tokens: 20_000, window: 1_000_000, threshold: undefined }) {
  const project = await memoryProject(
    {
      [`${R}/board.md`]: BOARD,
      [`${R}/OWNER.md`]: OWNER,
      [`${R}/TASKS.md`]: LIST,
      [`${R}/tasks/tests/task.md`]: taskMd('Green tests'),
      [`${R}/tasks/tests/track.md`]: TRACK,
      [`${R}/settings.toml`]: '[docs]\ntoc = true',
      [`${ROOT}/docs/a.md`]: '---\ndescription: what A holds\n---\n\n# A\n\n## One\n',
    },
    ROOT,
  )
  const rows: string[] = []
  const kept: { loop: LoopState; looks: Looks; gauge: Gauge | null; reading: Reading } = {
    loop: FRESH_LOOP,
    looks: FRESH_LOOKS,
    gauge: null,
    reading,
  }
  const loop: Loop = {
    read: async () => kept.loop,
    update: async change => {
      kept.loop = change(kept.loop)
    },
    tell: row => rows.push(row),
  }
  const gauge: GaugeKeeper = {
    read: async () => kept.gauge,
    update: async change => {
      kept.gauge = change(kept.gauge ?? { base: null, hinted: null, unassisted: false, growth: {}, whole: true })
    },
    history: async () => ({}),
    base: async () => null,
    reading: async () => kept.reading,
  }
  const courier: Courier = {
    loop,
    gauge,
    project: async () => project,
    looks: async () => kept.looks,
    updateLooks: async change => {
      kept.looks = change(kept.looks)
    },
  }
  const put = (path: string, text: string) => project.store.write(`${R}/${path}`, text)

  return { project, courier, kept, rows, put }
}

test("a change between tools is someone else's, one while a tool runs is the tool's own, the mod's own tool's is only remembered", async () => {
  const { courier, kept, rows, put } = await setUp()
  // The first look only remembers.
  expect(await beforeTool(courier)).toEqual([])
  expect(kept.looks.running).toBe(1)
  expect(await afterTool(courier, [], TOOL)).toEqual([])
  expect(kept.looks.running).toBe(0)

  await put('OWNER.md', `${OWNER}\n- «a new rule»`)
  const before = await beforeTool(courier)
  expect(before.map(note => note.kind)).toEqual(['records'])
  // Another tool starts while the first runs: what changes now may be the first one's, not looked at before it.
  await put('board.md', '## Goal\nbroken')
  expect(await beforeTool(courier)).toEqual([])
  expect(await afterTool(courier, [], { ...TOOL, readOnly: true })).toEqual([])
  const notes = await afterTool(courier, before, TOOL)
  expect(notes).toHaveLength(2)
  expect(notes[0]).toStartWith(`<shift note="the mod's check of the records just changed">\n\`.shift/OWNER.md\` changed outside your tools`)
  expect(notes[1]).toContain('`.shift/board.md`: The board lacks sections')
  expect(notes[1]).not.toContain('changed outside')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toStartWith('to the agent — `.shift/OWNER.md` changed outside your tools')
  expect(rows[0]).not.toContain('\n')

  await put('board.md', `${BOARD}\n`)
  await put('tasks/tests/track.md', '- [half] broken by the mod?')
  await beforeTool(courier)
  expect(await afterTool(courier, [], { ...TOOL, own: true })).toEqual([])
  // Remembered: the next look does not tell it again.
  await beforeTool(courier)
  expect(await afterTool(courier, [], TOOL)).toEqual([])
  expect(kept.looks.running).toBe(0)
})

test('a tool that threw is only counted down; a run that ended clears what a dead process left counted', async () => {
  const { courier, kept, put } = await setUp()
  await beforeTool(courier)
  await put('board.md', '## Goal\nbroken')
  expect(await afterTool(courier, [], null)).toEqual([])
  expect(kept.looks.running).toBe(0)
  kept.looks = { ...kept.looks, running: 3 }
  await runEnded(courier)
  expect(kept.looks.running).toBe(0)
})

test('the docs follow a written file, in the tool result or a subagent write alike', async () => {
  const { courier, project, rows } = await setUp()
  await beforeTool(courier)
  const notes = await afterTool(courier, [], { ...TOOL, written: `${ROOT}/docs/a.md` })
  expect(notes).toEqual([
    expect.stringMatching(/^<shift note="the mod's check of the file just written">\nThe mod rewrote the toc of `docs\/a.md`/),
  ])
  expect(project.files.get(`${ROOT}/docs/a.md`)).toContain('<!-- toc -->')
  expect(rows.at(-1)).toStartWith('to the agent — The mod rewrote the toc')
  expect(await afterWrite(courier, `${ROOT}/docs/a.md`)).toEqual([])
})

test('a hint goes last in a tool result, in its own tag, and is told to the owner', async () => {
  const { courier, kept, rows } = await setUp()
  await beforeTool(courier)
  await afterTool(courier, [], TOOL)
  kept.reading = { tokens: 300_000, window: 1_000_000, threshold: undefined }
  kept.gauge = { base: 20_000, hinted: null, unassisted: false, growth: {}, whole: true }
  await beforeTool(courier)
  const notes = await afterTool(courier, [], TOOL)
  expect(notes).toEqual([expect.stringMatching(/^<shift note="a hint from the mod, not part of what it came with">\nShift hint: /)])
  expect(rows.at(-1)).toStartWith('to the agent — Shift hint: ')
})

test("with the prompt: someone else's change and a hint, the waiting letter last for the owner, told once it went", async () => {
  const { courier, kept, rows, put } = await setUp()
  await atPrompt(courier, { runStarts: true, owner: false })
  kept.loop = { ...kept.loop, note: { context: '<letter/>', dir: `${R}/shifts/x`, files: ['board.md'] } }
  await put('OWNER.md', `${OWNER}\n- «a new rule»`)
  kept.looks = { ...kept.looks, running: 2 }

  // A tool runs (a message queued mid-run): its change is not looked at.
  const queued = await atPrompt(courier, { runStarts: false, owner: false })
  expect(queued.notes).toEqual([])

  const told = await atPrompt(courier, { runStarts: true, owner: true })
  expect(told.notes).toHaveLength(2)
  expect(told.notes[0]).toContain('`.shift/OWNER.md` changed outside your tools')
  expect(told.notes[1]).toBe('<letter/>')
  expect(rows).toEqual([])
  await told.delivered()
  expect(rows[0]).toStartWith('to the agent — `.shift/OWNER.md`')
  expect(rows[1]).toStartWith('went with your message: board.md')
  expect(kept.loop.note).toBeNull()
})
