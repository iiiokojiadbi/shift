import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { doctrine, growthOf, shiftFill } from '../hooks/core/index'
import { BOARD, LETTER, LIST, OWNER, TESTS, TRACK, TRAPS } from './data'

const AT = Date.UTC(2026, 9, 23, 14, 5, 9)
const DIR = '/proj/.shift/shifts/20261023-140509'

type On = Parameters<TestBody>[1]

function stubSession(
  on: On,
  files: Map<string, string>,
  logs: string[] = [],
  tokens = () => 50000,
  ignored = 0,
  history: { role: string; content: unknown }[] = [],
  session = () => 'sess',
) {
  on('session.root', () => ({ value: '/proj' }))
  on('session.messages', () => ({ value: history as never }))
  on('session.id', () => ({ value: session() }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: tokens() }, rateLimits: [] } }))
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
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
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const [command, from, to] = e.argv
    if (command === 'git' && e.argv.includes('rev-parse')) {
      return { value: { exitCode: 0, stdout: '.git/info/exclude\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command === 'git') {
      return { value: { exitCode: ignored, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (command === 'mv' && from !== undefined && to !== undefined) {
      for (const [path, text] of [...files]) {
        if (!path.startsWith(`${from}/`)) continue
        files.delete(path)
        files.set(to + path.slice(from.length), text)
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
}

function project(): Map<string, string> {
  return new Map([
    ['/proj/.shift/letter.md', LETTER],
    ['/proj/.shift/board.md', BOARD],
    ['/proj/.shift/OWNER.md', OWNER],
    ['/proj/.shift/TASKS.md', LIST],
    ['/proj/.shift/knowledge/traps.md', TRAPS],
    ['/proj/.shift/tasks/tests/task.md', TESTS.task ?? ''],
    ['/proj/.shift/tasks/tests/track.md', TRACK],
  ])
}

test('the shift tool snapshots the letter, the board and the tasks, and accepts once', async ($, on) => {
  const files = project()
  stubSession(on, files)
  mock.clock(on, { now: AT })

  const answer = await $.tool.call({
    tool: 'mcp__shift__shift',
    letter: '.shift/letter.md',
    after: 'continue',
    about: 'ABOUT',
  })
  expect(answer.deny).toBeUndefined()
  expect(String(answer.result)).toContain('Shift accepted')
  expect(files.get(`${DIR}/letter.md`)).toBe(LETTER)
  expect(files.get(`${DIR}/board.md`)).toBe(BOARD)
  // The shift gave the items ids.
  expect(files.get(`${DIR}/tasks/tests/track.md`)).toBe('- [in progress] #1 fix the parser\n- [open] #2 cover the archive')
  expect(files.get(`${DIR}/OWNER.md`)).toBe(OWNER)
  expect(files.get(`${DIR}/knowledge/traps.md`)).toBe(TRAPS)
  expect(files.get(`${DIR}/about.md`)).toContain('result: pending')

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
  stubSession(on, files)
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
  expect(submitted[0]).toContain('.shift/tasks/tests/track.md')
  expect(submitted[0]).toContain('cover the archive')
  expect(submitted[0]).not.toContain('«тесты зеленые перед коммитом»')
  expect(submitted[0]).toContain('knowledge/traps.md — traps of edits and tests')
  expect(submitted[0]).not.toContain('third replacement')
  expect(files.get(`${DIR}/summary.md`)).toContain('SUMMARY')
  expect(files.get(`${DIR}/about.md`)).toContain('continuing')
  expect(files.get(`${DIR}/about.md`)).toContain('tokens: 120K → 50K')
})

test("wait: the letter rides along with the owner's next prompt, once", async ($, on) => {
  const files = project()
  const contexts: (readonly string[] | undefined)[] = []
  const logs: string[] = []
  stubSession(on, files, logs)
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
  expect(String(contexts[1])).toContain('fixing tests')
  expect(String(contexts[1])).toMatch(/^<shift folder="[^"]+\/">/)
  expect(String(contexts[1])).toContain('<letter path=')
  expect(String(contexts[1])).toContain('<file path=".shift/board.md">')
  expect(String(contexts[1]).trimEnd().endsWith('</shift>')).toBe(true)
  expect(doctrine(['shift']).startsWith('<shift note=')).toBe(true)
  expect(String(contexts[1])).toContain('fix the parser')
  // The records first, the recent shifts in the middle, the letter last.
  const handed = String(contexts[1])
  expect(handed.indexOf('<file path=".shift/board.md">')).toBeLessThan(handed.indexOf('<shifts>'))
  expect(handed.indexOf('</shifts>')).toBeLessThan(handed.indexOf('<letter path='))
  expect(handed).toMatch(/- \d{8}-\d{6} · ABOUT\n<\/shifts>/)
  expect(contexts[2] ?? []).toEqual([])
  // Rows in the transcript only: the status line under the input was noise.
  expect(logs).toEqual([
    expect.stringContaining('waiting for you, the letter goes with your next message'),
    'entered: a notification',
    'entered: owner speaks',
    expect.stringContaining('went with your message: letter.md, board.md, tasks/tests/, knowledge/ (the map) — '),
    'entered: owner again',
  ])
  expect(logs.some(line => line.startsWith('status:'))).toBe(false)
  expect(files.get(`${DIR}/about.md`)).toContain('waiting for the owner')
})

test('task_archive moves the folder and writes the index line', async ($, on) => {
  const files = project()
  files.set('/proj/.shift/tasks/tests/track.md', '- [done] fix the parser')
  stubSession(on, files)

  const answer = await $.tool.call({ tool: 'mcp__shift__task_archive', name: 'tests', outcome: 'done', about: 'green' })
  expect(answer.deny).toBeUndefined()
  expect(String(answer.result)).toContain('TASKS.md no longer lists it')
  expect(files.get('/proj/.shift/TASKS.md')).toBe('# Tasks\n\nnone\n')
  expect(files.has('/proj/.shift/tasks/tests/task.md')).toBe(false)
  expect(files.get('/proj/.shift/archive/tests/track.md')).toBe('- [done] fix the parser')
  expect(files.get('/proj/.shift/archive/index.md')).toContain('- [done] [Green tests](tests/) — green')

  const again = await $.tool.call({ tool: 'mcp__shift__task_archive', name: 'tests', outcome: 'done', about: 'green' })
  expect(again.deny).toContain('already exists')
})

test('a hint goes with a tool result and with a prompt, and a let-go starts a new stretch', async ($, on) => {
  const files = project()
  let tokens = 20000
  const prompts: (readonly string[] | undefined)[] = []
  const logs: string[] = []
  stubSession(on, files, logs, () => tokens)
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
  tokens = 165000
  const hinted = String((await bash()).context)
  expect(hinted).toContain('<shift note="a hint from the mod, not part of what it came with">\nShift hint')
  expect(hinted).toContain('Mostly from: Bash')
  expect(logs.filter(line => line.startsWith('to the agent — Shift hint'))).toHaveLength(1)
  tokens = 170000
  expect(String((await bash()).context)).not.toContain('Shift hint')
  tokens = 175000
  await $.prompt.submit({ text: 'owner', origin: { kind: 'composer' }, wait: false })
  expect(String(prompts[0])).toContain('175K of 200K used')

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
  files.set('/proj/.shift/shifts/20260101-000000/about.md', about('sess'))
  const history = [
    { role: 'user', content: 'summary of the stretch' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000) }] },
  ]
  stubSession(on, files, [], () => 150_000, 0, history)

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
  expect(String(guide.result)).toContain('strict structure')

  await $.tool.call({ tool: 'mcp__shift__shift', letter: '.shift/letter.md', after: 'wait', about: 'ABOUT' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.advance(500)
  const history = await $.tool.call({ tool: 'mcp__shift__shift_history' })
  expect(String(history.result)).toContain('20261023-140509')
  expect(String(history.result)).toContain('ABOUT')
})

test('after Edit and Write the docs follow: the toc, the map and remarks in the result; the docs tools answer', async ($, on) => {
  const files = project()
  files.set('/proj/.shift/settings.toml', '[docs]\ntoc = true')
  files.set('/proj/docs/a.md', '---\ndescription: A\n---\n\n# A\n\n## One\n')
  stubSession(on, files)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }) as never)
  on('tool.call', { tool: 'Write' }, (_$, e) => {
    files.set(e.file_path, e.content)
    return { result: 'written' } as never
  })

  const edited = await $.tool.call({ tool: 'Edit', file_path: '/proj/docs/a.md', old_string: 'x', new_string: 'y' } as never)
  expect(edited.context?.[0]).toContain('rewrote the toc of `docs/a.md`')
  expect(files.get('/proj/docs/a.md')).toContain('<!-- toc -->\n- One\n<!-- /toc -->')
  expect(files.get('/proj/.shift/SHIFT.md')).toContain('`docs/a.md` — A')
  const quiet = await $.tool.call({ tool: 'Edit', file_path: '/proj/docs/a.md', old_string: 'x', new_string: 'y' } as never)
  expect(quiet.context).toBeUndefined()

  const written = await $.tool.call({ tool: 'Write', file_path: '/proj/src/x.ts', content: '// docs/gone.md' } as never)
  expect(written.context?.[0]).toContain('`src/x.ts`: a link to `docs/gone.md` that is not there.')

  const head = await $.tool.call({ tool: 'mcp__shift__doc_outline', path: 'docs/a.md' })
  expect(String(head.result)).toMatch(/\d+ {2}One/)
  const mentions = await $.tool.call({ tool: 'mcp__shift__docs_mentioning', file: 'src/a.md' })
  expect(String(mentions.result)).toContain('No document in `docs/` mentions `a.md`.')
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
  edit = () => files.set('/proj/.shift/tasks/tests/track.md', '- [done] fix the parser\n- [done] cover the archive')
  expect((await bash()).context).toBeUndefined()
  edit = () => files.set('/proj/.shift/board.md', '## Goal\nthe mod')
  expect(String((await bash()).context)).toContain('`.shift/board.md`: The board lacks sections')
  edit = null
  files.set('/proj/.shift/OWNER.md', `${OWNER}\n- by the owner's hand`)
  const outside = String((await bash()).context)
  expect(outside).toContain('`.shift/OWNER.md` changed outside your tools')
  expect(outside).not.toContain('board.md')
  expect((await bash()).context).toBeUndefined()

  // The mod's own tool writes a record: remembered, never named as someone else's at the next tool.
  files.set('/proj/.shift/board.md', BOARD)
  await bash()
  await $.tool.call({ tool: 'mcp__shift__task_track', task: 'tests', id: 2, status: 'done', note: 'a longer note than before' })
  expect((await bash()).context).toBeUndefined()
})

test('/unshift hands the last letter, the board and the tasks in progress to a fresh session', async ($, on) => {
  const files = project()
  files.set(`${DIR}/letter.md`, LETTER)
  const submitted: string[] = []
  stubSession(on, files)
  const clock = mock.clock(on, { now: AT })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  const unshift = (args: string) =>
    $.command.run({ command: 'unshift', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  const run = await unshift('')
  expect(run.text).toContain('20261023-140509')
  expect(run.context?.[0]).toContain('fixing tests')
  expect(run.context?.[0]).toContain('## Goal')
  expect(run.context?.[0]).toContain('# Green tests')
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
  expect(loaded).toContain('<file path=".shift/TASKS.md">')

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
    "Changed since this session's block was read: `.shift/OWNER.md`.",
  )

  session = 'two'
  expect(await compose()).toContain('NEW RULE')
})
