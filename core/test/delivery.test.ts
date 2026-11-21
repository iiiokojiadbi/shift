import { expect, test } from 'bun:test'
import { afterTool, afterWrite, atPrompt, beforeTool, type Courier, FRESH_LOOKS, type Looks, runEnded } from '../src/delivery'
import { acceptShift, sessionFiles, settleShift } from '../src/flows'
import type { GaugeKeeper } from '../src/hint'
import { FRESH_LOOP, type Loop, type LoopState } from '../src/loop'
import { initialMap } from '../src/map'
import { historyAction } from '../src/saved'
import { sizeReport } from '../src/sizes'
import type { Gauge, Reading } from '../src/types'
import { BOARD, LETTER, OWNER, R, ROOT } from './fixtures'
import { memoryProject } from './memory'

const TOOL = { own: false, readOnly: false }

async function setUp(reading: Reading = { tokens: 20_000, window: 1_000_000, threshold: undefined }) {
  const project = await memoryProject(
    {
      [`${R}/board.md`]: BOARD,
      [`${R}/OWNER.md`]: OWNER,
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
  await put('OWNER.md', ' ')
  await beforeTool(courier)
  expect(await afterTool(courier, [], { ...TOOL, own: true })).toEqual([])
  // Remembered: the next look does not tell it again.
  await beforeTool(courier)
  expect(await afterTool(courier, [], TOOL)).toEqual([])
  expect(kept.looks.running).toBe(0)
})

test('parallel named writes acknowledge their own files and retain an external section until a prompt takes it', async () => {
  const { project, courier, kept } = await setUp()
  const paths = ['a', 'b', 'c'].map(name => `${ROOT}/docs/${name}.md`)
  const body = (section: string) => `---\ndescription: Guide\n---\n# Guide\n## ${section}\nBefore\n`
  for (const path of paths) await project.store.write(path, body('Usage'))
  kept.looks = { ...kept.looks, map: await initialMap(project, await sessionFiles(project)) }
  await Promise.all([beforeTool(courier), beforeTool(courier)])
  const content = body('Usage').replace('Before', 'After')
  for (const path of paths) await project.store.write(path, content)
  const notes = await Promise.all(paths.slice(0, 2).map(written => afterTool(courier, [], { ...TOOL, written, content })))
  expect(notes.flat()).toEqual([])
  const prompt = () => atPrompt(courier, { runStarts: true, owner: true })
  const dropped = await prompt()
  const retry = await prompt()
  const deltas = retry.notes.filter(note => note.includes('Usage (changed)'))
  expect(deltas).toHaveLength(1)
  expect(deltas[0]).toContain('docs/c.md')
  expect(deltas[0]).not.toMatch(/docs\/[ab]\.md/)
  expect(retry.notes).toEqual(dropped.notes)
  await retry.delivered()
  expect((await prompt()).notes.join('\n')).not.toContain('Usage (changed)')
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

test('a written file is settled with the next prompt, by the main agent or a subagent alike, never mid-tool', async () => {
  const { courier, project, kept, rows } = await setUp()
  await beforeTool(courier)
  expect(await afterTool(courier, [], { ...TOOL, written: `${ROOT}/docs/a.md` })).toEqual([])
  expect(project.files.get(`${ROOT}/docs/a.md`)).not.toContain('<!-- toc -->')
  await afterWrite(courier, `${ROOT}/docs/a.md`)
  expect(kept.looks.written).toEqual(['docs/a.md'])

  kept.looks = { ...kept.looks, running: 1 }
  expect((await atPrompt(courier, { runStarts: false, owner: true })).notes).toEqual([])
  expect(project.files.get(`${ROOT}/docs/a.md`)).not.toContain('<!-- toc -->')

  const told = await atPrompt(courier, { runStarts: true, owner: true })
  expect(told.notes).toEqual([
    expect.stringMatching(/^<shift note="the mod's check of the files written in the last run">\nThe mod wrote the toc of `docs\/a.md`/),
  ])
  expect(project.files.get(`${ROOT}/docs/a.md`)).not.toContain('<!-- toc -->')
  expect(kept.looks.written).toEqual(['docs/a.md'])
  await told.delivered()
  expect(project.files.get(`${ROOT}/docs/a.md`)).toContain('<!-- toc -->')
  expect(kept.looks.written).toEqual([])
  expect(rows.at(-1)).toStartWith('to the agent — The mod wrote the toc')
  expect((await atPrompt(courier, { runStarts: true, owner: true })).notes).toEqual([])
})

test('a hint goes last in a tool result, in its own tag, and is told to the owner', async () => {
  const { courier, kept, rows } = await setUp()
  await beforeTool(courier)
  await afterTool(courier, [], TOOL)
  kept.reading = { tokens: 600_000, window: 1_000_000, threshold: undefined }
  kept.gauge = { base: 20_000, hinted: null, unassisted: false, growth: {}, whole: true }
  await beforeTool(courier)
  const notes = await afterTool(courier, [], TOOL)
  expect(notes).toEqual([expect.stringMatching(/^<shift note="a hint from the mod, not part of what it came with">\nShift hint: /)])
  expect(rows.at(-1)).toStartWith('to the agent — Shift hint: ')
})

test("with the prompt: someone else's change and a hint, the waiting letter last for the owner, told once it went", async () => {
  const { courier, kept, rows, put } = await setUp()
  await atPrompt(courier, { runStarts: true, owner: false })
  kept.loop = { ...kept.loop, note: { context: '<letter/>', dir: 's-0000000000000001', files: ['board.md'] } }
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

test('tools started together tell an outside change once', async () => {
  const { courier, put } = await setUp()
  await beforeTool(courier)
  await afterTool(courier, [], TOOL)
  await put('OWNER.md', `${OWNER}\n- «a new rule»`)
  const [first, second] = await Promise.all([beforeTool(courier), beforeTool(courier)])
  expect([...(first ?? []), ...(second ?? [])].map(note => note.kind)).toEqual(['records'])
  await afterTool(courier, [], TOOL)
  expect(await afterTool(courier, [...(first ?? []), ...(second ?? [])], TOOL)).toHaveLength(1)
  await beforeTool(courier)
  expect(await afterTool(courier, [], TOOL)).toEqual([])
})

test('a prompt that did not go keeps its notes — the records, the docs, the hint — for the next one', async () => {
  const { courier, kept, put } = await setUp()
  await atPrompt(courier, { runStarts: true, owner: true })
  await put('OWNER.md', `${OWNER}\n- «a new rule»`)
  await afterWrite(courier, `${ROOT}/docs/a.md`)
  kept.reading = { tokens: 600_000, window: 1_000_000, threshold: undefined }

  const dropped = await atPrompt(courier, { runStarts: true, owner: true })
  expect(dropped.notes).toHaveLength(3)
  const told = await atPrompt(courier, { runStarts: true, owner: true })
  expect(told.notes).toEqual(dropped.notes)
  await told.delivered()
  expect(kept.looks.written).toEqual([])
  expect((await atPrompt(courier, { runStarts: true, owner: true })).notes).toEqual([])
})

test('a doc changed between the prompt and its delivery keeps the change and is settled again', async () => {
  const { courier, project, kept } = await setUp()
  await afterWrite(courier, `${ROOT}/docs/a.md`)
  const told = await atPrompt(courier, { runStarts: true, owner: true })
  expect(told.notes).toHaveLength(1)
  await project.store.write(`${ROOT}/docs/a.md`, '---\ndescription: what A holds\n---\n\n# A\n\n## One\n\n## Two\n')
  await told.delivered()
  expect(project.files.get(`${ROOT}/docs/a.md`)).not.toContain('<!-- toc -->')
  expect(kept.looks.written).toEqual(['docs/a.md'])
})

test('a broken task store cannot interrupt a shift, prompt or archive report', async () => {
  const { project, courier, put } = await setUp()
  project.actor = 'writer'
  await put('history.db', '')
  await put('beads/.beads/metadata.json', 'broken')
  await put('letter.md', LETTER)
  const id = 's-0000000000000001'
  const store = project.store
  const calls: string[] = []
  store.beads = async (_root, args, stdin) => {
    if (args[0] !== 'shift-history') throw new Error('Private task database unavailable')
    const req = JSON.parse(stdin ?? '{}')
    calls.push(req.action)
    if (req.action === 'begin') return JSON.stringify(id)
    if (req.action === 'list' || req.action === 'search') return '[]'
    if (req.action === 'waiting' || req.action === 'finish') return '""'
    throw new Error(`Unexpected archive action: ${req.action}`)
  }
  expect((await sessionFiles(project)).map(f => f.path)).not.toContain('beads:claimed')
  const accepted = await acceptShift(project, { input: { letter: '.shift/letter.md', after: 'continue' }, sessionId: 'writer', at: 1 })
  if ('deny' in accepted) throw new Error(accepted.deny)
  const settled = await settleShift(project, { shift: accepted.shift, messages: [], before: 400, after: 20 })
  expect(settled.note.context).toContain(`<letter shift="${id}">\n${LETTER.trim()}`)
  expect(settled.note.context).not.toMatch(/task cards|No task is in progress|Tracker ·/)
  await (await atPrompt(courier, { runStarts: true, owner: true })).delivered()
  expect(await sizeReport(project)).toContain('Continue message')
  expect(await historyAction(project, { action: 'search', query: 'needle' })).toBe('No matches.')
  expect(calls).toContain('finish')
})
