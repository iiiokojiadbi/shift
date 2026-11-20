// Point at the installed npm package. Uses its real process port and a disposable repository.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Store } from '../core/src/store'

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
