// Integration check on a POSIX build host. Pass the native executable printed by beads:stage.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const [executable, ...extra] = process.argv.slice(2)
if (!executable || extra.length) throw new Error('Usage: bun run beads:check <staged-bd>')
const binary = resolve(executable)
const scratch = '/tmp/shift'
await mkdir(scratch, { recursive: true })
const fixture = await mkdtemp(join(scratch, 'beads-check-'))
try {
  const profile = join(fixture, 'profile')
  const bin = join(fixture, 'bin')
  const project = join(fixture, 'project')
  const privateRoot = join(project, '.shift')
  const unrelated = join(fixture, 'existing')
  const tracker = join(project, '.beads')
  for (const dir of [profile, bin, privateRoot, unrelated, tracker]) await mkdir(dir, { recursive: true })
  const env = {
    HOME: profile,
    PATH: [bin, process.env.PATH].join(delimiter),
    BD_DISABLE_METRICS: '1',
    GIT_CEILING_DIRECTORIES: project,
  }
  await exec('git', ['init', '--quiet', project], { env })
  const gitConfig = join(project, '.git', 'config')
  const initialConfig = await readFile(gitConfig, 'utf8')
  const called = join(bin, 'called')
  for (const name of ['bd', 'dolt']) {
    await writeFile(join(bin, name), '#!/bin/sh\ntouch "$(dirname "$0")/called"\nexit 1\n', { mode: 0o755 })
  }
  const run = async (cwd: string, args: string[]) =>
    (await exec(binary, args, { cwd, env: { ...env, BEADS_DIR: join(cwd, '.beads') }, timeout: 30_000 })).stdout

  const init = (dir: string, prefix: string) => run(dir, ['init', '--non-interactive', '--skip-hooks', '--skip-agents', '--prefix', prefix])
  const create = async (dir: string, title: string) => JSON.parse(await run(dir, ['create', title, '--json'])).id as string
  const ids = async (dir: string) => (JSON.parse(await run(dir, ['list', '--json'])) as { id: string }[]).map(issue => issue.id).sort()

  await init(unrelated, 'other')
  const otherId = await create(unrelated, 'Existing task')
  const redirect = join(unrelated, '.beads')
  await writeFile(join(tracker, 'redirect'), redirect)
  await init(privateRoot, 'shift')
  const metadata = JSON.parse(await readFile(join(privateRoot, '.beads', 'metadata.json'), 'utf8'))
  assert.equal(metadata.dolt_mode, 'embedded')
  const results = await Promise.allSettled([create(privateRoot, 'First writer'), create(privateRoot, 'Second writer')])
  const created = results.map(result => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
  assert.equal(new Set(created).size, 2)
  assert.deepEqual(await ids(privateRoot), created.sort())
  assert.deepEqual(await ids(unrelated), [otherId])
  assert.deepEqual(await readdir(tracker), ['redirect'])
  assert.equal(await readFile(join(tracker, 'redirect'), 'utf8'), redirect)
  assert.deepEqual((await readdir(project)).sort(), ['.beads', '.git', '.shift'])
  assert.equal(await readFile(gitConfig, 'utf8'), initialConfig)
  assert.equal(await Bun.file(called).exists(), false)
  console.log('Embedded workspace reopened. Both writers persisted. The unrelated tracker and PATH executables were untouched.')
} finally {
  await rm(fixture, { recursive: true, force: true })
}
