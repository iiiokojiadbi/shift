import { expect, test } from 'bun:test'
import type { Project } from '../src/project'
import { DEFAULT_SETTINGS } from '../src/settings'
import { shownTools, startSession, TOOLS, type ToolCall } from '../src/tools'
import { R } from './fixtures'
import { memoryProject } from './memory'

const callOn = (project: Project, extra: Partial<ToolCall> = {}): ToolCall => ({
  project: async () => project,
  sessionId: async () => 's1',
  now: async () => 0,
  subagent: false,
  pending: false,
  loaded: async () => null,
  status: async () => 'STATUS',
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
  expect(TOOLS.filter(each => each.writes).map(each => each.name)).toEqual(['shift', 'task_open', 'task_archive', 'task_track'])
})

test('a run parses its arguments and refuses; only the main agent shifts, once a turn', async () => {
  const project = await memoryProject({ [`${R}/TASKS.md`]: 'none' })
  expect(await tool('shift').run({ letter: 'l.md', after: 'wait', about: 'a' }, callOn(project, { subagent: true }))).toEqual({
    deny: 'Only the main agent shifts, not a subagent.',
  })
  expect(await tool('shift').run({}, callOn(project, { pending: true }))).toEqual({ deny: expect.stringContaining('already accepted') })
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
