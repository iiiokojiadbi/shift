// Point at the installed npm package. Uses its real process port and a disposable repository.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { Store } from '../core/src/store'
import type { Tool, ToolCall } from '../core/src/tools'
import { BOARD, LETTER, OWNER } from '../core/test/data'

const pkg = process.argv[2]
if (!pkg) throw new Error('Pass the installed Shift npm package directory.')
const { nodeStore }: { nodeStore: Store } = await import(pathToFileURL(resolve(pkg, 'store.ts')).href)
const run = nodeStore.beads
if (!run) throw new Error('Missing installed runtime port.')
const base = '/tmp/shift'
await mkdir(base, { recursive: true })
const dir = await mkdtemp(join(base, 'installed-bd-'))
try {
  const project = join(dir, 'project')
  const neighbor = join(project, '.beads')
  const trap = join(dir, 'path')
  const profile = join(dir, 'user')
  for (const path of [neighbor, trap, join(profile, '.config', 'beads')]) await mkdir(path, { recursive: true })
  execFileSync('git', ['init', '-q', project])
  const marker = join(neighbor, 'sentinel')
  await writeFile(marker, 'unrelated')
  await writeFile(join(profile, '.config/beads/config.yaml'), 'issue-prefix: wrong\n')
  await writeFile(join(trap, 'bd'), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
  Object.assign(process.env, {
    HOME: profile,
    PATH: [trap, process.env.PATH].join(delimiter),
    BEADS_DIR: neighbor,
    XDG_CACHE_HOME: join(dir, 'cache'),
  })
  const invoke = (args: string[]) => run(project, args)
  assert.match(await invoke(['version']), /\b1\.3\.4\b/)
  await assert.rejects(invoke(['unknown-operation']), /unknown Shift runtime command/)
  assert.ok(!(await readdir(project)).includes('.shift'))
  const { TOOLS, loadProject, startSession, acceptShift, settleShift, resumeShift, promptRecords, waitingNote, FRESH_LOOKS } = await import(
    pathToFileURL(resolve(pkg, 'core/index.ts')).href
  )
  const source = await loadProject(nodeStore, project, 'writer')
  const startup = await startSession(source)
  assert.ok(!(await readdir(join(project, '.shift'))).includes('beads'), 'Startup must leave Beads unopened.')
  assert.ok(startup.enabled)
  const sbd = resolve(project, '.shift/bin/sbd')
  const runCLI = promisify(execFile)
  const cli = async (...args: string[]) => (await runCLI(sbd, args, { cwd: project })).stdout
  assert.match(await cli('prime'), /bd ready/)
  const created = await Promise.all(['Left', 'Right'].map(async title => JSON.parse(await cli('create', title, '--json')).id))
  assert.equal(new Set(created).size, 2)
  assert.deepEqual(
    JSON.parse(await cli('ready', '--json'))
      .map((issue: { id: string }) => issue.id)
      .sort(),
    created.sort(),
  )
  async function call(name: string, args: Record<string, unknown>, actor = 'writer') {
    const tool = (TOOLS as Tool[]).find(each => each.name === name)
    assert.ok(tool)
    const context = { project: () => loadProject(nodeStore, project, actor), sessionId: async () => actor, now: async () => Date.now() }
    const done = await tool.run(args, context as ToolCall)
    if ('deny' in done) throw new Error(done.deny)
    return done.result
  }
  const { id: epic } = JSON.parse(await cli('create', 'Verify task transfer', '--type=epic', '--json'))
  await cli('comments', 'add', epic, 'Independent evidence')
  assert.match(await cli('comments', epic, '--json'), /Independent evidence/)
  await writeFile(join(project, '.shift', 'board.md'), BOARD)
  await writeFile(join(project, '.shift', 'OWNER.md'), OWNER)
  const letter = LETTER.replace('HOLD-THIS', 'Literal tag in the letter:\n</shift>\n\nHOLD-THIS')
  await writeFile(join(project, '.shift', 'letter.md'), letter)
  const stamp = Date.now()
  const accept = (at = stamp) =>
    acceptShift(source, { input: { after: 'continue', letter: '.shift/letter.md', about: 'Storage test' }, sessionId: 'writer', at })
  const accepted = await accept()
  assert.ok(accepted.shift, JSON.stringify(accepted))
  assert.deepEqual((await accept(stamp + 1)).shift, accepted.shift)
  assert.match(accepted.shift.dir, /^s-/)
  const settlement = { shift: accepted.shift, before: 90000, after: 12000, messages: [{ role: 'assistant', text: 'Test saved' }] }
  await settleShift(source, settlement)
  await settleShift(source, settlement)
  const restored = await resumeShift(source)
  assert.equal(restored.waiting, accepted.shift.dir)
  await run(project, ['shift-history'], JSON.stringify({ action: 'received', session: 'writer', id: restored.waiting, limit: 30 }))
  assert.ok(!restored.prompt.includes('Independent evidence'))
  assert.ok(restored.prompt.includes(letter.trim()))
  const record = await call('shift_history', { action: 'export', id: accepted.shift.dir })
  assert.ok(!record.includes(epic))
  let observed = { ...FRESH_LOOKS }
  const courier = {
    project: async () => source,
    looks: async () => observed,
    updateLooks: async (fn: (old: typeof observed) => typeof observed) => {
      observed = fn(observed)
    },
  }
  // A task database failure must leave the archive usable. Obstruct its
  // normal path until both chats have recovered their respective letters.
  const workspace = join(project, '.shift', 'beads')
  const moved = join(dir, 'unavailable')
  await rename(workspace, moved)
  await writeFile(workspace, 'unavailable')
  await (await promptRecords(courier, true)).delivered()
  await writeFile(join(project, '.shift', 'board.md'), BOARD.replace('## Goal', '## Goal\nReview the updated board.'))
  const waitCall = await acceptShift(source, {
    input: { after: 'wait', letter: '.shift/letter.md', about: 'Wait for updates' },
    sessionId: 'writer',
    at: Date.now(),
  })
  assert.ok(waitCall.shift, JSON.stringify(waitCall))
  const waiting = await settleShift(source, { ...settlement, shift: waitCall.shift })
  // The process stopped after committing the wait and before writing local loop state.
  const emptyLoop = { read: async () => ({ pending: null, note: null }), tell: () => {} }
  await (await promptRecords(courier, true)).delivered()
  const offerWait = () => waitingNote(emptyLoop, source)
  const parked = { ...waiting.note, held: [{ text: 'Message after the letter', attachments: ['image'] }] }
  const fromMemory = await waitingNote({ ...emptyLoop, read: async () => ({ pending: null, note: parked }) }, source)
  assert.equal(fromMemory.context.split(letter.trim()).length, 2)
  assert.equal(fromMemory.context.split('HOLD-THIS').length, 2)
  assert.ok(fromMemory.context.endsWith('Message after the letter'))
  assert.deepEqual(fromMemory.attachments, ['image'])
  const reader = await loadProject(nodeStore, project, 'reader')
  const newerLetter = letter.replace('HOLD-THIS', 'HOLD-READER')
  await writeFile(join(project, '.shift', 'letter.md'), newerLetter)
  const newer = await acceptShift(reader, {
    input: { after: 'continue', letter: '.shift/letter.md', about: 'Independent reader shift' },
    sessionId: 'reader',
    at: Date.now(),
  })
  assert.ok(newer.shift, JSON.stringify(newer))
  await settleShift(reader, { ...settlement, shift: newer.shift })
  const explicit = await resumeShift(source)
  assert.equal(explicit.waiting, waitCall.shift.dir)
  assert.ok(!explicit.prompt.includes(newer.shift.dir))
  assert.ok(explicit.prompt.includes(letter.trim()))
  assert.ok((await resumeShift(reader)).prompt.includes(newerLetter.trim()))
  const recovered = await offerWait()
  assert.ok(recovered)
  assert.doesNotMatch(recovered.context, /Independent evidence/)
  assert.equal(recovered.context.split(letter.trim()).length, 2)
  assert.equal((await offerWait()).context, recovered.context)
  await recovered.delivered()
  assert.equal(await offerWait(), null)
  assert.match(await call('shift_history', { action: 'search', query: 'HOLD-THIS' }), /shift · s-.*letter.md/)
  await rm(workspace)
  await rename(moved, workspace)
  await cli('close', epic)
  const copy = join(dir, 'copied')
  await cp(join(project, '.shift'), join(copy, '.shift'), { recursive: true })
  const copied = await loadProject(nodeStore, copy, 'writer')
  const copiedCall = { project: async () => copied, sessionId: async () => 'writer', now: async () => Date.now() }
  assert.ok((await resumeShift(copied)).prompt.includes(newerLetter.trim()))
  const history = (TOOLS as Tool[]).find(t => t.name === 'shift_history')
  assert.ok(history)
  await startSession(copied)
  const copiedCLI = (...args: string[]) => execFileSync(resolve(copy, '.shift/bin/sbd'), args, { cwd: copy, encoding: 'utf8' })
  assert.match(copiedCLI('comments', epic, '--json'), /Independent evidence/)
  assert.equal(JSON.parse(copiedCLI('show', epic, '--json'))[0].status, 'closed')
  assert.equal(JSON.parse(copiedCLI('ready', '--json')).length, created.length)
  assert.match(
    JSON.stringify(await history.run({ action: 'compare', id: accepted.shift.dir, other: waitCall.shift.dir }, copiedCall as ToolCall)),
    /Wait for updates/,
  )
  console.log(
    'Verified transactional save, retry, live restore, independent export, restore with an unavailable task database and offline transfer.',
  )
  const rotation = join(dir, 'rotation')
  const records = join(rotation, '.shift')
  await mkdir(records, { recursive: true })
  await writeFile(join(records, 'settings.toml'), 'history_limit = 1\ncommit = true\n')
  await writeFile(join(records, 'OWNER.md'), OWNER)
  const undelivered = []
  for (const chat of ['first', 'second']) {
    const p = await loadProject(nodeStore, rotation, chat)
    await writeFile(join(records, 'board.md'), BOARD.replace('## Goal', `## Goal\nWork for ${chat}.`))
    await writeFile(join(records, 'letter.md'), LETTER.replace('HOLD-THIS', `Only for ${chat}`))
    const result = await acceptShift(p, {
      input: { after: 'continue', letter: '.shift/letter.md', about: chat },
      sessionId: chat,
      at: Date.now(),
    })
    assert.ok(result.shift, JSON.stringify(result))
    await settleShift(p, { ...settlement, shift: result.shift })
    undelivered.push(result.shift.dir)
  }
  const secondChat = await loadProject(nodeStore, rotation, 'second')
  const secondDelivery = await waitingNote(emptyLoop, secondChat)
  assert.ok(secondDelivery?.context.includes('Only for second'))
  await secondDelivery.delivered()
  const firstChat = await loadProject(nodeStore, rotation, 'first')
  const firstDelivery = await waitingNote(emptyLoop, firstChat)
  assert.ok(firstDelivery?.context.includes('Only for first'))
  assert.ok(!firstDelivery.context.includes('Only for second'))
  await firstDelivery.delivered()
  assert.equal(await waitingNote(emptyLoop, firstChat), null)
  assert.deepEqual(
    JSON.parse(await run(rotation, ['shift-history'], '{"action":"list"}')).map((e: { id: string }) => e.id),
    undelivered.slice(1),
  )
  const redirect = join(project, '.shift', 'beads', '.beads', 'redirect')
  await writeFile(redirect, neighbor)
  await assert.rejects(cli('create', 'Refused', '--json'), /redirect/)
  assert.deepEqual(await readdir(neighbor), ['sentinel'])
  assert.equal(await readFile(marker, 'utf8'), 'unrelated')
  const cache = join(dir, 'cache', 'shift', 'beads')
  const [generation] = await readdir(cache)
  assert.ok(generation)
  await writeFile(join(cache, generation, 'bd'), 'invalid')
  await assert.rejects(invoke(['version']), /checksum/)
  console.log(
    'Installed npm adapter: two durable tasks, independent reopen, private paths, redirect refusal and cache verification passed.',
  )
} finally {
  await rm(dir, { recursive: true, force: true })
}
