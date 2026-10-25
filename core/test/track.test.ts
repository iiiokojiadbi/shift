import { expect, test } from 'bun:test'
import { openTask, tasksView } from '../src/flows'
import { segment } from '../src/history'
import { parseOpenInput, parseTrackInput } from '../src/input'
import { loadProject } from '../src/project'
import { checkTask } from '../src/records'
import { updateTrack } from '../src/track'
import { R, ROOT, taskMd } from './fixtures'
import { memoryStore } from './memory'

const TRACK = '- [in progress] pi adapter — built\n- [open] pi distribution — ask the owner\n- [open] opencode adapter\n'
const LIST = '# Tasks\n\n- [in progress] [adapters](tasks/adapters/) — pi and opencode\n  - after: [core](archive/core/)\n'

const call = (raw: Record<string, unknown>) => {
  const input = parseTrackInput(raw)
  if (typeof input === 'string') throw new Error(input)
  return input
}

test('an item is found by its id; a track written without ids is numbered first', async () => {
  const store = memoryStore({ [`${R}/tasks/adapters/track.md`]: TRACK, [`${R}/TASKS.md`]: LIST })
  const done = await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', id: 2, status: 'done' }))
  expect(done).toEqual({ result: 'adapters/track.md: - [done] #2 pi distribution — ask the owner' })

  const noted = await updateTrack(
    await loadProject(store, ROOT),
    call({ task: 'adapters', id: '#3', status: 'in progress', note: 'started' }),
  )
  expect(noted).toEqual({ result: 'adapters/track.md: - [in progress] #3 opencode adapter — started' })

  const none = await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', id: 7, status: 'done' }))
  expect('deny' in none && none.deny).toContain('No item #7 in adapters. Its items:\n- [in progress] #1 pi adapter — built')

  await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', id: 1, status: 'done' }))
  const last = await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', id: 3, status: 'dropped', note: 'later' }))
  expect('result' in last && last.result).toContain('Every item of adapters is closed: archive it with task_archive')
  expect(store.files.get(`${R}/tasks/adapters/track.md`)).toBe(
    '- [done] #1 pi adapter — built\n- [done] #2 pi distribution — ask the owner\n- [dropped] #3 opencode adapter — later\n',
  )
})

test('a new item takes the next id, never one taken; an id written twice or left out by hand is given anew', async () => {
  const store = memoryStore({
    [`${R}/tasks/adapters/track.md`]: '- [done] #4 pi adapter\n- [open] #4 opencode adapter\n- [open] codex\n',
    [`${R}/TASKS.md`]: LIST,
  })
  expect(await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'gemini', status: 'open' }))).toEqual({
    result: 'adapters/track.md: - [open] #7 gemini',
  })
  expect(store.files.get(`${R}/tasks/adapters/track.md`)).toBe(
    '- [done] #4 pi adapter\n- [open] #5 opencode adapter\n- [open] #6 codex\n- [open] #7 gemini\n',
  )
  const twice = await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'Codex', status: 'open' }))
  expect('deny' in twice && twice.deny).toContain('"Codex" is already an item of adapters: #6.')

  expect(parseTrackInput({ task: 'adapters', id: 1, item: 'x', status: 'done' })).toContain('Pass id to change an item, or item to add')
  expect(parseTrackInput({ task: 'adapters', id: 'one', status: 'done' })).toContain('id is the number of a track item')
  expect(parseTrackInput({ task: 'adapters', status: 'deferred' })).toContain('pass note')
  expect(parseTrackInput({ task: 'adapters', status: 'done' })).toContain('"in progress", "deferred", "waiting for owner"')
  expect(parseTrackInput({ task: 'adapters', id: 1, status: 'deferred' })).toContain('"in progress", "open", "done", "dropped"')
  expect(parseTrackInput({ task: 'adapters', id: 1, status: 'done', note: 'on 2026-10-24' })).toContain('A date in note')

  await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', status: 'waiting for owner', note: 'the owner tries pi' }))
  expect(store.files.get(`${R}/TASKS.md`)).toBe(
    '# Tasks\n\n- [waiting for owner] [adapters](tasks/adapters/) — the owner tries pi\n  - after: [core](archive/core/)\n',
  )
  const missing = await updateTrack(await loadProject(store, ROOT), call({ task: 'nope', id: 1, status: 'done' }))
  expect('deny' in missing && missing.deny).toContain('the task is not open')
})

test("several items in one call are set together, or none when one fails; status beside them is the task's own", async () => {
  const store = memoryStore({ [`${R}/tasks/adapters/track.md`]: TRACK, [`${R}/TASKS.md`]: LIST })
  const both = await updateTrack(
    await loadProject(store, ROOT),
    call({
      task: 'adapters',
      items: [
        { id: 1, status: 'done', note: 'shipped' },
        { id: 2, status: 'in progress' },
        { item: 'codex', status: 'open' },
      ],
      status: 'waiting for owner',
      note: 'the owner tries pi',
    }),
  )
  expect(both).toEqual({
    result: [
      'adapters/track.md: - [done] #1 pi adapter — shipped',
      'adapters/track.md: - [in progress] #2 pi distribution — ask the owner',
      'adapters/track.md: - [open] #4 codex',
      '.shift/TASKS.md: - [waiting for owner] [adapters](tasks/adapters/) — the owner tries pi',
    ].join('\n'),
  })
  const before = store.files.get(`${R}/tasks/adapters/track.md`)
  const failed = await updateTrack(
    await loadProject(store, ROOT),
    call({
      task: 'adapters',
      items: [
        { id: 3, status: 'done' },
        { id: 9, status: 'done' },
      ],
    }),
  )
  expect('deny' in failed && failed.deny).toContain('items[1]: No item #9 in adapters')
  expect('deny' in failed && failed.deny).toContain('Nothing was written.')
  expect(store.files.get(`${R}/tasks/adapters/track.md`)).toBe(before)

  expect(parseTrackInput({ task: 'adapters', items: [{ id: 1, status: 'waiting for owner' }] })).toContain(
    'items[0]: status for a track item',
  )
  expect(parseTrackInput({ task: 'adapters', id: 1, items: [{ id: 2, status: 'done' }] })).toContain('Pass id and item inside items')
  expect(parseTrackInput({ task: 'adapters' })).toContain('status for a task')
})

test('an item reads the same everywhere: a cramped status line is found, and a new note on a done item is not done again', async () => {
  const store = memoryStore({
    [`${R}/tasks/adapters/track.md`]: '- [done]pi adapter\n- [open] opencode adapter\n',
    [`${R}/TASKS.md`]: LIST,
  })
  expect(await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', id: 1, status: 'done', note: 'shipped' }))).toEqual({
    result: 'adapters/track.md: - [done] #1 pi adapter — shipped',
  })
  const work = (track: string) => ({
    board: '',
    owner: null,
    tasks: [{ name: 'adapters', task: null, track, notes: [] }],
    knowledge: [],
    taskList: null,
    glossary: null,
    shift: null,
    archived: [],
    oldOwner: false,
  })
  const before = { work: work('- [done] pi adapter — built'), index: null }
  expect(segment({ work: work('- [done] #1 pi adapter — shipped'), index: null }, before).done).toEqual([])
  expect(segment({ work: work('- [done] pi adapter\n- [dropped] opencode — later'), index: null }, before).dropped).toEqual([
    'adapters: opencode — later',
  ])
})

test('a task opens valid by construction: its files and its line with links, or nothing at all', async () => {
  const store = memoryStore({
    [`${R}/tasks/adapters/track.md`]: TRACK,
    [`${R}/tasks/adapters/task.md`]: taskMd('A'),
    [`${R}/TASKS.md`]: LIST,
  })
  store.files.set(`${R}/archive/core/task.md`, taskMd('Core'))
  const open = async (raw: Record<string, unknown>) => {
    const input = parseOpenInput({ title: 'Delivery', goal: 'one module', done_when: 'both adapters', about: 'notes to the agent', ...raw })
    return typeof input === 'string' ? { deny: input } : openTask(await loadProject(store, ROOT), input)
  }

  const opened = await open({
    name: 'delivery',
    items: ['the core — over a port', 'Claude Code'],
    needs: ['adapters — the slots first'],
    continues: ['core'],
  })
  expect('result' in opened && opened.result).toContain('- [in progress] [delivery](tasks/delivery/) — notes to the agent')
  expect(store.files.get(`${R}/TASKS.md`)).toEndWith(
    '- [in progress] [delivery](tasks/delivery/) — notes to the agent\n  - needs: [adapters](tasks/adapters/) — the slots first\n  - continues: [core](archive/core/)\n',
  )
  expect(store.files.get(`${R}/tasks/delivery/track.md`)).toBe('- [open] #1 the core — over a port\n- [open] #2 Claude Code\n')
  expect('result' in opened && opened.result).toContain('Its items, each changed with task_track by its id:\n- [open] #1 the core')
  const task = store.files.get(`${R}/tasks/delivery/task.md`) ?? ''
  expect(task).toStartWith('# Delivery\n\n## Goal\n\none module\n\n## Done when\n\nboth adapters\n\n## Owner decisions\n\nnone\n')
  expect(checkTask({ name: 'delivery', task, track: '', notes: [] })).toBeNull()

  expect(await open({ name: 'delivery' })).toEqual({ deny: expect.stringContaining('already exists') })
  expect(await open({ name: 'core' })).toEqual({ deny: expect.stringContaining('is archived') })
  // A link to nothing refuses, and nothing is written.
  const before = store.files.get(`${R}/TASKS.md`)
  expect(await open({ name: 'later', needs: ['ghost'] })).toEqual({ deny: expect.stringMatching(/^Nothing was written\. .*ghost/) })
  expect(store.files.get(`${R}/TASKS.md`)).toBe(before)
  expect(store.files.has(`${R}/tasks/later/task.md`)).toBe(false)
  expect(await open({ name: 'later', goal: 'by 2026-01-02' })).toEqual({ deny: expect.stringContaining('no dates') })
  expect(await open({ name: 'later', status: 'deferred', about: '' })).toEqual({ deny: expect.stringContaining('why it is deferred') })

  // A list that said "none" says it no more.
  const empty = memoryStore({ [`${R}/TASKS.md`]: '# Tasks\n\nnone\n' })
  const input = parseOpenInput({ name: 'first', title: 'F', goal: 'g', done_when: 'd', about: 'a' })
  if (typeof input === 'string') throw new Error(input)
  await openTask(await loadProject(empty, ROOT), input)
  expect(empty.files.get(`${R}/TASKS.md`)).toBe('# Tasks\n\n- [in progress] [first](tasks/first/) — a\n')
})

test('/shift-tasks shows every open task, and the items not closed of those in progress', async () => {
  const list = `${LIST}- [deferred] [later](tasks/later/) — after the adapters\n`
  const store = memoryStore({
    [`${R}/tasks/adapters/track.md`]: TRACK.replace('[in progress] pi adapter', '[done] pi adapter'),
    [`${R}/tasks/later/track.md`]: '- [open] one\n',
    [`${R}/TASKS.md`]: list,
  })
  expect(await tasksView(await loadProject(store, ROOT))).toBe(
    [
      'open tasks in .shift/TASKS.md',
      '',
      '[in progress] adapters — 1 of 3 items closed',
      '    pi and opencode',
      '    [open] pi distribution',
      '    [open] opencode adapter',
      '',
      '[deferred] later — 0 of 1 items closed',
      '    after the adapters',
    ].join('\n'),
  )
  expect(await tasksView(await loadProject(memoryStore({ [`${R}/TASKS.md`]: '# Tasks\n\nnone\n' }), ROOT))).toBe(
    'no open tasks in .shift/TASKS.md',
  )
})
