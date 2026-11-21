import { afterAll, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import plugin from '../server'
import { cleanup, scratch } from './scratch'

afterAll(cleanup)

test('session hooks keep per-chat map changes across plugin reload and refresh the block on compaction', async () => {
  const root = await scratch('opencode')
  const storage = new Map<string, unknown>()
  const path = 'docs/guide.md'
  const body = '---\ndescription: API guide\n---\n# API\n## Slots\none\n## Stable\ntwo\n'
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, path), body)

  async function setup() {
    const hooks = new Map<string, (event: unknown) => Promise<void>>()
    const hook = (name: string, fn: (event: unknown) => Promise<void>) => hooks.set(name, fn)
    const events = new TransformStream()
    const writer = events.writable.getWriter()
    // A second write waits until the plugin has finished processing the first event.
    const notify = async (name: string, sessionID: string) => {
      await writer.write({ type: name, data: { sessionID, reason: 'auto' } })
      await writer.write({ type: 'drain' })
    }
    const transform = async () => {}
    await plugin.setup({
      location: { directory: root },
      storage: {
        get: (k: string) => storage.get(k),
        set: (k: string, v: unknown) => storage.set(k, structuredClone(v)),
        remove: (k: string) => storage.delete(k),
      },
      session: { hook, get: async () => ({}), synthetic: async () => {}, context: async () => [] },
      model: { default: async () => undefined },
      event: { subscribe: () => events.readable },
      tool: { transform, hook },
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
    const prompt = async (sessionID: string) => {
      const input = { text: 'go' }
      await send('prompt', { sessionID, prompt: input })
      return input.text
    }
    return { send, context, prompt, notify, close: () => writer.close() }
  }
  const original = await setup()
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
  const restarted = await setup()
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
  const upgraded = await setup()
  expect(await upgraded.context('reader')).not.toContain('stale task card')
  expect(await upgraded.prompt('reader')).toContain('Queued before the interrupted upgrade.')
  expect(await upgraded.prompt('reader')).not.toContain('Queued before')
  expect(storage.get('context:reader')).toHaveProperty('version')
  await upgraded.close()
})
