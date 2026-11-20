// Point at the installed npm package. Uses its real process port and a disposable repository.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Store } from '../core/src/store'
import type { Tool, ToolCall } from '../core/src/tools'

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
  const { TOOLS, loadProject } = await import(pathToFileURL(resolve(pkg, 'core/index.ts')).href)
  async function call(name: string, args: Record<string, unknown>, actor = 'writer') {
    const tool = (TOOLS as Tool[]).find(each => each.name === name)
    assert.ok(tool)
    const context = { project: () => loadProject(nodeStore, project), sessionId: async () => actor, now: async () => Date.now() }
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
  console.log(
    'Public task tools passed creation, epic membership, labels, comments, atomic item rejection, blocker resolution, reopen and concurrent claims.',
  )
  const [snapshot] = JSON.parse(await invoke(['show', 'shift-epic', '--brief-deps', '--json']))
  const guard = JSON.stringify([{ id: snapshot.id, revision: snapshot.revision }])
  await invoke(['shift-checked', guard, 'update', snapshot.id, '--notes=First writer'])
  await assert.rejects(invoke(['shift-checked', guard, 'update', snapshot.id, '--notes=Stale writer']), /changed/)
  assert.match(await call('task_query', { view: 'show', task: 'epic' }), /First writer/)
  await call('task_manage', { action: 'block', task: 'epic', target: created[0] })
  await call('task_manage', { action: 'unblock', task: 'epic', target: created[0] })
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
