import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The tests' folders, all under one folder of the system's temporary ones: a test file removes its own with
// `afterAll(cleanup)`, and what a broken run leaves stays in that one folder.
const made: string[] = []

export async function scratch(prefix: string): Promise<string> {
  const base = join(tmpdir(), 'shift', 'tests')
  await mkdir(base, { recursive: true })
  const dir = await mkdtemp(join(base, `${prefix}-`))
  made.push(dir)

  return dir
}

export async function cleanup(): Promise<void> {
  await Promise.all(made.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
}
