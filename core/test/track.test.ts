import { expect, test } from 'bun:test'
import { segment } from '../src/history'
import { parseTrackInput } from '../src/input'
import { loadProject } from '../src/project'
import { updateTrack } from '../src/track'
import { R, ROOT } from './fixtures'
import { memoryStore } from './memory'

const TRACK = '- [in progress] pi adapter — built\n- [open] pi distribution — ask the owner\n- [open] opencode adapter\n'
const LIST = '# Tasks\n\n- [in progress] [adapters](tasks/adapters/) — pi and opencode\n  - after: [core](archive/core/)\n'

const call = (raw: Record<string, unknown>) => {
  const input = parseTrackInput(raw)
  if (typeof input === 'string') throw new Error(input)
  return input
}

test('an item is found by words of its name, never by its note, and only when one matches', async () => {
  const store = memoryStore({ [`${R}/tasks/adapters/track.md`]: TRACK, [`${R}/TASKS.md`]: LIST })
  const done = await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'distribution', status: 'done' }))
  expect(done).toEqual({ result: 'adapters/track.md: - [done] pi distribution — ask the owner' })

  const noted = await updateTrack(
    await loadProject(store, ROOT),
    call({ task: 'adapters', item: 'OPENCODE', status: 'in progress', note: 'started' }),
  )
  expect(noted).toEqual({ result: 'adapters/track.md: - [in progress] opencode adapter — started' })

  const many = await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'adapter', status: 'done' }))
  expect('deny' in many && many.deny).toContain(
    '"adapter" is in 2 items of adapters:\n1. - [in progress] pi adapter — built\n2. - [in progress] opencode adapter — started',
  )
  const none = await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'built', status: 'done' }))
  expect('deny' in none && none.deny).toContain('No item of adapters has "built" in its name. Its items:\n1. - [in progress] pi adapter')

  await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'pi adapter', status: 'done' }))
  const last = await updateTrack(
    await loadProject(store, ROOT),
    call({ task: 'adapters', item: 'opencode', status: 'dropped', note: 'later' }),
  )
  expect('result' in last && last.result).toContain('Every item of adapters is closed: archive it with task_archive')
  expect(store.files.get(`${R}/tasks/adapters/track.md`)).toBe(
    '- [done] pi adapter — built\n- [done] pi distribution — ask the owner\n- [dropped] opencode adapter — later\n',
  )
})

test('add puts a new item at the end, once; without an item the task line in TASKS.md takes the status', async () => {
  const store = memoryStore({ [`${R}/tasks/adapters/track.md`]: TRACK, [`${R}/TASKS.md`]: LIST })
  expect(await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'codex', status: 'open', add: true }))).toEqual({
    result: 'adapters/track.md: - [open] codex',
  })
  expect(store.files.get(`${R}/tasks/adapters/track.md`)?.endsWith('- [open] opencode adapter\n- [open] codex\n')).toBe(true)
  const twice = await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'Codex', status: 'open', add: true }))
  expect('deny' in twice && twice.deny).toContain('already an item')

  expect(parseTrackInput({ task: 'adapters', status: 'deferred' })).toContain('pass note')
  expect(parseTrackInput({ task: 'adapters', status: 'done' })).toContain('"in progress", "deferred", "waiting for owner"')
  expect(parseTrackInput({ task: 'adapters', item: 'x', status: 'deferred' })).toContain('"in progress", "open", "done", "dropped"')
  expect(parseTrackInput({ task: 'adapters', item: 'x', status: 'done', note: 'on 2026-10-24' })).toContain('A date in note')

  await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', status: 'waiting for owner', note: 'the owner tries pi' }))
  expect(store.files.get(`${R}/TASKS.md`)).toBe(
    '# Tasks\n\n- [waiting for owner] [adapters](tasks/adapters/) — the owner tries pi\n  - after: [core](archive/core/)\n',
  )
  const missing = await updateTrack(await loadProject(store, ROOT), call({ task: 'nope', item: 'x', status: 'done' }))
  expect('deny' in missing && missing.deny).toContain('the task is not open')
})

test('an item reads the same everywhere: a cramped status line is found, and a new note on a done item is not done again', async () => {
  const store = memoryStore({
    [`${R}/tasks/adapters/track.md`]: '- [done]pi adapter\n- [open] opencode adapter\n',
    [`${R}/TASKS.md`]: LIST,
  })
  expect(
    await updateTrack(await loadProject(store, ROOT), call({ task: 'adapters', item: 'pi adapter', status: 'done', note: 'shipped' })),
  ).toEqual({
    result: 'adapters/track.md: - [done] pi adapter — shipped',
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
  expect(segment({ work: work('- [done] pi adapter — shipped'), index: null }, before).done).toEqual([])
  expect(segment({ work: work('- [done] pi adapter\n- [dropped] opencode — later'), index: null }, before).dropped).toEqual([
    'adapters: opencode — later',
  ])
})
