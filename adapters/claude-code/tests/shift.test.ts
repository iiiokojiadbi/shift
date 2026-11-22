import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { doctrine, growthOf, SHIFT_NOW, shiftFill } from '../hooks/core/index'
import { archiveFixture, emptyArchive } from './archive-fixture'
import { BOARD, LETTER, OWNER, TRAPS } from './data'

const AT = Date.UTC(2026, 9, 23, 14, 5, 9)
const ID = 's-0000000000000001'

type On = Parameters<TestBody>[1]

function stubSession(
  on: On,
  files: Map<string, string>,
  logs: string[] = [],
  tokens = () => 50000,
  ignored = 0,
  history: { role: string; content: unknown }[] = [],
  session = () => 'sess',
  window = 200_000,
) {
  on('env.get', () => ({ value: undefined }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.messages', () => ({ value: history as never }))
  on('session.id', () => ({ value: session() }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window, tokens: tokens() }, rateLimits: [] } }))
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.stat', (_$, { path }) => {
    const text = files.get(path)
    if (text !== undefined) return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
    if ([...files.keys()].some(file => file.startsWith(`${path}/`))) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    return { deny: `ENOENT: ${path}` }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({
    value: [...files.keys()].some(path => path === e.path || path.startsWith(`${e.path}/`)),
  }))
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const names = new Set<string>()
    for (const path of files.keys()) {
      if (path.startsWith(`${e.path}/`)) names.add(path.slice(e.path.length + 1).split('/')[0] ?? '')
    }
    return {
      value: [...names].map(name => {
        const text = files.get(`${e.path}/${name}`)
        return { name, kind: text === undefined ? 'dir' : 'file', size: text?.length ?? 0, mtimeMs: 0, isLink: false }
      }),
    }
  })
  const archive = emptyArchive()
  on('process.spawn', async function* (_$, request) {
    if (!request.argv.includes('shift-history')) throw new Error('Unexpected native process.')
    const text = archiveFixture(archive, request.input ?? '')
    if (archive.entries.length || archive.working) files.set('/proj/.shift/history.db', '')
    yield { stream: 'stdout', text }
    return { value: { code: 0, signal: null } }
  })
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const [command] = e.argv
    if (command === 'uname' || e.argv.includes('shift-install-task')) {
      return {
        value: {
          exitCode: 0,
          stdout: command === 'uname' ? 'Linux x86_64' : './.shift/bin/shift-task',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    if (command === 'git' && e.argv.includes('rev-parse')) {
      return { value: { exitCode: 0, stdout: '.git/info/exclude\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command === 'git') {
      return {
        value: {
          exitCode: files.get('/proj/.git/info/exclude')?.includes('.shift/') ? 0 : ignored,
          stdout: '',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.log', (_$: unknown, e: { text: string }) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$: unknown, e: { text: string | undefined }) => {
    logs.push(`status: ${e.text ?? ''}`)
    return { value: undefined }
  })
  return archive
}

function project(): Map<string, string> {
  return new Map([
    ['/proj/.shift/letter.md', LETTER],
    ['/proj/.shift/board.md', BOARD],
    ['/proj/.shift/OWNER.md', OWNER],
    ['/proj/.shift/knowledge/traps.md', TRAPS],
  ])
}

test('the shift tool snapshots the letter and the project records, and accepts once', async ($, on) => {
  const files = project()
  const archive = stubSession(on, files)
  mock.clock(on, { now: AT })

  const answer = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'continue',
    about: 'ABOUT',
  })
  expect(answer.deny).toBeUndefined()
  expect(String(answer.result)).toContain('Shift accepted')
  expect(archive.entries[0]?.files['letter.md']).toBe(LETTER)
  expect(archive.entries[0]?.files['board.md']).toBe(BOARD)
  expect(Object.keys(archive.entries[0]?.files ?? {})).not.toContain('tasks/tests/track.md')
  expect(archive.entries[0]?.files['OWNER.md']).toBe(OWNER)
  expect(archive.entries[0]?.files['knowledge/traps.md']).toBe(TRAPS)
  expect(archive.entries[0]?.about).toContain('result: pending')

  const again = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'wait',
    about: 'ABOUT',
  })
  expect(again.deny).toContain('already accepted')
})

test('the shift tool refuses without a board or a letter', async ($, on) => {
  const files = new Map([['/proj/.shift/letter.md', LETTER]])
  stubSession(on, files)
  mock.clock(on, { now: AT })

  const noBoard = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'wait',
    about: 'ABOUT',
  })
  expect(noBoard.deny).toContain('No board')
  const noLetter = await $.tool.call({ tool: 'mcp__shift__shift', letter: 'missing.md', after: 'wait', about: 'ABOUT' })
  expect(noLetter.deny).toContain('No letter')
})

test('records the project would commit go to its local exclude file, and the shift goes on', async ($, on) => {
  const files = project()
  stubSession(on, files, [], () => 50000, 1)
  mock.clock(on, { now: AT })

  const answer = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'wait',
    about: 'ABOUT',
  })
  expect(answer.deny).toBeUndefined()
  expect(String(answer.result)).toContain('the mod added ".shift/" to /proj/.git/info/exclude')
  expect(files.get('/proj/.git/info/exclude')).toBe('.shift/\n')
})

test('continue: after the turn the history is let go with the hold, and the letter and the work start a turn', async ($, on) => {
  const files = project()
  const compacted: string[] = []
  const submitted: string[] = []
  const archive = stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  on('session.compact', (_$: unknown, e: { instructions?: string }) => {
    compacted.push(e.instructions ?? '')
    return { messages: [{ role: 'user', text: 'SUMMARY', toolUses: [], toolResults: [] }], tokensBefore: 120000, tokensAfter: 9000 }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'continue', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(compacted).toEqual([])
  await clock.advance(500)

  expect(compacted.length).toBe(1)
  expect(compacted[0]).toContain('HOLD-THIS')
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('Shift done')
  expect(submitted[0]).toContain('fixing tests')
  expect(submitted[0]).not.toContain('.shift/tasks/')
  expect(submitted[0]).not.toContain('«тесты зеленые перед коммитом»')
  expect(submitted[0]).not.toContain('knowledge/traps.md')
  expect(archive.entries[0]?.files['SHIFT.md']).toContain('sections: Edits')
  expect(submitted[0]).not.toContain('third replacement')
  expect(archive.entries[0]?.files['summary.md']).toContain('SUMMARY')
  expect(archive.entries[0]?.about).toContain('continuing')
  expect(archive.entries[0]?.about).toContain('tokens: 120K → 50K')
})

test('continue: the message rides in the compaction history, and one line starts the turn', async ($, on) => {
  const files = project()
  const submitted: string[] = []
  const archive = stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  // The /compact the let-go runs waits here: the compaction itself is raised from the test, as the engine's command
  // raises it, while the let-go stands with the message ready to be appended.
  let release: (() => void) | undefined
  const commands: { command: string; args: string }[] = []
  on('command.run', (_$: unknown, e: { command: string; args: string }) => {
    commands.push({ command: e.command, args: e.args })

    return new Promise(resolve => {
      release = () => resolve({ text: 'Compacted' })
    })
  })
  on('session.compact', () => ({
    messages: [{ role: 'user', text: 'SUMMARY', toolUses: [], toolResults: [] }],
    tokensBefore: 120000,
    tokensAfter: 9000,
  }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'continue', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(500)
  expect(commands.map(one => one.command)).toEqual(['compact'])
  expect(commands[0]?.args).toContain('HOLD-THIS')
  // The engine's own compaction, with the instructions the command was asked with: the message goes into the history.
  const replaced = await $.session.compact({
    trigger: 'manual',
    instructions: commands[0]?.args,
    messages: [{ role: 'user', text: 'OLD', toolUses: [] }],
  })
  expect(replaced.messages?.at(-1)).toMatchObject({ text: expect.stringContaining('<letter shift=') })
  release?.()
  for (let waited = 0; waited < 20 && submitted.length === 0; waited++) await clock.advance(5)

  // The letter and the board went into the replacement history: the turn starts from one line, never the
  // whole message told twice.
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).not.toContain('<letter shift=')
  expect(submitted[0]).toContain('Continue from "Next"')
  // What settled the shift is the engine's own compaction, not the message appended to it.
  expect(archive.entries[0]?.files['summary.md']).toContain('SUMMARY')
  expect(archive.entries[0]?.files['summary.md']).not.toContain('<letter shift=')
  expect(archive.entries[0]?.about).toContain('continuing')
  expect(archive.entries[0]?.about).toContain('tokens: 120K → 50K')
})

test('continue: an unrelated compaction neither takes the message nor settles the shift', async ($, on) => {
  const files = project()
  const submitted: string[] = []
  const archive = stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  let release: (() => void) | undefined
  on(
    'command.run',
    () =>
      new Promise(resolve => {
        release = () => resolve({ text: undefined })
      }),
  )
  on('session.compact', (_$: unknown, e: { trigger: string }) => ({
    messages: [{ role: 'user', text: `T-${e.trigger}`, toolUses: [], toolResults: [] }],
  }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'continue', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(500)

  // An unasked compaction while the let-go waits for its own: it takes nothing from the shift.
  const auto = await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'OLD', toolUses: [] }] })
  expect(auto.messages).toHaveLength(1)
  expect(auto.messages?.[0]).toMatchObject({ text: 'T-auto' })
  release?.()
  for (let waited = 0; waited < 20 && submitted.length === 0; waited++) await clock.advance(5)

  // Nothing stood for the shift's own compaction: the history is let go the plain way and the letter goes as the prompt.
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('<letter shift=')
  expect(archive.entries[0]?.files['summary.md']).toContain('T-undefined')
  expect(archive.entries[0]?.files['summary.md']).not.toContain('T-auto')
})

test('continue: a /compact that does not compact lets the history go the plain way, the letter as the prompt', async ($, on) => {
  const files = project()
  const submitted: string[] = []
  const archive = stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  on('command.run', () => ({ text: undefined }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'SUMMARY', toolUses: [], toolResults: [] }] }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'continue', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(500)

  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('Shift done')
  expect(submitted[0]).toContain('<letter shift=')
  expect(archive.entries[0]?.about).toContain('continuing')
})

test("the owner's message while a shift is under way is held and goes after the letter", async ($, on) => {
  const files = project()
  const submitted: string[] = []
  stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'SUMMARY', toolUses: [], toolResults: [] }] }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'continue', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  // Typed after the turn that shifted ended, before the history is let go: the engine would run it first.
  const typed = await $.prompt.submit({ text: 'OWNER WORDS', origin: { kind: 'composer' }, wait: false })
  expect(typed).toEqual({ drop: expect.stringContaining('waits for the shift') })
  expect(submitted).toEqual([])
  await clock.advance(1500)

  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('Shift done')
  expect(submitted[0]).toEndWith('OWNER WORDS')
  // The shift is over: the next message goes as it is.
  await $.prompt.submit({ text: 'NEXT', origin: { kind: 'composer' }, wait: false })
  expect(submitted.at(-1)).toBe('NEXT')
})

test("wait: the letter rides along with the owner's next prompt, once", async ($, on) => {
  const files = project()
  const contexts: (readonly string[] | undefined)[] = []
  const logs: string[] = []
  const archive = stubSession(on, files, logs)
  const clock = mock.clock(on, { now: AT })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [], toolResults: [] }] }))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    contexts.push(e.context)
    logs.push(`entered: ${e.text}`)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'wait', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(500)
  await $.prompt.submit({ text: 'a notification', origin: { kind: 'unclassified' }, wait: false })
  await $.prompt.submit({ text: 'owner speaks', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: 'owner again', origin: { kind: 'composer' }, wait: false })

  expect(contexts[0] ?? []).toEqual([])
  expect(String(contexts[0])).not.toContain('<letter')
  expect(String(contexts[1])).toContain('fixing tests')
  expect(String(contexts[1])).toContain(`<shift id="${ID}">`)
  expect(String(contexts[1])).toContain('<letter shift=')
  expect(String(contexts[1])).toContain('<file path=".shift/board.md">')
  expect(String(contexts[1]).trimEnd().endsWith('</shift>')).toBe(true)
  expect(doctrine(['shift']).startsWith('<shift note=')).toBe(true)
  expect(String(contexts[1])).not.toContain('tasks/tests')
  const handed = String(contexts[1])
  expect(handed).toContain('No earlier shifts.')
  expect(handed.indexOf('<file path=".shift/board.md">')).toBeLessThan(handed.indexOf('<letter shift='))
  expect(handed).not.toContain(' · ABOUT')
  expect(contexts[2] ?? []).toEqual([])
  // Rows in the transcript only: the status line under the input was noise.
  expect(logs).toEqual([
    expect.stringContaining('waiting for you, the letter goes with your next message'),
    'entered: a notification',
    'entered: owner speaks',
    expect.stringContaining('went with your message: letter.md, board.md — '),
    'entered: owner again',
  ])
  expect(logs.some(line => line.startsWith('status:'))).toBe(false)
  expect(archive.entries[0]?.about).toContain('waiting for the owner')
})

test('the guide directs agents to the project CLI without exposing task tools', async ($, on) => {
  const files = project()
  stubSession(on, files)
  const guide = await $.tool.call({ tool: 'mcp__shift__shift_guide', section: 'flow' })
  expect(String(guide.result)).toContain('shift_setup(section="tasks")')
  expect(String(guide.result)).not.toContain('task_open')
  expect(String(guide.result)).not.toContain('shift_migrate')
})

test('a hint goes with a tool result and with a prompt, and a let-go starts a new stretch', async ($, on) => {
  const files = project()
  let tokens = 20000
  const prompts: (readonly string[] | undefined)[] = []
  const logs: string[] = []
  stubSession(on, files, logs, () => tokens, 0, [], undefined, 500_000)
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    prompts.push(e.context)
    return { text: e.text }
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [], toolResults: [] }] }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  const bash = () => $.tool.call({ tool: 'Bash', command: 'x' } as never)
  // The row a result adds to the history is counted by its tool.
  const toolResult = () =>
    $.session.append({
      message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
      door: 'tool-result',
      origin: { kind: 'tool', tool: 'Bash' },
      uuid: 'u',
    })

  await bash()
  await toolResult()
  tokens = 300_000
  const hinted = String((await bash()).context)
  expect(hinted).toContain('<shift note="a hint from the mod, not part of what it came with">\nShift hint')
  expect(hinted).toContain('Mostly from: Bash')
  expect(logs.filter(line => line.startsWith('to the agent — Shift hint'))).toHaveLength(1)
  tokens = 310_000
  expect(String((await bash()).context)).not.toContain('Shift hint')
  tokens = 420_000
  await $.prompt.submit({ text: 'owner', origin: { kind: 'composer' }, wait: false })
  expect(String(prompts[0])).toContain('420K of 500K used')

  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'long history', toolUses: [], toolResults: [] }] })
  tokens = 30000
  await $.prompt.submit({ text: 'owner', origin: { kind: 'composer' }, wait: false })
  expect(String(prompts[1])).toContain('without your shift')
  const status = await $.tool.call({ tool: 'mcp__shift__shift_status' })
  expect(String(status.result)).toContain('Since the last shift: +0.')
})

test('a fresh process takes the count back from the last shift and the history', async ($, on) => {
  const files = project()
  const about = (session: string) =>
    `---\ndescription: d\nresult: shifted (95K → 6K), waiting for the owner\ntokens: 95K → 6K\nsession: ${session}\n---\n`

  const history = [
    { role: 'user', content: 'summary of the stretch' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000) }] },
  ]
  const archive = stubSession(on, files, [], () => 150_000, 0, history)
  archive.entries.push({ id: ID, about: about('sess'), state: 'complete', files: {} })
  files.set('/proj/.shift/history.db', '')

  const status = String((await $.tool.call({ tool: 'mcp__shift__shift_status' })).result)
  expect(status).toContain('Since the last shift: +144K.')
  expect(status).toContain('Grown mostly from: Read 99%.')

  expect(shiftFill(about('other'), 'sess')).toBeNull()
  expect(shiftFill(about('sess').replace('result: shifted', 'result: not shifted'), 'sess')).toBeNull()
  expect(growthOf([{ role: 'user', content: [{ type: 'text', text: '<system-reminder>\nrules\n</system-reminder>' }] }])).toEqual({
    'attachments and reminders': 42,
  })
})

test('the shift tool refuses a bad call', async $ => {
  const answer = await $.tool.call({ tool: 'mcp__shift__shift', letter: '', after: 'wait', about: 'ABOUT' })
  expect(answer.deny).toContain('letter')
})

test('the history and guide tools answer', async ($, on) => {
  const files = project()
  stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [], toolResults: [] }] }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))

  const guide = await $.tool.call({ tool: 'mcp__shift__shift_guide' })
  expect(String(guide.result)).toContain('four nonempty sections')

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'wait', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(500)
  const history = await $.tool.call({ tool: 'mcp__shift__shift_history' })
  expect(String(history.result)).toContain('s-0000000000000001')
  expect(String(history.result)).toContain('ABOUT')
})

test('after Edit and Write the map follows, the toc and remarks come with the next prompt; the docs tools answer', async ($, on) => {
  const files = project()
  files.set('/proj/.shift/settings.toml', '[docs]\ntoc = true')
  files.set('/proj/docs/a.md', '---\ndescription: A\n---\n\n# A\n\n## One\n')
  stubSession(on, files)
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    contexts.push(e.context)
    return { text: e.text }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }) as never)
  on('tool.call', { tool: 'Write' }, (_$, e) => {
    files.set(e.file_path, e.content)
    return { result: 'written' } as never
  })

  const edited = await $.tool.call({ tool: 'Edit', file_path: '/proj/docs/a.md', old_string: 'x', new_string: 'y' } as never)
  expect(edited.context).toBeUndefined()
  expect(files.get('/proj/docs/a.md')).not.toContain('<!-- toc -->')
  const map = await $.tool.call({ tool: 'mcp__shift__shift_record', action: 'read', name: 'SHIFT.md' })
  expect(String(map.result)).toContain('`docs/a.md` — A')
  expect(files.has('/proj/.shift/SHIFT.md')).toBe(false)
  const written = await $.tool.call({ tool: 'Write', file_path: '/proj/src/x.ts', content: '// docs/gone.md' } as never)
  expect(written.context).toBeUndefined()

  await $.prompt.submit({ text: 'owner', origin: { kind: 'composer' }, wait: false })
  const settled = (contexts[0] ?? []).join('\n')
  expect(settled).toContain('The mod wrote the toc of `docs/a.md`')
  expect(settled).toContain('`src/x.ts`: a link to `docs/gone.md` that is not there.')
  expect(files.get('/proj/docs/a.md')).toContain('<!-- toc -->\n- One\n<!-- /toc -->')
  await $.prompt.submit({ text: 'owner', origin: { kind: 'composer' }, wait: false })
  expect(contexts[1]).toBeUndefined()

  const head = await $.tool.call({ tool: 'mcp__shift__doc_outline', path: 'docs/a.md' })
  expect(String(head.result)).toMatch(/\d+ {2}One/)
  const mentions = await $.tool.call({ tool: 'mcp__shift__docs_mentioning', file: 'src/a.md' })
  expect(String(mentions.result)).toContain('No document in `docs/` mentions `a.md`.')
})

test('a Write the engine held for review wrote nothing, so no document follows it', async ($, on) => {
  const files = project()
  files.set('/proj/.shift/settings.toml', '[docs]\ntoc = true')
  files.set('/proj/docs/a.md', '---\ndescription: A\n---\n\n# A\n')
  stubSession(on, files)
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    contexts.push(e.context)
    return { text: e.text }
  })
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'update', filePath: '/proj/docs/a.md', staged: true } }) as never)

  const held = await $.tool.call({ tool: 'Write', file_path: '/proj/docs/a.md', content: '# A\n\n## One\n' } as never)
  expect(held.context).toBeUndefined()
  await $.prompt.submit({ text: 'owner', origin: { kind: 'composer' }, wait: false })
  expect(contexts[0] ?? []).toEqual([])
  expect(String(contexts[0])).not.toContain('docs/a.md')
  await $.prompt.submit({ text: 'again', origin: { kind: 'composer' }, wait: false })
  expect(contexts[1] ?? []).toEqual([])
  expect(files.get('/proj/docs/a.md')).not.toContain('<!-- toc -->')
})

test("records are looked at around every tool: the agent's own change told only when broken, someone else's always", async ($, on) => {
  const files = project()
  stubSession(on, files)
  let edit: (() => void) | null = null
  on('tool.call', { tool: 'Bash' }, () => {
    edit?.()
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  const bash = () => $.tool.call({ tool: 'Bash', command: 'x' } as never)

  await bash()
  edit = () => files.set('/proj/.shift/OWNER.md', `${OWNER}\n- confirmed\n  Permanent`)
  expect((await bash()).context).toBeUndefined()
  edit = () => files.set('/proj/.shift/board.md', '## Goal\nthe mod')
  expect(String((await bash()).context)).toContain('`.shift/board.md`: The board lacks sections')
  edit = null
  files.set('/proj/.shift/OWNER.md', `${OWNER}\n- by the owner's hand\n  Permanent`)
  const outside = String((await bash()).context)
  expect(outside).toContain('`.shift/OWNER.md` changed outside your tools')
  expect(outside).not.toContain('board.md')
  expect((await bash()).context).toBeUndefined()
})

test('/unshift hands the last saved letter and current board to a fresh session', async ($, on) => {
  const files = project()
  files.set('/proj/.shift/history.db', '')
  const submitted: string[] = []
  const archive = stubSession(on, files)
  archive.entries.push({
    id: ID,
    state: 'complete',
    about: '---\ndescription: Old shift\n---',
    files: { 'letter.md': LETTER, 'board.md': BOARD },
  })
  const clock = mock.clock(on, { now: AT })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  const unshift = (args: string) =>
    $.command.run({ command: 'unshift', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  const run = await unshift('')
  expect(run.text).toContain('s-0000000000000001')
  expect(run.context?.[0]).toContain('fixing tests')
  expect(run.context?.[0]).toContain('## Goal')
  expect(run.context?.[0]).not.toContain('.shift/tasks/')
  await clock.advance(200)
  expect(submitted).toEqual([expect.stringContaining('Pick up from the shift above')])

  // The owner's words typed with the command go after the letter, as their own.
  const typed = await unshift('  look at the parser first ')
  expect(typed.context?.[0]).toContain('fixing tests')
  await clock.advance(200)
  expect(submitted.at(-1)).toBe('look at the parser first')

  // The owner's message right after a bare command makes the mod's own prompt needless.
  await unshift('')
  await $.prompt.submit({ text: 'and the docs', origin: { kind: 'composer' } } as never)
  await clock.advance(200)
  expect(submitted.slice(-2)).toEqual(['look at the parser first', 'and the docs'])
})

test('/shift starts a turn of its own with the ask to shift and the words typed after it', async ($, on) => {
  stubSession(on, project())
  const submitted: string[] = []
  const clock = mock.clock(on, { now: AT })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  const run = await $.command.run({
    command: 'shift',
    args: ' hold the parser ',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(run.text).toBeUndefined()
  await clock.advance(200)
  expect(submitted).toEqual([SHIFT_NOW('hold the parser')])
})

test('settings turn the mod off in a project: no tools, no doctrine; without docs no docs tools', async ($, on) => {
  const files = project()
  stubSession(on, files)
  const registered: string[] = []
  on('tool.register', (_$: unknown, e: { name: string }) => {
    registered.push(e.name)
    return { value: undefined as never }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', (_$: unknown, e: unknown) => e as never)
  on('prompt.compose', () => ({ sections: [] }))
  const compose = () => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)

  await $.session.start({ cwd: '/proj', surface: null } as never)
  expect(registered).toContain('shift')
  expect((await compose()).sections.map(section => section.id)).toContain('shift:doctrine')
  const loaded = (await compose()).sections.find(section => section.id === 'shift:files')?.text
  expect(loaded).toContain('<file path=".shift/OWNER.md">')
  expect(loaded).not.toContain('TASKS.md')

  expect(registered).toContain('doc_outline')

  registered.length = 0
  files.set('/proj/.shift/settings.toml', '[docs]\ndirs = []\n')
  await $.session.start({ cwd: '/proj', surface: null } as never)
  expect(registered).toContain('shift')
  expect(registered).not.toContain('doc_outline')
  const doctrineText = (await compose()).sections.find(section => section.id === 'shift:doctrine')?.text
  expect(doctrineText).toContain('- `shift_setup` — ')
  expect(doctrineText).not.toContain('docs_mentioning')

  registered.length = 0
  files.set('/proj/.shift/settings.toml', '# not here\nenabled = false\n')
  await $.session.start({ cwd: '/proj', surface: null } as never)
  expect(registered).toEqual([])
  expect((await compose()).sections).toEqual([])
})

test("a resumed or cleared session reads the session's files again; shift_setup answers", async ($, on) => {
  const files = project()
  let session = 'one'
  stubSession(
    on,
    files,
    [],
    () => 50000,
    0,
    [],
    () => session,
  )
  on('tool.register', () => ({ value: undefined as never }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', (_$: unknown, e: unknown) => e as never)
  on('prompt.compose', () => ({ sections: [] }))
  const compose = async () =>
    (
      await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
    ).sections.find(section => section.id === 'shift:files')?.text

  await $.session.start({ cwd: '/proj', surface: null } as never)
  expect(await compose()).not.toContain('NEW RULE')
  files.set('/proj/.shift/OWNER.md', '# Owner decisions\n\n## Scope\n\n- NEW RULE')
  expect(await compose()).not.toContain('NEW RULE')
  expect(String((await $.tool.call({ tool: 'mcp__shift__shift_setup' })).result)).toContain(
    "Changed or removed since this session's block was read: `.shift/OWNER.md`.",
  )

  session = 'two'
  expect(await compose()).toContain('NEW RULE')
})

test('a restored chat gets one section delta, the writer stays quiet, and replacement refreshes the system block', async ($, on) => {
  const files = project()
  const path = '/proj/docs/api.md'
  const body = '---\ndescription: API guide\n---\n# API\n## Slots\none\n## Stable\ntwo\n'
  files.set(path, body)
  let id = 'reader'
  stubSession(
    on,
    files,
    [],
    () => 50000,
    0,
    [{ role: 'user', content: 'previous turn' }],
    () => id,
  )
  const saved = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: saved.get(e.key) }))
  on('store.set', (_$, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('tool.register', () => ({ value: undefined as never }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', (_$, e) => e as never)
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'digest', toolUses: [] }] }))
  on('tool.call', { tool: 'Write' }, (_$, e) => {
    files.set(e.file_path, e.content)
    return { result: 'written' } as never
  })
  const start = () => $.session.start({ cwd: '/proj', surface: null } as never)
  const full = async () =>
    (
      await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
    ).sections.find(s => s.id === 'shift:files')?.text
  const prompt = async () => JSON.stringify(await $.prompt.submit({ text: 'go', origin: { kind: 'composer' }, wait: false }))
  await start()
  const first = await full()
  expect(first).toContain('Slots · Stable')
  id = 'writer'
  await start()
  const written = body.replace('one', 'different body').replace('## Stable', '## Changed')
  const own = await $.tool.call({ tool: 'Write', file_path: path, content: written } as never)
  expect(String(own.context)).not.toContain('Slots (changed)')
  expect(await prompt()).not.toContain('Slots (changed)')
  id = 'reader'
  await start()
  expect(await full()).toBe(first)
  const result = await prompt()
  expect(result).toContain('Slots (changed)')
  expect(result).toContain('Changed (new)')
  expect(result).toContain('Stable (deleted)')
  expect(await prompt()).not.toContain('Slots (changed)')
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'old', toolUses: [] }] })
  expect(await full()).toContain('Slots · Changed')

  const key = 'context:reader /proj'
  const cached = saved.get(key) as { version?: number; files: string; checkpoint: { mapNotes: string[] } }
  saved.set(key, {
    files: `${cached.files}\n<file path="beads:claimed">stale task card</file>`,
    checkpoint: { ...cached.checkpoint, mapNotes: ['Queued before the interrupted upgrade.'] },
  })
  await start()
  expect(await full()).not.toContain('stale task card')
  expect(await prompt()).toContain('Queued before the interrupted upgrade.')
  expect(await prompt()).not.toContain('Queued before')
  expect(typeof (saved.get(key) as { version?: number }).version).toBe('number')
})
