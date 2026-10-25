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

// A history of two turns, `chars` long, as pi's session keeps it.
function branch(chars: number) {
  const message = (id: string, role: 'user' | 'assistant', text: string) => ({
    type: 'message',
    id,
    parentId: null,
    timestamp: '',
    message: role === 'user' ? { role, content: text, timestamp: 0 } : { role, content: [{ type: 'text', text }], timestamp: 0 },
  })

  return [
    message('a', 'user', 'x'.repeat(chars / 2)),
    message('b', 'assistant', 'y'.repeat(chars / 2)),
    message('c', 'user', 'go on'),
    message('d', 'assistant', 'z'),
  ]
}

function load(root: string, chars = 200_000) {
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
    sessionManager: { getBranch: () => branch(chars), getSessionId: () => 's1', buildSessionProjection: () => ({ messages: [] }) },
    getContextUsage: () => ({ tokens: chars / 4, contextWindow: 200_000 }),
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

  // pi keeps its last keepRecentTokens whole: a history no bigger has nothing to let go, and the shift says so first.
  const small = load(await project(records), 40_000)
  await small.on('session_start')
  await expect(small.call('shift', { letter: '.shift/letter.md', after: 'continue', about: 'a' })).rejects.toThrow(
    'Nothing to shift yet: the history since the last let-go is about 10K tokens, and pi keeps its last 20K whole',
  )

  const stopped = load(await project(records))
  await stopped.on('session_start')
  await stopped.call('shift', { letter: '.shift/letter.md', after: 'wait', about: 'a' })
  await stopped.on('agent_settled', { aborted: true })
  expect(stopped.sent).toEqual([])
  expect(stopped.notes.some(note => note.includes('not made — the turn was aborted'))).toBe(true)
})

test("records are looked at around every tool: the agent's own change told only when broken, someone else's always", async () => {
  const root = await project({
    '.shift/board.md': '## Goal\ng\n## Decisions\nnone\n## Dead ends\nnone\n',
    '.shift/TASKS.md': '# Tasks\n\n- [in progress] [t](tasks/t/) — t\n',
    '.shift/tasks/t/task.md': '# T\n\n## Goal\ng\n## Done when\nd\n## Owner decisions\nnone\n## Decisions\nnone\n## Dead ends\nnone\n',
    '.shift/tasks/t/track.md': '- [open] write the test\n',
  })
  const pi = load(root)
  await pi.on('session_start')
  let id = 0
  const bash = async (change?: () => Promise<void>) => {
    const call = { toolCallId: String(++id), toolName: 'bash', input: {} }
    await pi.on('tool_call', call)
    await change?.()
    const done = (await pi.on('tool_result', { ...call, content: [], isError: false })) as { content: { text: string }[] } | undefined
    return done?.content.map(each => each.text).join('\n') ?? ''
  }
  const put = (path: string, text: string) => () => writeFile(join(root, path), text)

  await bash()
  expect(await bash(put('.shift/tasks/t/track.md', '- [done] write the test\n'))).toBe('')
  expect(await bash(put('.shift/board.md', '## Goal\nthe mod, broken\n'))).toContain('`.shift/board.md`: The board lacks sections')
  await put('.shift/TASKS.md', '# Tasks\n\n- [in progress] [t](tasks/t/) — t, by hand\n')()
  const outside = await bash()
  expect(outside).toContain('`.shift/TASKS.md` changed outside your tools')
  expect(outside).not.toContain('board.md')
})
