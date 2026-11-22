import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BOARD, LETTER } from '../../../core/test/data'
import { acceptShift, changedRecords, loadProject, resumeShift, settleShift, TOOLS, type ToolCall } from '../core'
import { nodeStore } from '../store'
import { historyRuntime } from './native-history'
import { cleanup, scratch } from './scratch'

let native: Awaited<ReturnType<typeof historyRuntime>>
beforeAll(async () => {
  native = await historyRuntime()
}, 60000)
afterAll(cleanup)

function project(root: string, actor = 'first') {
  return loadProject({ ...nodeStore, beads: async (dir, args, input) => native.run(dir, args, input) }, root, actor)
}
async function edit(root: string, raw: Record<string, unknown>, actor = 'first') {
  const tool = TOOLS.find(t => t.name === 'shift_record')
  if (!tool) throw new Error('Missing working records tool')
  const result = await tool.run(raw, { project: () => project(root, actor) } as ToolCall)
  if ('deny' in result) throw new Error(result.deny)
  return result.result
}
async function applyText(root: string, name: string, body: string) {
  const draft = JSON.parse(await edit(root, { action: 'checkout', name }))
  await writeFile(draft.path, body)
  await edit(root, { action: 'apply', name, revision: draft.revision })
  return draft
}
test('fresh records survive a shift with the task workspace offline and no loose Markdown', async () => {
  const root = await scratch('working-records')
  await applyText(root, 'board.md', BOARD)
  await applyText(root, 'letter.md', LETTER)
  await applyText(root, 'OWNER.md', 'none')
  await writeFile(join(root, '.shift/beads'), 'offline')
  const p = await project(root)
  const accepted = await acceptShift(p, { input: { letter: '.shift/letter.md', after: 'wait' }, sessionId: 'first', at: 1 })
  if (!('shift' in accepted)) throw new Error(accepted.deny)
  await settleShift(p, { shift: accepted.shift, messages: [], before: 100, after: 1 })
  expect((await resumeShift(await project(root))).prompt).toContain('HOLD-THIS')
  expect((await readdir(join(root, '.shift'))).filter(n => n.endsWith('.md'))).toEqual([])
  expect(await readdir(join(root, '.shift/drafts'))).toEqual([])
  expect(await edit(root, { action: 'read', name: 'letter.md' }, 'other')).toContain('Record missing')
})
test('an imported file is adopted once, with conflict recovery and external sources preserved', async () => {
  const root = await scratch('import-records')
  const base = join(root, '.shift')
  await mkdir(base)
  await writeFile(join(base, 'board.md'), BOARD)
  await writeFile(join(base, 'letter.md'), LETTER)
  await writeFile(join(base, 'settings.toml'), '[files]\nowner = "policy.md"\n')
  await writeFile(join(root, 'policy.md'), 'visible policy')
  expect(await edit(root, { action: 'import' })).toContain('board.md')
  const name = 'board.md'
  const { path, revision } = JSON.parse(await edit(root, { action: 'checkout', name }))
  const changed = BOARD.replace('the mod', 'the project')
  await writeFile(path, `${changed}\n`)
  const seen = (await changedRecords(await project(root, 'other'), null, 'other')).seen
  await edit(root, { action: 'replace', name, section: 'Goal', find: 'the mod', replacement: 'the project', revision }, 'other')
  expect((await changedRecords(await project(root), seen, 'other')).body).toContain('board.md')
  await expect(edit(root, { action: 'apply', name, revision })).rejects.toThrow('changed')
  expect(await readFile(path, 'utf8')).toBe(`${changed}\n`)
  expect(await edit(root, { action: 'drafts', name })).toContain(revision)
  await edit(root, { action: 'discard', name, revision })
  await writeFile(join(base, 'board.md'), 'stale original')
  expect(await edit(root, { action: 'import' })).toContain('No new')
  expect(await edit(root, { action: 'read', name })).toContain('the project')
  await rm(join(base, 'board.md'))
  expect(await (await project(root)).store.read(join(root, 'policy.md'))).toBe('visible policy')
  expect(await edit(root, { action: 'read', name: 'letter.md' }, 'other')).toContain('HOLD-THIS')
})

test('apply reports the saved revision and preserves an edit made during cleanup', async () => {
  const root = await scratch('draft-cleanup')
  const name = 'board.md'
  const draft = JSON.parse(await edit(root, { action: 'checkout', name }))
  await writeFile(draft.path, BOARD)
  const tool = TOOLS.find(t => t.name === 'shift_record')
  if (!tool) throw new Error('Missing working records tool')
  const store = {
    ...nodeStore,
    beads: async (dir: string, args: readonly string[], input?: string) => {
      if (input && JSON.parse(input).action === 'draft-remove') await writeFile(draft.path, `${BOARD}\n`)
      return native.run(dir, args, input)
    },
  }
  const result = await tool.run({ action: 'apply', name, revision: draft.revision }, {
    project: () => loadProject(store, root, 'first'),
  } as ToolCall)
  if ('deny' in result) throw new Error(result.deny)
  const read = await edit(root, { action: 'read', name })
  expect(result.result).toContain(`board.md ${read.split('\n')[0]}`)
  expect(result.result).toContain('The record was saved')
  expect(await readFile(draft.path, 'utf8')).toBe(`${BOARD}\n`)
})
