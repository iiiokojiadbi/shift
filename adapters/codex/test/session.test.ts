import { afterAll, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanup, scratch } from '../../npm/test/scratch'
import { type Fields, fields } from '../protocol'
import { Session } from '../session'

afterAll(cleanup)

test('a scripted edit refreshes the configured map on the next owner turn, including pins', async () => {
  const root = await scratch('codex-map')
  const docs = join(root, 'docs')
  const records = join(root, '.shift')
  await Promise.all([mkdir(docs), mkdir(records)])
  await writeFile(join(records, 'settings.toml'), '[files]\nshift = "MAP.md"\n[docs]\ndirs = ["docs"]\ntoc = true\n')
  await writeFile(join(root, 'MAP.md'), '# Rules\nKeep knowledge in project docs.\n')
  const file = join(docs, 'build.md')
  await writeFile(file, '---\ndescription: Build procedure\n---\n# Build\n\n## Start\n')
  const calls: Fields[] = []
  const session = new Session(
    'thread',
    root,
    undefined,
    async (_method, params) => {
      calls.push(params)
      return {}
    },
    () => {},
  )
  await session.ownerRequest('turn/start', { input: [] })
  await writeFile(file, '---\ndescription: Build procedure\n---\n# Build\n\n## Verify\n\n> [!IMPORTANT]\n> Inspect the produced binary.\n')
  await session.ownerRequest('turn/start', { input: [] })
  const context = fields(fields(calls[1]?.additionalContext).shift).value
  expect(context).toContain('Keep knowledge in project docs.')
  expect(context).toContain('Inspect the produced binary.')
  expect(context).toContain('Verify')
  expect(await readFile(join(root, 'MAP.md'), 'utf8')).toContain('Inspect the produced binary.')
  expect(await session.tool('doc_outline', { path: 'docs/build.md' }, 'turn')).toContain('Verify')
  await expect(session.tool('shift', { letter: '../outside' }, 'turn')).rejects.toThrow('inside this project')
  await writeFile(join(records, 'settings.toml'), 'enabled = false')
  await session.ownerRequest('turn/start', { input: [] })
  expect(calls[2]?.additionalContext).toBeUndefined()
  await expect(session.tool('shift_guide', {}, 'turn')).rejects.toThrow('disabled')
})
