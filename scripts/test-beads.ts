// Exercise native storage from a source checkout. Only packaging needs the upstream archive.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const base = '/tmp/shift'
await mkdir(base, { recursive: true })
const dir = await mkdtemp(join(base, 'runtime-test-'))
try {
  await cp(resolve(import.meta.dirname, '../runtime/beads'), dir, { recursive: true })
  await writeFile(join(dir, 'payload'), '')
  execFileSync('go', ['test', '-race', './...'], { cwd: dir, stdio: 'inherit' })
} finally {
  await rm(dir, { recursive: true, force: true })
}
