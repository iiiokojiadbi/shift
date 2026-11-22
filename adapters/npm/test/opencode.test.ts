import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import plugin from '../server'
import { nodeStore } from '../store'
import { historyRuntime } from './native-history'
import { cleanup, scratch } from './scratch'

const bundled = nodeStore.beads
beforeAll(async () => {
  const runtime = await historyRuntime()
  nodeStore.beads = async (root, args, input) => runtime.run(root, args, input)
}, 60000)
afterAll(async () => {
  nodeStore.beads = bundled
  await cleanup()
})

async function setup(root: string, storage: Map<string, unknown>) {
  const hooks = new Map<string, (event: unknown) => Promise<void>>()
  const hook = (name: string, fn: (event: unknown) => Promise<void>) => hooks.set(name, fn)
  const events = new TransformStream()
  const writer = events.writable.getWriter()
  // A second write waits until the plugin has finished processing the first event.
  const notify = async (name: string, sessionID: string) => {
    await writer.write({ type: name, data: { sessionID, reason: 'auto' } })
    await writer.write({ type: 'drain' })
  }
  type Tool = { name: string; execute: (input: object, call: { sessionID: string }) => Promise<{ content: string }> }
  const tools = new Map<string, Tool>()
  const collect = (fn: (registry: { add: (tool: Tool) => void }) => void) =>
    fn({
      add: t => {
        tools.set(t.name, t)
      },
    })
  const transform = async () => {}
  const compacted: string[] = []
  await plugin.setup({
    location: { directory: root },
    storage: {
      get: (k: string) => storage.get(k),
      set: (k: string, v: unknown) => storage.set(k, structuredClone(v)),
      remove: (k: string) => storage.delete(k),
    },
    session: {
      hook,
      get: async () => ({}),
      synthetic: async () => {},
      context: async () => [],
      compact: async ({ sessionID }: { sessionID: string }) => {
        compacted.push(sessionID)
        throw new Error('Unexpected compaction.')
      },
    },
    model: { default: async () => undefined },
    event: { subscribe: () => events.readable },
    tool: { transform: collect, hook },
    agent: { transform },
    command: { transform },
  } as never)
  const send = async (name: string, event: object) => {
    const fn = hooks.get(name)
    if (!fn) throw Error(name)
    await fn(event)
  }
  const context = async (sessionID: string) => {
    const system: { text: string }[] = []
    await send('context', { sessionID, system })
    return system.map(entry => entry.text).join('\n')
  }
  const prompt = async (sessionID: string, text = 'go') => {
    const input = { text }
    await send('prompt', { sessionID, prompt: input })
    return input.text
  }
  return { tools, send, context, prompt, notify, compacted, close: () => writer.close() }
}

test('session hooks keep per-chat map changes across plugin reload and refresh the block on compaction', async () => {
  const root = await scratch('opencode')
  const storage = new Map<string, unknown>()
  const path = 'docs/guide.md'
  const body = '---\ndescription: API guide\n---\n# API\n## Slots\none\n## Stable\ntwo\n'
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, path), body)

  const original = await setup(root, storage)
  const map = await original.tools.get('shift_record')?.execute({ action: 'read', name: 'SHIFT.md' }, { sessionID: 'reader' })
  expect(map?.content).toContain('Slots · Stable')
  const first = await original.context('reader')
  expect(first).toContain('Slots · Stable')
  expect(await original.context('writer')).toBe(first)
  const content = body.replace('one', 'changed body').replace('Stable', 'Revised')
  const call = { id: 'write', tool: 'write', sessionID: 'writer', input: { path, content } }
  await original.send('execute.before', call)
  await writeFile(join(root, path), content)
  const done = { ...call, status: 'completed', result: { content: 'ok' } }
  await original.send('execute.after', done)
  expect(done.result.content).toBe('ok')
  expect(await original.prompt('writer')).not.toContain('Slots (changed)')
  await original.close()
  const restarted = await setup(root, storage)
  const delta = await restarted.prompt('reader')
  expect(delta).toContain('Slots (changed)')
  expect(delta).toContain('Revised (new)')
  expect(delta).not.toContain('API guide')
  expect(await restarted.context('reader')).toBe(first)
  expect(await restarted.prompt('reader')).not.toContain('Slots (changed)')
  await restarted.notify('session.compaction.ended', 'reader')
  expect(await restarted.context('reader')).toContain('Slots · Revised')
  await restarted.close()

  const cache = storage.get('context:reader') as { version?: number; block: { files: string }; checkpoint: { mapNotes: string[] } }
  delete cache.version
  cache.block.files += '\n<file path="beads:claimed">stale task card</file>'
  cache.checkpoint.mapNotes = ['Queued before the interrupted upgrade.']
  const upgraded = await setup(root, storage)
  expect(await upgraded.context('reader')).not.toContain('stale task card')
  expect(await upgraded.prompt('reader')).toContain('Queued before the interrupted upgrade.')
  expect(await upgraded.prompt('reader')).not.toContain('Queued before')
  expect(storage.get('context:reader')).toHaveProperty('version')
  await upgraded.close()
})

test('a restarted plugin ignores former folder receipts and passes each owner message through', async () => {
  const root = await scratch('opencode-restart')
  const dir = join(root, '.shift/shifts/20260101-000000')
  const storage = new Map<string, unknown>([
    [
      'wait:reader',
      {
        dir,
        context: 'Obsolete folder letter.',
        held: [{ text: 'Owner words from before restart.', attachments: [{ uri: 'file:///first.png' }] }],
        files: ['letter.md'],
      },
    ],
    ['pending:writer', { dir, after: 'wait', hold: 'Obsolete Hold.', sessionId: 'writer', at: 1 }],
  ])
  for (const words of ['Owner after upgrade.', 'Owner after restart.']) {
    const restarted = await setup(root, storage)
    try {
      await restarted.context('writer')
      const system: { text: string }[] = []
      await restarted.send('compaction', { sessionID: 'writer', system })
      expect(system.map(part => part.text).join(' ')).not.toContain('Obsolete Hold.')
      expect(await restarted.prompt('writer', words)).toBe(words)
      expect(restarted.compacted).toEqual([])
      const input = { text: words, files: [{ uri: 'file:///current.png' }] }
      await restarted.send('prompt', { sessionID: 'reader', prompt: input })
      const received = input.text
      const expected = words === 'Owner after upgrade.' ? ['file:///first.png', 'file:///current.png'] : ['file:///current.png']
      expect(input.files.map(file => file.uri)).toEqual(expected)
      expect(received.split(words)).toHaveLength(2)
      expect(received).not.toContain('Obsolete folder letter.')
      if (words === 'Owner after upgrade.') expect(received.split('Owner words from before restart.')).toHaveLength(2)
      else expect(received).toBe(words)
    } finally {
      await restarted.close()
    }
  }
})
