import { expect, test } from 'bun:test'
import { sessionFiles, tasksView } from '../src/flows'
import { FRESH_LOOP, type Loop, type LoopState } from '../src/loop'
import type { Project } from '../src/project'
import { archiveCall } from '../src/saved'
import { DEFAULT_SETTINGS } from '../src/settings'
import { sessionDoctrine, shownTools, startSession, TOOLS, type ToolCall } from '../src/tools'
import { R, TRAPS } from './fixtures'
import { memoryProject } from './memory'

const loopAt = (state: LoopState): Loop => ({
  read: async () => state,
  update: async change => {
    state = change(state)
  },
  tell: () => {},
})

const callOn = (project: Project, extra: Partial<ToolCall> = {}): ToolCall => ({
  project: async () => project,
  sessionId: async () => 's1',
  now: async () => 0,
  subagent: false,
  loop: loopAt(FRESH_LOOP),
  loaded: async () => null,
  status: async () => 'STATUS',
  cannotLetGo: async () => null,
  ...extra,
})

const tool = (name: string) => {
  const found = TOOLS.find(each => each.name === name)
  if (found === undefined) throw new Error(`no ${name}`)
  return found
}

test('every row has its texts; the docs tools only where the mod keeps docs, none where it is off', () => {
  for (const each of TOOLS) expect(each.description.length * each.brief.length * each.label.length).toBeGreaterThan(0)
  const names = (settings: typeof DEFAULT_SETTINGS) => shownTools(settings).map(each => each.name)
  expect(names(DEFAULT_SETTINGS)).toContain('doc_outline')
  expect(names({ ...DEFAULT_SETTINGS, docs: { ...DEFAULT_SETTINGS.docs, dirs: [] } })).not.toContain('docs_mentioning')
  expect(names({ ...DEFAULT_SETTINGS, enabled: false })).toEqual([])
  expect(TOOLS.filter(each => each.writes).map(each => each.name)).toEqual(['shift', 'shift_history', 'shift_record', 'shift_setup'])
  expect(TOOLS.some(tool => tool.name.startsWith('task_'))).toBe(false)
})

test('a run parses its arguments and refuses; only the main agent shifts, once a turn', async () => {
  const project = await memoryProject()
  expect(await tool('shift').run({ letter: 'l.md', after: 'wait', about: 'a' }, callOn(project, { subagent: true }))).toEqual({
    deny: 'Only the main agent shifts, not a subagent.',
  })
  expect(await tool('shift').run({}, callOn(project, { loop: loopAt({ ...FRESH_LOOP, pending: {} as never }) }))).toEqual({
    deny: expect.stringContaining('already accepted'),
  })
  const early = await tool('shift').run(
    { letter: 'l.md', after: 'wait', about: 'a' },
    callOn(project, { cannotLetGo: async () => 'the history is 12K tokens.' }),
  )
  expect(early).toEqual({ deny: expect.stringContaining('Nothing to shift yet: the history is 12K tokens. Nothing was written.') })
  expect(await tool('shift_history').run({ count: 0 }, callOn(project))).toEqual({ deny: expect.stringContaining('count') })
  expect(await tool('doc_outline').run({}, callOn(project))).toEqual({ deny: expect.stringContaining('path') })
  expect(await tool('shift_status').run({}, callOn(project))).toEqual({ result: 'STATUS' })
})

test('a session starts with the rows for the owner, the tools shown and the doctrine listing only them', async () => {
  const broken = await startSession(await memoryProject({ [`${R}/settings.toml`]: 'enabled = nope' }))
  expect(broken.enabled).toBe(true)
  expect(broken.rows[0]).toEqual({ text: expect.stringContaining('The mod stays on.'), level: 'warning' })

  const docsOff = await startSession(
    await memoryProject({ [`${R}/settings.toml`]: '[docs]\ndirs = []', [`${R}/board.md`]: 'x' }, '/p', false),
  )
  expect(docsOff.tools.map(each => each.name)).not.toContain('doc_outline')
  expect(docsOff.doctrine).not.toContain('doc_outline')
  expect(docsOff.doctrineBody).toContain('- `shift_setup` — ')
  expect(docsOff.rows).toEqual([{ text: expect.stringContaining('the mod added ".shift/"'), level: 'info' }])

  const off = await startSession(await memoryProject({ [`${R}/settings.toml`]: 'enabled = false' }))
  expect(off).toMatchObject({ enabled: false, tools: [], rows: [] })
})

test('a doctrine built without a session start names the files where the settings put them, and only the tools shown', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    files: { ...DEFAULT_SETTINGS.files, owner: 'OWNER.md' },
    docs: { ...DEFAULT_SETTINGS.docs, dirs: [] },
  }
  const { doctrine, doctrineBody } = sessionDoctrine(settings)
  expect(doctrine).toStartWith('<shift note=')
  expect(doctrineBody).toStartWith('# Shift')
  expect(doctrineBody).toContain('`OWNER.md`')
  expect(doctrineBody).not.toContain('.shift/OWNER.md')
  expect(doctrineBody).not.toContain('doc_outline')
})

test('size table shows only sizes and the three newest available letters', async () => {
  const project = await memoryProject()
  for (const key of ['one', 'two', 'three', 'four']) {
    const id = await archiveCall<string>(project, {
      action: 'begin',
      key,
      about: key,
      files: { 'board.md': key, 'letter.md': 'Private sample' },
    })
    await archiveCall(project, { action: 'finish', id, state: 'complete', about: key, limit: 30 })
  }
  const report = await tool('shift_sizes').run({}, callOn(project))
  expect(report).toHaveProperty('result')
  if (!('result' in report)) throw Error('missing report')
  expect(report.result.match(/^\s*4 {2}s-[a-f0-9]{16}$/gm)).toHaveLength(3)
  expect(report.result).not.toContain('Private sample')
  expect(report.result).not.toContain('s-0000000000000001')
  expect(report.result).toContain('Session + continue')
  for (const section of ['flow', 'records']) {
    const result = await tool('shift_guide').run({ section }, callOn(project))
    if (!('result' in result)) throw Error('missing guide')
    expect(result.result.includes('## How to shift')).toBe(section === 'flow')
    expect(result.result.includes('## What goes where')).toBe(section === 'records')
  }
})

test('only a confirmed local task command can be recommended on startup, setup or task listing', async () => {
  const project = await memoryProject()
  let probes = 0
  let answer = './.shift/bin/shift-task.exe'
  project.store.beads = async (_root, args) => {
    probes++
    expect(args).toEqual(['shift-install-task'])
    if (answer === '') throw new Error('foreign executable')
    return answer
  }
  const setup = () => tool('shift_setup').run({ section: 'tasks' }, callOn(project))
  expect((await startSession(project)).doctrine).toContain('shift_setup(section="tasks")')
  expect(probes).toBe(0)
  expect(await setup()).toEqual({ result: expect.stringContaining('./.shift/bin/shift-task.exe prime') })
  expect(probes).toBe(1)
  project.settings.tasks.prepare = 'on_start'
  expect((await startSession(project)).doctrine).toContain('./.shift/bin/shift-task.exe prime')
  expect(await tasksView(project)).toContain('./.shift/bin/shift-task.exe list')
  expect(await setup()).toEqual({ result: expect.stringContaining('./.shift/bin/shift-task.exe prime') })
  for (answer of ['', './unrelated']) {
    const start = await startSession(project)
    expect(start.command).toBeNull()
    expect(start.doctrine).not.toContain('./.shift/bin/shift-task prime')
    expect(start.doctrine).toContain('shift_setup(section="tasks")')
    expect(await setup()).toHaveProperty('deny')
    expect(await tasksView(project)).not.toContain('./.shift/bin/shift-task list')
  }
})

test('a knowledge-only project delivers topics at startup and reads an entry without the tracker', async () => {
  const project = await memoryProject({ [`${R}/settings.toml`]: '[docs]\ndirs = []', [`${R}/knowledge/traps.md`]: TRAPS })
  project.store.beads = async () => {
    throw new Error('tracker offline')
  }
  const map = (await sessionFiles(project)).find(file => file.path === '.shift/SHIFT.md')?.text
  expect(map).toContain('## Knowledge')
  expect(map).toContain('sections: Edits')
  expect(map).not.toContain('third replacement')
  const read = (path: string, section?: string) => tool('shift_read').run({ path, section }, callOn(project))
  const entry = await read('knowledge/traps.md', 'The script stopped on the third replacement')
  expect(entry).toEqual({ result: expect.stringContaining('### The script stopped') })
  expect(await read('.shift/knowledge/traps.md', 'Edits')).toEqual({ result: expect.stringContaining('## Edits') })
  expect(await read('knowledge/traps.md')).toEqual({ result: TRAPS })
  expect(await read('knowledge/../OWNER.md')).toHaveProperty('deny')
  expect(await read('docs/manual.md')).toHaveProperty('deny')
})
