import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import shift from '../index'

// The extension over a stand-in of pi's API: what it registers, the handlers it puts on events, the active tools.
type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown
type Registered = { name: string; executionMode?: string; execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }> }

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'shift-pi-'))
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }

  return root
}

function load(root: string) {
  const tools = new Map<string, Registered>()
  const handlers = new Map<string, Handler>()
  const notes: string[] = []
  const sent: string[] = []
  let active = ['read', 'bash']
  const pi = {
    registerTool: (tool: Registered) => {
      tools.set(tool.name, tool)
      active.push(tool.name)
    },
    registerCommand: () => {},
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names
    },
    sendMessage: (message: { content: string }) => sent.push(message.content),
    sendUserMessage: () => {},
    appendEntry: () => {},
  }
  shift(pi as never)
  const ctx = {
    cwd: root,
    hasUI: false,
    ui: { notify: (text: string) => notes.push(text) },
    sessionManager: { getBranch: () => [], getSessionId: () => 's1', buildSessionProjection: () => ({ messages: [] }) },
    getContextUsage: () => ({ tokens: 1000, contextWindow: 200_000 }),
    compact: (options: { onComplete: (result: unknown) => void }) =>
      options.onComplete({ summary: 'DIGEST', tokensBefore: 300_000, estimatedTokensAfter: 20_000 }),
    model: undefined,
  }
  const on = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx)
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools.get(name)?.execute('1', params, undefined, undefined, ctx))?.content[0]?.text

  return { tools, notes, sent, on, call, active: () => active }
}

test('a project without docs shows no docs tools, neither as tools nor in the doctrine; the tools run over the records', async () => {
  const root = await project({
    '.shift/settings.toml': '[docs]\ndirs = []\n',
    '.shift/TASKS.md': '# Tasks\n\n- [in progress] [t](tasks/t/) — t\n',
    '.shift/tasks/t/track.md': '- [open] write the test\n',
  })
  const pi = load(root)
  await pi.on('session_start')
  expect(pi.active()).toContain('shift')
  expect(pi.active()).not.toContain('doc_outline')
  const run = { systemPromptOptions: { sections: {} as Record<string, string>, contextFiles: [] }, messageType: 'user' }
  await pi.on('before_agent_start', run)
  expect(run.systemPromptOptions.sections.shift).toContain('- `task_track` — ')
  expect(run.systemPromptOptions.sections.shift).not.toContain('doc_outline')

  expect(await pi.call('task_track', { task: 't', item: 'test', status: 'done' })).toContain('- [done] write the test')
  expect(await readFile(join(root, '.shift/tasks/t/track.md'), 'utf8')).toBe('- [done] write the test\n')
  await expect(pi.call('task_track', { task: 'nope', item: 'x', status: 'done' })).rejects.toThrow('the task is not open')
  expect(pi.tools.get('task_track')?.executionMode).toBe('sequential')
  expect(pi.tools.get('shift_guide')?.executionMode).toBeUndefined()
})

test('the status counts what the history grew from; settings that turn the mod off take every tool out', async () => {
  const pi = load(await project({ '.shift/TASKS.md': 'none\n' }))
  await pi.on('session_start')
  await pi.on('message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(5000) }] } })
  expect(await pi.call('shift_status')).toContain('Grown mostly from: your responses 100%.')

  const off = load(await project({ '.shift/settings.toml': 'enabled = false\n' }))
  await off.on('session_start')
  expect(off.active()).toEqual(['read', 'bash'])
})

test('a shift lets go once the run settles and continues; an aborted run lets nothing go', async () => {
  const records = {
    '.shift/letter.md': ['## Where I am', 'here', '## Next', 'go', '## Unverified', 'none', '## Hold', 'HOLD'].join('\n'),
    '.shift/board.md': ['## Goal', 'g', '## Decisions', 'none', '## Dead ends', 'none'].join('\n'),
    '.shift/OWNER.md': 'none\n',
    '.shift/TASKS.md': 'none\n',
    '.shift/settings.toml': 'commit = true\n',
  }
  const going = load(await project(records))
  await going.on('session_start')
  expect(await going.call('shift', { letter: '.shift/letter.md', after: 'continue', about: 'a' })).toContain('Shift accepted')
  await expect(going.call('shift', { letter: '.shift/letter.md', after: 'continue', about: 'a' })).rejects.toThrow('already accepted')
  await going.on('agent_settled', { aborted: false })
  expect(going.sent[0]).toContain('Shift done')
  expect(going.notes.some(note => note.includes('continuing from the letter'))).toBe(true)

  const stopped = load(await project(records))
  await stopped.on('session_start')
  await stopped.call('shift', { letter: '.shift/letter.md', after: 'wait', about: 'a' })
  await stopped.on('agent_settled', { aborted: true })
  expect(stopped.sent).toEqual([])
  expect(stopped.notes.some(note => note.includes('not made — the turn was aborted'))).toBe(true)
})
