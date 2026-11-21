// Point at the installed npm package. Uses its real process port and a disposable repository.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
  assert.ok(!(await readdir(project)).includes('.shift'))
  await invoke(['init', '--non-interactive', '--skip-hooks', '--skip-agents', '--prefix', 'shift'])
  const created = await Promise.all(['Left', 'Right'].map(async title => JSON.parse(await invoke(['create', title, '--json'])).id))
  assert.equal(new Set(created).size, 2)
  assert.deepEqual(
    JSON.parse(await invoke(['list', '--json']))
      .map((issue: { id: string }) => issue.id)
      .sort(),
    created.sort(),
  )
  const { TOOLS, loadProject, acceptShift, settleShift, resumeShift, sessionFiles, promptRecords, waitingNote, FRESH_LOOKS } = await import(
    pathToFileURL(resolve(pkg, 'core/index.ts')).href
  )
  async function call(name: string, args: Record<string, unknown>, actor = 'writer') {
    const tool = (TOOLS as Tool[]).find(each => each.name === name)
    assert.ok(tool)
    const context = { project: () => loadProject(nodeStore, project, actor), sessionId: async () => actor, now: async () => Date.now() }
    const done = await tool.run(args, context as ToolCall)
    if ('deny' in done) throw new Error(done.deny)
    return done.result
  }
  const open = (name: string, extra: Record<string, unknown> = {}) =>
    call('task_open', { name, title: name, goal: 'Goal', done_when: 'Ready', about: 'Work', ...extra })
  await open('epic', { kind: 'epic' })
  await open('blocker', { parent: 'epic', items: ['Item A'], labels: ['release'] })
  await open('dependent', { needs: ['blocker'], status: 'open' })
  assert.match(await call('task_query', { view: 'show', task: 'dependent' }), /needs: shift-blocker/)
  assert.match(await call('task_query', { view: 'show', task: 'blocker' }), /parent-child: shift-epic/)
  await call('task_manage', { task: 'dependent', action: 'release' })
  assert.doesNotMatch(await call('task_query', { view: 'ready' }), /shift-dependent/)
  await assert.rejects(
    call('task_track', {
      task: 'blocker',
      items: [
        { id: 1, status: 'done' },
        { id: 500, status: 'done' },
      ],
    }),
    /no item #500/,
  )
  assert.match(await call('task_query', { view: 'show', task: 'blocker' }), /#1 \[open\]/)
  await call('task_manage', { task: 'blocker', action: 'comment', text: 'Independent evidence' }, 'reader')
  assert.match(await call('task_query', { view: 'comments', task: 'blocker' }), /Independent evidence/)
  assert.match(await call('task_query', { view: 'open', labels: ['release'] }), /shift-blocker/)
  await call('task_track', { task: 'blocker', id: 1, status: 'done' })
  await call('task_archive', { name: 'blocker', outcome: 'done', about: 'Verified.' })
  assert.match(await call('task_query', { view: 'ready' }), /shift-dependent/)
  await assert.rejects(call('task_manage', { action: 'edit', task: 'blocker', goal: 'Edited goal' }), /Reopen/)
  await call('task_manage', { action: 'reopen', task: 'blocker' })
  assert.match(await call('task_query', { view: 'history', task: 'blocker' }), /shift-blocker/)
  const claims = await Promise.allSettled(['one', 'two'].map(actor => call('task_manage', { task: 'dependent', action: 'claim' }, actor)))
  assert.equal(claims.filter(each => each.status === 'fulfilled').length, 1)
  // A small change to a large tracker still transports the complete item metadata.
  const manyItems = Array.from({ length: 700 }, (_, i) => `Evidence ${i + 1} ${'x'.repeat(100)}`)
  await open('long-tracker', { items: manyItems, status: 'open' })
  await call('task_track', { task: 'long-tracker', id: 700, status: 'done' })
  assert.match(await call('task_query', { view: 'show', task: 'long-tracker' }), /#700 \[done\] Evidence 700/)
  const longComment = `  ${'review Δ\n'.repeat(20000)}  \n`
  await call('task_manage', { task: 'long-tracker', action: 'comment', text: longComment }, 'reader')
  const comments = JSON.parse(await call('task_query', { view: 'comments', task: 'long-tracker' }))
  assert.equal(comments.at(-1)?.text, longComment)
  await open('abandoned-epic', { kind: 'epic', status: 'open' })
  await open('abandoned-child', { parent: 'abandoned-epic', needs: ['long-tracker'], status: 'open' })
  await call('task_archive', { name: 'abandoned-epic', outcome: 'dropped', about: 'Stop the umbrella project.' })
  assert.match(await call('task_query', { view: 'show', task: 'abandoned-child' }), /parent-child: shift-abandoned-epic \[closed\]/)
  await call('task_archive', { name: 'abandoned-child', outcome: 'dropped', about: 'Stop blocked work.' })
  assert.match(await call('task_query', { view: 'show', task: 'abandoned-child' }), /needs: shift-long-tracker \[open\]/)
  console.log(
    'Public task tools passed creation, epic membership, labels, comments, atomic item rejection, blocker resolution, reopen and concurrent claims.',
  )
  const [snapshot] = JSON.parse(await invoke(['show', 'shift-epic', '--brief-deps', '--json']))
  const checked = (...args: string[]) => run(project, ['shift-task'], JSON.stringify({ args, expected: [snapshot] }))
  await checked('update', snapshot.id, '--set-labels=changed')
  await assert.rejects(checked('update', snapshot.id, '--set-labels=stale'), /changed/)
  await call('task_manage', { task: 'epic', action: 'edit', evidence: 'First writer' })
  assert.match(await call('task_query', { view: 'show', task: 'epic' }), /child: shift-blocker/)
  await call('task_manage', { action: 'block', task: 'epic', target: created[0] })
  await call('task_manage', { action: 'unblock', task: 'epic', target: created[0] })
  const source = await loadProject(nodeStore, project, 'writer')
  const legacy = join(project, '.shift', 'TASKS.md')
  await writeFile(legacy, '# Tasks\n\n- [in progress] [epic](tasks/epic/) — Existing epic\n')
  await writeFile(join(project, '.shift', 'board.md'), BOARD)
  await writeFile(join(project, '.shift', 'OWNER.md'), OWNER)
  const legacyArchive = join(project, '.shift', 'archive')
  await mkdir(legacyArchive, { recursive: true })
  await writeFile(join(legacyArchive, 'config.toml'), 'history_limit = 30\n')
  await writeFile(join(legacyArchive, 'handbook.md'), 'Current handbook\n')
  const letter = LETTER.replace('HOLD-THIS', 'Literal tag in the letter:\n</shift>\n\nHOLD-THIS')
  await writeFile(join(project, '.shift', 'letter.md'), letter)
  await call('shift_migrate', { action: 'start' })
  assert.match(await call('shift_migrate', { action: 'status' }), /epic: transfer pending/)
  await call('shift_migrate', { action: 'confirm', task: 'epic' })
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
  assert.match(restored.prompt, /shift-epic/)
  assert.ok(restored.prompt.includes(letter.trim()))
  const receipt = /receipt="([a-f0-9]+)"/.exec(restored.prompt)?.[1]
  assert.ok(receipt)
  await assert.rejects(call('shift_migrate', { action: 'cleanup', id: accepted.shift.dir }), /restore/)
  const record = await call('shift_history', { action: 'export', id: accepted.shift.dir })
  assert.ok(!record.includes('TASKS.md') && !record.includes('shift-epic'))
  const migration = JSON.parse(await readFile(join(project, '.shift/migration.json'), 'utf8'))
  const backupList = join(project, '.shift', migration.backup, 'TASKS.md')
  const original = await readFile(backupList, 'utf8')
  await writeFile(backupList, 'broken')
  await assert.rejects(call('shift_migrate', { action: 'cleanup', id: accepted.shift.dir, receipt }), /backup verification/)
  assert.equal(await readFile(legacy, 'utf8'), original)
  await writeFile(backupList, original)
  const settings = join(project, '.shift', 'settings.toml')
  const handbook = join(project, 'docs', 'handbook.md')
  await symlink(join(legacyArchive, 'config.toml'), settings)
  await assert.rejects(call('shift_migrate', { action: 'cleanup', id: accepted.shift.dir, receipt }), /configured project file/)
  assert.equal(await readFile(settings, 'utf8'), 'history_limit = 30\n')
  await rm(settings)
  await mkdir(join(project, 'docs'), { recursive: true })
  await symlink(join(legacyArchive, 'handbook.md'), handbook)
  await assert.rejects(call('shift_migrate', { action: 'cleanup', id: accepted.shift.dir, receipt }), /configured project file/)
  assert.equal(await readFile(handbook, 'utf8'), 'Current handbook\n')
  await rm(handbook)
  await call('shift_migrate', { action: 'cleanup', id: accepted.shift.dir, receipt })
  assert.match(await call('shift_migrate', { action: 'cleanup', id: accepted.shift.dir, receipt }), /already finished/)
  assert.ok(!(await sessionFiles(source)).some((f: { path: string }) => f.path === 'shift:migration'))
  let observed = { ...FRESH_LOOKS }
  let graphCalls = 0
  const countedStore: Store = {
    ...nodeStore,
    beads: async (root, args, stdin) => {
      if (args[0] === 'shift-task') graphCalls++
      return run(root, args, stdin)
    },
  }
  const courier = {
    project: async () => ({ ...source, store: countedStore }),
    looks: async () => observed,
    updateLooks: async (fn: (old: typeof observed) => typeof observed) => {
      observed = fn(observed)
    },
  }
  await promptRecords(courier, true) // A host need not acknowledge a prompt with no notes.
  const warmCalls = graphCalls
  await promptRecords(courier, true)
  assert.equal(graphCalls, warmCalls, 'An unchanged prompt should not launch bd to poll comments.')
  await open('first-comment')
  // The notification transports one count even when the discussion exceeds a host's buffered output limit.
  await call('task_manage', { action: 'comment', task: 'first-comment', text: 'While you were away. '.repeat(225000) }, 'reader')
  const firstComment = await promptRecords(courier, true)
  assert.match(JSON.stringify(firstComment.notes), /shift-first-comment: 1 new external comment/)
  await firstComment.delivered()
  await call('task_manage', { action: 'comment', task: 'epic', text: 'From the reader' }, 'reader')
  await call('task_manage', { action: 'comment', task: 'epic', text: 'My own comment' }, 'writer')
  const offer = await promptRecords(courier, true)
  assert.deepEqual(offer.notes.filter((n: { body: string }) => n.body.includes('external comment')).length, 1)
  assert.match(JSON.stringify(offer.notes), /1 new external comment/)
  await offer.delivered()
  assert.doesNotMatch(JSON.stringify((await promptRecords(courier, true)).notes), /external comment/)
  observed = { ...observed, refreshClaims: true }
  const resumedCards = await promptRecords(courier, true)
  assert.match(JSON.stringify(resumedCards.notes), /First writer/)
  await resumedCards.delivered()
  observed = { ...observed, refreshClaims: true }
  assert.doesNotMatch(JSON.stringify((await promptRecords(courier, true)).notes), /First writer/)
  // An external comment contributes to graph progress. The issue timestamp alone misses this case.
  const waitCall = await acceptShift(source, {
    input: { after: 'wait', letter: '.shift/letter.md', about: 'Wait for updates' },
    sessionId: 'writer',
    at: Date.now(),
  })
  assert.ok(waitCall.shift, JSON.stringify(waitCall))
  const waiting = await settleShift(source, { ...settlement, shift: waitCall.shift })
  assert.ok(!waiting.note.context.includes('First writer'))
  await call('task_manage', { action: 'edit', task: 'epic', evidence: 'Evidence added while waiting' })
  // The process stopped after committing the wait and before writing local loop state.
  const emptyLoop = { read: async () => ({ pending: null, note: null }), tell: () => {} }
  await (await promptRecords(courier, true)).delivered()
  observed = { ...observed, refreshClaims: true, claimDigest: undefined }
  assert.doesNotMatch(JSON.stringify((await promptRecords(courier, true)).notes), /Evidence added while waiting/)
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
  assert.match(recovered.context, /Evidence added while waiting/)
  assert.equal(recovered.context.split(letter.trim()).length, 2)
  assert.equal((await offerWait()).context, recovered.context)
  await recovered.delivered()
  assert.equal(await offerWait(), null)
  await call('task_manage', { task: 'epic', action: 'release' })
  await (await promptRecords(courier, true)).delivered()
  await call('task_manage', { task: 'epic', action: 'claim' })
  assert.doesNotMatch(JSON.stringify((await promptRecords(courier, true)).notes), /external comment/)
  assert.match(await call('shift_history', { action: 'search', query: 'HOLD-THIS' }), /shift · s-.*letter.md/)
  assert.match(await call('shift_history', { action: 'search', query: 'epic' }), /task · shift-epic/)
  await call('task_archive', { name: 'blocker', outcome: 'done', about: 'Closed for transfer.' })
  const copy = join(dir, 'copied')
  await cp(join(project, '.shift'), join(copy, '.shift'), { recursive: true })
  const copied = await loadProject(nodeStore, copy, 'writer')
  const copiedCall = { project: async () => copied, sessionId: async () => 'writer', now: async () => Date.now() }
  assert.ok((await resumeShift(copied)).prompt.includes(newerLetter.trim()))
  const query = (TOOLS as Tool[]).find(t => t.name === 'task_query')
  const history = (TOOLS as Tool[]).find(t => t.name === 'shift_history')
  assert.ok(query && history)
  assert.match(JSON.stringify(await query.run({ view: 'closed' }, copiedCall as ToolCall)), /shift-blocker/)
  assert.match(JSON.stringify(await query.run({ view: 'ready' }, copiedCall as ToolCall)), /shift-/)
  assert.match(
    JSON.stringify(await history.run({ action: 'compare', id: accepted.shift.dir, other: waitCall.shift.dir }, copiedCall as ToolCall)),
    /Wait for updates/,
  )
  console.log('Verified transactional save, retry, live restore, independent export, comment delivery and guarded migration.')
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
  // An old client can recreate its records after cleanup. Start a new verified generation.
  await writeFile(legacy, 'broken task list')
  assert.match(await call('shift_migrate', { action: 'status' }), /appeared after cleanup/)
  await call('shift_migrate', { action: 'start' })
  await writeFile(legacy, 'none')
  await call('shift_migrate', { action: 'start' })
  const unchanged = await accept(stamp + 9)
  assert.ok(unchanged.shift, JSON.stringify(unchanged))
  await writeFile(join(project, '.shift/migration.json'), 'broken')
  const damaged = await promptRecords({ ...courier, looks: async () => ({ ...FRESH_LOOKS }) }, true)
  assert.match(JSON.stringify(damaged.notes), /Recover the migration record/)
  assert.ok((await sessionFiles(source)).some((f: { path: string }) => f.path.endsWith('OWNER.md')))
  const redirect = join(project, '.shift', 'beads', '.beads', 'redirect')
  await writeFile(redirect, neighbor)
  await assert.rejects(invoke(['create', 'Refused', '--json']), /redirect/)
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
