import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import shift from '../index'
import { nodeStore } from '../store'
import { historyRuntime } from './native-history'
import { cleanup, scratch } from './scratch'

let native: Awaited<ReturnType<typeof historyRuntime>>
const bundled = nodeStore.beads
beforeAll(async () => {
  native = await historyRuntime()
  nodeStore.beads = async (root, args, input) => native.run(root, args, input)
}, 60000)
afterAll(async () => {
  nodeStore.beads = bundled
  await cleanup()
})

// The extension over a stand-in of pi's API: what it registers, the handlers it puts on events, the active tools.
type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown
type Registered = { name: string; executionMode?: string; execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }> }

async function project(files: Record<string, string>): Promise<string> {
  const root = await scratch('pi')
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

function load(root: string, chars = 200_000, entries?: () => unknown[]) {
  const saved: unknown[] = []
  const tools = new Map<string, Registered>()
  const handlers = new Map<string, Handler>()
  const commands = new Map<string, Handler>()
  const notes: string[] = []
  const sent: string[] = []
  let active = ['read', 'bash']
  const pi = {
    registerTool: (tool: Registered) => {
      tools.set(tool.name, tool)
      active.push(tool.name)
    },
    registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command.handler),
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names
    },
    sendMessage: (message: { content: string }) => sent.push(message.content),
    sendUserMessage: (_content: string) => {},
    appendEntry: (customType: string, data: unknown) => saved.push({ type: 'custom', customType, data }),
  }
  shift(pi as never)
  const ctx = {
    cwd: root,
    isIdle: () => true,
    hasUI: false,
    ui: { notify: (text: string) => notes.push(text) },
    sessionManager: {
      getBranch: () => entries?.() ?? [...branch(chars), ...saved],
      getEntries: () => entries?.() ?? [...branch(chars), ...saved],
      getSessionId: () => 's1',
      buildSessionProjection: () => ({ messages: [] }),
    },
    getContextUsage: () => ({ tokens: chars / 4, contextWindow: 200_000 }),
    compact: (options: { onComplete: (result: unknown) => void }) =>
      options.onComplete({ summary: 'DIGEST', tokensBefore: 300_000, estimatedTokensAfter: 20_000 }),
    model: undefined,
  }
  // The let-go runs after the settled handler returns, as pi needs: the stand-in gives it time to end.
  const on = async (name: string, event: unknown = {}) => {
    const result = await handlers.get(name)?.(event, ctx)
    if (name === 'agent_settled') await new Promise(done => setTimeout(done, 300))

    return result
  }
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools.get(name)?.execute('1', params, undefined, undefined, ctx))?.content[0]?.text

  return {
    tools,
    notes,
    sent,
    on,
    call,
    saved,
    api: pi,
    command: (name: string, args = '') => commands.get(name)?.(args, ctx),
    active: () => active,
  }
}

test('a project without docs shows no docs tools, neither as tools nor in the doctrine; the tools run over the records', async () => {
  const root = await project({
    '.shift/settings.toml': '[docs]\ndirs = []\n',
  })
  const pi = load(root)
  await pi.on('session_start')
  expect(pi.active()).toContain('shift')
  expect(pi.active()).not.toContain('doc_outline')
  expect(await pi.call('shift_record', { action: 'list' })).toContain('No current records')
  const run = { systemPromptOptions: { sections: {} as Record<string, string>, contextFiles: [] }, messageType: 'user' }
  await pi.on('before_agent_start', run)
  expect(run.systemPromptOptions.sections.shift).toContain('shift-task')
  expect(run.systemPromptOptions.sections.shift).not.toContain('doc_outline')
  expect([...pi.tools.keys()].filter(name => name.startsWith('task_'))).toEqual([])
  expect(await pi.call('shift_guide', { section: 'records' })).toContain('Beads')
  expect(pi.tools.get('shift_guide')?.executionMode).toBeUndefined()
})

test('the status counts what the history grew from; settings that turn the mod off take every tool out', async () => {
  const pi = load(await project({ '.shift/OWNER.md': 'none\n' }))
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
    '.shift/settings.toml': 'commit = true\n',
  }
  const going = load(await project(records))
  await going.on('session_start')
  expect(await going.call('shift', { letter: '.shift/letter.md', after: 'continue', about: 'a' })).toContain('Shift accepted')
  await expect(going.call('shift', { letter: '.shift/letter.md', after: 'continue', about: 'a' })).rejects.toThrow('already accepted')
  // The owner types before the history is let go: pi would send it first, so it is held for after the letter.
  expect(await going.on('input', { text: 'OWNER WORDS', source: 'interactive', streamingBehavior: 'steer' })).toEqual({ action: 'handled' })
  expect(await going.on('input', { text: '/tasks', source: 'interactive' })).toBeUndefined()
  await going.on('agent_settled', { aborted: false })
  expect(going.sent).toHaveLength(1)
  expect(going.sent[0]).toContain('Shift done')
  expect(going.sent[0]).toEndWith('OWNER WORDS')
  expect(going.notes.some(note => note.includes('continuing from the letter'))).toBe(true)
  // The shift is over: the owner's next input goes as it is.
  expect(await going.on('input', { text: 'next', source: 'interactive' })).toBeUndefined()

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
    '.shift/OWNER.md': 'Owner decision.',
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
  expect(await bash(put('.shift/OWNER.md', 'Owner confirmed the test.'))).toBe('')
  expect(await bash(put('.shift/board.md', '## Goal\nthe mod, broken\n'))).toContain('`.shift/board.md`: The board lacks sections')
  await put('.shift/OWNER.md', 'Updated outside the chat.')()
  const outside = await bash()
  expect(outside).toContain('`.shift/OWNER.md` changed outside your tools')
  expect(outside).not.toContain('board.md')
})

test('a call blocked before it ran ends at its execution end; the run after it still tells a change outside', async () => {
  const root = await project({ '.shift/OWNER.md': 'none\n' })
  const pi = load(root)
  await pi.on('session_start')
  await pi.on('tool_call', { toolCallId: '1', toolName: 'bash', input: {} })
  await pi.on('tool_execution_end', { toolCallId: '1', toolName: 'bash', isError: true })
  await writeFile(join(root, '.shift/OWNER.md'), 'An outside change.')
  await pi.on('tool_call', { toolCallId: '2', toolName: 'bash', input: {} })
  const done = (await pi.on('tool_result', { toolCallId: '2', toolName: 'bash', input: {}, content: [], isError: false })) as
    | { content: { text: string }[] }
    | undefined
  expect(done?.content.map(each => each.text).join('')).toContain('changed outside your tools')
})

test("a waiting letter: pi's own let-go waits for the shift, an extension's message never takes it, a rewind keeps it", async () => {
  const records = {
    '.shift/letter.md': ['## Where I am', 'here', '## Next', 'go', '## Unverified', 'none', '## Hold', 'HOLD'].join('\n'),
    '.shift/board.md': ['## Goal', 'g', '## Decisions', 'none', '## Dead ends', 'none'].join('\n'),
    '.shift/OWNER.md': 'none\n',
    '.shift/settings.toml': 'commit = true\n',
  }
  const pi = load(await project(records))
  await pi.on('session_start')
  await pi.call('shift', { letter: '.shift/letter.md', after: 'wait', about: 'a' })
  expect(await pi.on('session_before_compact', { reason: 'threshold' })).toEqual({ cancel: true })
  expect(await pi.on('session_before_compact', { reason: 'manual' })).toBeUndefined()
  await pi.on('agent_settled', { aborted: false })
  const run = () => ({ systemPromptOptions: { sections: {}, contextFiles: [] }, messageType: 'user' })
  const letter = async () =>
    ((await pi.on('before_agent_start', run())) as { message?: { content: string } } | undefined)?.message?.content ?? ''
  // The owner's input taken by another extension without a run, then an extension's own message: no letter.
  await pi.on('input', { text: 'hi', source: 'interactive' })
  await pi.on('input', { text: 'x', source: 'extension' })
  expect(await letter()).not.toContain('<letter shift=')
  await pi.on('input', { text: 'hi', source: 'interactive' })
  expect(await letter()).toContain('<letter shift=')

  // The message that took the letter rewound away: the clearing entry stays on the branch, the letter waits again.
  const wait = (note: unknown) => ({ type: 'custom', customType: 'shift:wait', data: { note } })
  const note = { context: 'THE LETTER', dir: 's-0000000000000001', files: [] }
  const rewound = load(await project(records), 200_000, () => [wait(note), wait(null)])
  await rewound.on('session_start')
  await rewound.on('input', { text: 'hi', source: 'interactive' })
  expect(((await rewound.on('before_agent_start', run())) as { message: { content: string } }).message.content).toContain('THE LETTER')
  const patched = load(await project(records), 200_000, () => [wait(note), wait(null), { type: 'message', message: { role: 'system' } }])
  await patched.on('session_start')
  await patched.on('input', { text: 'hi', source: 'interactive' })
  expect(((await patched.on('before_agent_start', run())) as { message: { content: string } }).message.content).toContain('THE LETTER')
  const told = load(await project(records), 200_000, () => [
    wait(note),
    wait(null),
    { type: 'custom_message', customType: 'shift', content: note.context },
  ])
  await told.on('session_start')
  await told.on('input', { text: 'hi', source: 'interactive' })
  expect(await told.on('before_agent_start', run())).toBeUndefined()
})

test('a reopened pi branch ignores an obsolete folder letter and lets owner input through', async () => {
  const root = await project({})
  const dir = join(root, '.shift/shifts/20260101-000000')
  const entries = [
    { type: 'custom', customType: 'shift:delivery', data: dir },
    { type: 'custom', customType: 'shift:wait', data: { note: { dir, context: 'Obsolete letter.', files: ['letter.md'] } } },
  ]
  const pi = load(root, 200_000, () => entries)
  await pi.on('session_start')
  for (const text of ['First owner message.', 'Second owner message.']) {
    expect(await pi.on('input', { text, source: 'interactive' })).toBeUndefined()
    const event = { messageType: 'user', systemPromptOptions: { sections: {}, contextFiles: [] } }
    expect(await pi.on('before_agent_start', event)).toBeUndefined()
    expect(pi.sent).toEqual([])
  }
})

test('a working letter keeps its revision across a shift and stays on its pi branch', async () => {
  const root = await project({
    '.shift/board.md': '## Goal\ng\n## Decisions\nnone\n## Dead ends\nnone',
    '.shift/OWNER.md': 'none',
  })
  const original = '## Where I am\nOriginal branch.\n## Next\nContinue here.\n## Unverified\nnone\n## Hold\noriginal'
  const history = branch(200_000)
  const pi = load(root, 200_000, () => [...history, ...pi.saved])
  await pi.on('session_start')
  const name = 'letter.md'
  const record = (action: string, params: Record<string, string> = {}) => pi.call('shift_record', { action, name, ...params })
  const draft = JSON.parse((await record('checkout')) ?? '')
  await writeFile(draft.path, original)
  await record('apply', { revision: draft.revision })
  const before = await record('read')
  expect(before).toContain(original)
  expect(await pi.call('shift', { after: 'wait', letter: '.shift/letter.md' })).toContain('Shift accepted')
  await pi.on('agent_settled', { aborted: false })
  expect(await record('read')).toBe(before)
  const oldTip = [...pi.saved]
  pi.saved.length = 0
  await pi.on('session_tree', { oldLeafId: 'd', newLeafId: null })
  expect(await record('read')).toContain('Record missing')
  const sibling = JSON.parse((await record('checkout')) ?? '')
  await writeFile(sibling.path, original.replace('Original branch.', 'Sibling branch.'))
  await record('apply', { revision: sibling.revision })
  pi.saved.splice(0, pi.saved.length, ...oldTip)
  await pi.on('session_tree', { oldLeafId: 'sibling', newLeafId: 'd' })
  expect(await record('read')).toBe(before)
})

test.each(['wait', 'continue'])('a sibling cannot consume a %s letter; the original branch recovers it after restart', async after => {
  const root = await project({
    '.shift/letter.md': '## Where I am\nBRANCH A ONLY\n## Next\ngo\n## Unverified\nnone\n## Hold\nhold',
    '.shift/board.md': '## Goal\ng\n## Decisions\nnone\n## Dead ends\nnone',
    '.shift/OWNER.md': 'none',
    '.shift/settings.toml': 'commit = true',
  })
  const id = 's-0000000000000001'
  let entries: unknown[] = []
  const history = branch(200_000)
  const pi = load(root, 200_000, () => [...history, ...entries])
  entries = pi.saved
  // pi's sendMessage returns void even if its later attempt to start the run fails before message_end.
  if (after === 'continue') pi.api.sendMessage = () => 0
  await pi.on('session_start')
  expect(await pi.call('shift', { letter: '.shift/letter.md', after, about: 'branch A' })).toContain('Shift accepted')
  await pi.on('agent_settled', { aborted: false })
  const anchor = pi.saved.find(entry => (entry as { customType?: string }).customType === 'shift:delivery') as { data: string }
  const getWait = () => native.query(root, { action: 'waiting', session: JSON.stringify(['s1', anchor.data]) })
  expect(getWait()).toBe(id)

  // A process can die between settlement and the branch-local wait entry. The earlier shift anchor survives.
  const beforeAdmission = [...entries]
  const original = entries.filter(entry => (entry as { customType?: string }).customType !== 'shift:wait')
  const ownerPrompt = async (session: typeof pi) => {
    await session.on('input', { text: 'hello', source: 'interactive' })
    const result = (await session.on('before_agent_start', {
      systemPromptOptions: { sections: {}, contextFiles: [] },
      messageType: 'user',
    })) as { message: { content: string } } | undefined
    return result?.message.content ?? ''
  }
  entries = []
  await pi.on('session_tree')
  expect(await ownerPrompt(pi)).not.toContain('BRANCH A ONLY')
  expect(getWait()).toBe(id)

  const resumed = load(root, 200_000, () => [...history, ...original, ...resumed.saved])
  await resumed.on('session_start')
  const delivered = await ownerPrompt(resumed)
  expect(delivered).toContain('BRANCH A ONLY')
  expect(delivered).toContain(after === 'continue' ? 'Shift done.' : 'You shifted and waited')
  expect(getWait()).toBe(id)
  resumed.saved.push({ type: 'custom_message', customType: 'shift', content: 'Another message' })
  await resumed.on('agent_settled', { aborted: false })
  expect(getWait()).toBe(id)
  resumed.saved.push({ type: 'custom_message', customType: 'shift', content: delivered })
  await resumed.on('agent_settled', { aborted: false })
  expect(getWait()).toBe('')
  expect(await ownerPrompt(resumed)).not.toContain('BRANCH A ONLY')

  // Rewinding away the admitted message restores this branch's local note even after its archive receipt was cleared.
  const rewound = load(root, 200_000, () => [...history, ...beforeAdmission, ...rewound.saved])
  await rewound.on('session_start')
  expect(await ownerPrompt(rewound)).toContain('BRANCH A ONLY')
})

test('a queued shift command keeps its waiting letter until pi records the matching owner message', async () => {
  const root = await project({ '.shift/OWNER.md': 'none' })
  const session = JSON.stringify(['s1', null])
  const about = '---\ndescription: Command fixture\nafter: wait\n---'
  const id = native.query<string>(root, {
    action: 'begin',
    key: 'command',
    about,
    files: { 'letter.md': 'KEEP THIS LETTER', 'board.md': 'Current work.' },
  })
  native.query(root, { action: 'finish', id, state: 'complete', about, limit: 30, session, wait: true })
  const waiting = () => native.query(root, { action: 'waiting', session })
  const pi = load(root)
  await pi.on('session_start')
  pi.api.sendUserMessage = () => {
    throw new Error('queue unavailable')
  }
  await expect(Promise.resolve(pi.command('shift'))).rejects.toThrow('queue unavailable')
  expect(waiting()).toBe(id)

  let queued = ''
  pi.api.sendUserMessage = text => {
    queued = text
  }
  await pi.command('shift', 'Owner words after the letter.')
  expect(queued.split('KEEP THIS LETTER')).toHaveLength(2)
  expect(queued.split('Owner words after the letter.')).toHaveLength(2)
  expect(waiting()).toBe(id)
  pi.saved.push({ type: 'message', message: { role: 'user', content: 'Unrelated owner message.' } })
  await pi.on('agent_settled', { aborted: false })
  expect(waiting()).toBe(id)
  pi.saved.push({ type: 'message', message: { role: 'user', content: queued } })
  await pi.on('agent_settled', { aborted: false })
  expect(waiting()).toBe('')
})

test('branch checkpoints keep a stable map for two observers, a resumed observer and a fresh stretch', async () => {
  const path = 'docs/api.md'
  const body = '---\ndescription: API guide\n---\n# API\n## Slots\none\n## Stable\ntwo\n'
  const root = await project({ [path]: body })
  const writer = load(root)
  const reader = load(root)
  const run = async (session: ReturnType<typeof load>) => {
    const event = { systemPromptOptions: { sections: {} as Record<string, string>, contextFiles: [] }, messageType: 'user' }
    const message = await session.on('before_agent_start', event)
    expect(JSON.stringify(event.systemPromptOptions.contextFiles)).not.toContain('API guide')
    return { block: event.systemPromptOptions.sections.shift_map, message: JSON.stringify(message ?? '') }
  }
  await writer.on('session_start')
  await reader.on('session_start')
  const first = await run(reader)
  expect(first.block).toContain('Slots · Stable')
  expect((await run(writer)).block).toBe(first.block)
  const content = body.replace('one', 'new body').replace('## Stable', '## Revised')
  const call = { toolCallId: 'write1', toolName: 'write', input: { path, content } }
  await writer.on('tool_call', call)
  await writeFile(join(root, path), content)
  expect(JSON.stringify((await writer.on('tool_result', { ...call, content: [] })) ?? '')).not.toContain('(changed)')
  expect((await run(writer)).message).not.toContain('Slots (changed)')
  const resumed = load(root, 200_000, () => reader.saved)
  await resumed.on('session_start')
  const after = await run(resumed)
  expect(after.block).toBe(first.block)
  expect(after.message).toContain('Slots (changed)')
  expect(after.message).toContain('Stable (deleted)')
  expect(after.message).not.toContain('API guide')
  expect((await run(resumed)).message).not.toContain('(changed)')
  await resumed.on('session_compact', { reason: 'manual' })
  expect((await run(resumed)).block).toContain('Slots · Revised')
})
