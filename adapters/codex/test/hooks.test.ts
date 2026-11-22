import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, chmod, mkdir, readFile, rmdir, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { settingsDocument } from '../../../core/src/settings'
import { BOARD, LETTER } from '../../../core/test/data'
import { historyRuntime } from '../../npm/test/native-history'
import { cleanup, scratch } from '../../npm/test/scratch'

import { prepareHandover, wakeInput } from '../handover'

let archive: Awaited<ReturnType<typeof historyRuntime>>
beforeAll(async () => {
  archive = await historyRuntime()
}, 60000)
afterAll(cleanup)

async function fixture() {
  const root = await scratch('native-hooks')
  const home = await scratch('native-profile')
  const transcript = join(root, 'transcript')
  await mkdir(join(root, '.shift'))
  await mkdir(join(root, 'docs'))
  await writeFile(transcript, '')
  await writeFile(join(root, '.shift/board.md'), BOARD)
  await writeFile(join(root, '.shift/OWNER.md'), 'Unrelated decision marker.')
  await writeFile(join(root, '.shift/settings.toml'), '[files]\nalways = ["details.txt"]\n[docs]\ndirs = ["docs", "later"]\ntoc = true\n')
  await writeFile(join(root, 'details.txt'), 'Initial details.')
  const doc = join(root, 'docs/example.md')
  await writeFile(doc, '---\ndescription: A fixture\n---\n# Work\n\n## Setup\n')
  async function rawHook(event: string, extra = {}) {
    const input = { session_id: 'scope', cwd: root, transcript_path: transcript, hook_event_name: event, tool_use_id: 'call', ...extra }
    const child = Bun.spawn(['bun', join(archive.plugin, 'runtime.js'), 'hook'], {
      cwd: root,
      env: { ...process.env, CODEX_HOME: home },
      stdin: new Blob([JSON.stringify(input)]),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [output, errors, code] = await Promise.all([new Response(child.stdout).json(), new Response(child.stderr).text(), child.exited])
    if (code) throw new Error(errors)
    return output
  }
  const hook = async (event: string, extra = {}) => String((await rawHook(event, extra)).hookSpecificOutput?.additionalContext ?? '')
  return { root, home, transcript, doc, hook, rawHook }
}

test('display commands preserve pending notes and only match a complete leading command', async () => {
  const { root, hook, rawHook } = await fixture()
  await hook('SessionStart')
  await appendFile(join(root, '.shift/OWNER.md'), '\nNew decision.')
  const submit = (prompt: string) => rawHook('UserPromptSubmit', { prompt })
  expect(await submit('//shift_sizes extra')).toEqual({ continue: false, stopReason: 'Usage: //shift_sizes' })
  expect((await submit('/shift-tasks')).continue).toBe(false)
  const next = await hook('UserPromptSubmit', { prompt: 'Please explain //unshift.' })
  expect(next).toContain('OWNER.md` changed outside')
  expect(next).not.toContain('No shifts in this project')
  expect(await submit('//shift_sizes/file')).toEqual({})
  expect(await submit('///shift')).toEqual({})
  expect(await submit('$shift:sizes extra')).toEqual({ continue: false, stopReason: 'Usage: $shift:sizes' })
  for (const prompt of ['$sizes', '$other:sizes', '$shift:sizes/file', 'Explain $shift:shift']) expect(await submit(prompt)).toEqual({})
  expect((await submit('$shift:unshift Review my work.')).hookSpecificOutput.additionalContext).toContain('No shifts in this project')
  expect((await submit('//unshift Review my work.')).hookSpecificOutput.additionalContext).toContain('No shifts in this project')
  await writeFile(join(root, '.shift/settings.toml'), 'enabled = false\n')
  expect(await submit('//shift')).toEqual({ continue: false, stopReason: 'Shift is disabled in this project.' })
})

test('installed hooks send targeted changes and actionable diagnostics once', async () => {
  const { root, doc, hook } = await fixture()
  const initial = await hook('SessionStart')
  expect(initial).toContain('Unrelated decision marker')
  expect(initial).toContain('no such folder')
  await mkdir(join(root, 'later'))
  expect(await hook('UserPromptSubmit')).toContain('no documents')
  expect(await hook('UserPromptSubmit')).toBe('')
  await hook('PreToolUse')
  await appendFile(doc, '\nNew paragraph.\n')
  await appendFile(join(root, 'details.txt'), ' Own update.')
  expect(await hook('PostToolUse')).toBe('')
  expect(await hook('UserPromptSubmit')).toContain('Setup (changed)')
  expect(await hook('UserPromptSubmit')).toBe('')
  await hook('PreToolUse')
  await appendFile(doc, '\n## Verify\nSee [missing](gone.md).\n')
  await writeFile(
    join(root, '.shift/OWNER.md'),
    '- Unrelated decision marker.\n  Permanent\n- A decision made during the tool.\n  Permanent\n',
  )
  expect(await hook('PostToolUse')).toBe('')
  const update = await hook('UserPromptSubmit')
  expect(update).toContain('Verify')
  expect(update).toContain('gone.md')
  expect(update).not.toContain('Unrelated decision marker')
  expect(await hook('UserPromptSubmit')).toBe('')
  await appendFile(join(root, 'details.txt'), ' External update.')
  expect(await hook('PreToolUse')).toContain('details.txt')
  expect(await hook('PostToolUse')).toBe('')
  await appendFile(join(root, '.shift/board.md'), '\nAdditional information.\n')
  expect(await hook('UserPromptSubmit')).toContain('board.md')
  expect(await hook('UserPromptSubmit')).toBe('')
  await appendFile(join(root, '.shift/settings.toml'), '\nunknown_key = true\n')
  expect((await hook('UserPromptSubmit')).match(/unknown key/g)).toHaveLength(1)
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('resume restores a missing delivery and history replaced while detached', async () => {
  const { transcript, hook } = await fixture()
  const resume = () => hook('SessionStart', { source: 'resume' })
  const marker = 'Unrelated decision marker'
  const first = await hook('SessionStart', { source: 'startup' })
  expect(first).toContain(marker)
  expect(await resume()).toContain(marker)
  const persist = (row: unknown) => appendFile(transcript, `${JSON.stringify(row)}\n`)
  await persist({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: first }] } })
  expect(await resume()).toBe('')
  await persist({ type: 'compacted', payload: { replacement_history: [] } })
  expect(await resume()).toContain(marker)
  expect(await hook('SessionStart', { source: 'clear' })).toContain(marker)
  expect(await hook('SessionStart', { source: 'resume', session_id: 'new-thread' })).toContain(marker)
})

test('an unrecorded letter survives resume and a display command; its recorded retry is acknowledged once', async () => {
  const { root, home, transcript, hook, rawHook } = await fixture()
  const id = archive.seed(root, LETTER, BOARD)
  await hook('SessionStart')
  const hash = createHash('sha256').update('scope').digest('hex')
  prepareHandover(join(home, 'plugins/data/shift-sessions', `session-${hash}.json`), root, id, 0)
  await appendFile(transcript, `${JSON.stringify({ type: 'compacted' })}\n`)
  await hook('SessionStart', { source: 'resume' })
  const first = await hook('UserPromptSubmit', { prompt: 'First turn', turn_id: 'first' })
  expect(first).toContain(LETTER.trim())
  // The host never persisted this first hook result.
  await hook('SessionStart', { source: 'resume' })
  expect((await rawHook('UserPromptSubmit', { prompt: '$shift:tasks' })).continue).toBe(false)
  const retried = await hook('UserPromptSubmit', { prompt: 'After restart', turn_id: 'second' })
  expect(retried).toContain(LETTER.trim())
  await appendFile(
    transcript,
    `${JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: retried }] } })}\n`,
  )
  await hook('SessionStart', { source: 'resume' })
  expect(await hook('UserPromptSubmit', { prompt: 'Next turn', turn_id: 'third' })).not.toContain(LETTER.trim())
})

test('an obsolete handover receipt cannot block later prompts or open its former folder', async () => {
  const { root, home, hook, rawHook } = await fixture()
  await hook('SessionStart')
  const dir = join(root, '.shift/shifts/20260101-000000')
  const letter = join(dir, 'letter.md')
  await mkdir(dir, { recursive: true })
  await writeFile(letter, 'Obsolete private letter.')
  for (const path of [dir, letter]) await utimes(path, 1, 2)
  const hash = createHash('sha256').update('scope').digest('hex')
  const db = new Database(join(home, 'plugins/data/shift-sessions', `session-${hash}.json.sqlite`))
  try {
    db.exec('CREATE TABLE IF NOT EXISTS handover (root TEXT PRIMARY KEY, dir TEXT NOT NULL, offset INTEGER, phase TEXT NOT NULL)')
    db.query("INSERT OR REPLACE INTO handover VALUES (?, ?, 0, 'ready')").run(root, dir)
  } finally {
    db.close()
  }
  for (const prompt of ['First prompt.', 'Second prompt.']) {
    expect(await rawHook('UserPromptSubmit', { prompt })).toEqual({})
  }
  expect((await stat(letter)).atimeMs).toBe(1000)
  expect((await stat(dir)).atimeMs).toBe(1000)
})

test('parallel installed hooks claim a threshold once', async () => {
  const { transcript, hook } = await fixture()
  async function usage(tokens: number) {
    const info = { model_context_window: 258400, last_token_usage: { total_tokens: tokens } }
    await appendFile(transcript, `${JSON.stringify({ payload: { type: 'token_count', info } })}\n`)
  }
  await usage(60000)
  await hook('SessionStart')
  await usage(205632)
  const outputs = await Promise.all(Array.from({ length: 12 }, () => hook('PostToolUse')))
  expect(outputs.filter(t => t.includes('Shift hint:'))).toHaveLength(1)
})

test('a resumed profile migrates the last reading without replaying a claimed reminder', async () => {
  const { hook, root, home, transcript } = await fixture()
  const dir = join(home, 'plugins/data/shift-sessions')
  await mkdir(dir, { recursive: true })
  const binding = join(dir, `session-${createHash('sha256').update('scope').digest('hex')}.json`)
  const record = (tokens: number) =>
    `${JSON.stringify({ payload: { type: 'token_count', info: { model_context_window: 258400, last_token_usage: { total_tokens: tokens } } } })}\n`
  const first = record(60000) + record(184800)
  await writeFile(transcript, first)
  await writeFile(binding, JSON.stringify({ root, hash: 'legacy' }))
  await writeFile(
    `${binding}.usage`,
    JSON.stringify({
      gauge: { base: 60000, hinted: 184800, growth: {}, whole: false, unassisted: false },
      reading: { tokens: 184800, window: 258400 },
      offset: Buffer.byteLength(first),
    }),
  )
  expect(await hook('SessionStart', { source: 'resume' })).not.toContain('Shift hint:')
  await appendFile(transcript, record(210000))
  expect(await hook('PostToolUse')).toBe('')
  expect(await hook('SessionStart', { source: 'compact' })).toContain('Unrelated decision marker')
  await appendFile(transcript, record(50000) + record(205632))
  expect(await hook('PostToolUse')).toContain('Shift hint:')
  expect(await hook('PostToolUse')).toBe('')
})

test('steering while a tool writes leaves its records and unfinished links for that tool', async () => {
  const { hook, doc, root } = await fixture()
  const turn = { turn_id: 'first' }
  await hook('SessionStart')
  await hook('UserPromptSubmit', turn)
  await hook('PreToolUse', turn)
  await appendFile(join(root, '.shift/board.md'), '\nA valid edit.\n')
  await appendFile(doc, '\nSee [related](related.md).\n')
  expect(await hook('UserPromptSubmit', turn)).toBe('')
  await writeFile(join(root, 'docs/related.md'), '---\ndescription: Related material\n---\n# Related\n')
  expect(await hook('PostToolUse', turn)).toBe('')
  const settled = await hook('UserPromptSubmit', { turn_id: 'next' })
  expect(settled).toContain('Related material')
  expect(settled).not.toContain('that is not there')
  expect(settled).not.toContain('outside your tools')
})

async function recordPatch(transcript: string, path: string, unified_diff: string) {
  await appendFile(
    transcript,
    `${JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        thread_id: 'scope',
        item: {
          type: 'FileChange',
          status: 'completed',
          changes: { [path]: { type: 'update', unified_diff } },
        },
      },
    })}\n`,
  )
}

test('a completed nested patch is recognized while another edit in the same interval is reported', async () => {
  const { root, transcript, hook } = await fixture()
  await hook('SessionStart')
  const path = join(root, '.shift/OWNER.md')
  await writeFile(path, 'Changed by nested patch.\n')
  await recordPatch(transcript, path, '@@ -1 +1 @@\n-Unrelated decision marker.\n\\ No newline at end of file\n+Changed by nested patch.\n')
  await appendFile(join(root, '.shift/board.md'), '\nExternal decision.\n')
  const note = await hook('PreToolUse')
  expect(note).toContain('board.md` changed outside')
  expect(note).not.toContain('OWNER.md` changed outside')
  await hook('PostToolUse')
  await appendFile(path, 'External update.\n')
  expect(await hook('UserPromptSubmit')).toContain('OWNER.md` changed outside')
  const guide = { tool_name: 'mcp__shift__shift_guide' }
  await hook('PreToolUse', guide)
  await appendFile(path, 'Another external update.\n')
  expect(await hook('PostToolUse', guide)).toContain('OWNER.md` changed outside')
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('a completed patch cannot claim another writer’s change elsewhere in the same file', async () => {
  const { root, transcript, hook } = await fixture()
  const path = join(root, '.shift/OWNER.md')
  await writeFile(path, 'Original decision.\nAnother decision.\n')
  await hook('SessionStart')
  await hook('PreToolUse')
  await writeFile(path, 'Patched decision.\nExternal decision.\n')
  await recordPatch(transcript, path, '@@ -1 +1 @@\n-Original decision.\n+Patched decision.\n')
  expect(await hook('PostToolUse')).toContain('OWNER.md` changed outside')
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('edits in a separate task tracker do not add shift context', async () => {
  const { root, hook } = await fixture()
  await hook('SessionStart')
  const path = join(root, '.shift/tasks/example/notes')
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'old.md'), 'External task data')
  expect(await hook('PreToolUse')).toBe('')
  expect(await hook('PostToolUse')).toBe('')
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('a live map change reports only affected fields, and compact restores a complete current map', async () => {
  const { root, doc, hook } = await fixture()
  const original = '---\ndescription: Procedures\n---\n# Work\n\n## Untouched\n\n## Build\nOld body.\n\n## Remove\n'
  await writeFile(doc, original)
  await hook('SessionStart')
  const updated = original.replace('Old body.', 'Revised body.').replace('## Remove', '## Install')
  await writeFile(doc, updated)
  const extra = join(root, 'docs/more.md')
  await writeFile(extra, '---\ndescription: Reference material\n---\n# More\n\n## Check\n')
  const live = await hook('PreToolUse')
  for (const part of [
    'Build (changed)',
    'Remove (deleted)',
    'Install (new)',
    'docs/more.md` (new)',
    'Reference material',
    'sections: Check',
  ])
    expect(live).toContain(part)
  for (const part of ['Untouched', 'Procedures', 'Revised body.', 'Unrelated decision marker']) expect(live).not.toContain(part)
  await hook('PostToolUse')
  expect(await hook('UserPromptSubmit')).not.toContain('Build (changed)')
  expect(await hook('UserPromptSubmit')).toBe('')
  await unlink(extra)
  await writeFile(doc, updated.replace('Procedures', 'Build manual').replace('Revised body.', '> [!IMPORTANT]\n> Use the lockfile.'))
  const fields = await hook('UserPromptSubmit')
  for (const part of ['description (changed): Build manual', 'pinned (Build) (new)', 'Use the lockfile.', 'docs/more.md` (deleted)'])
    expect(fields).toContain(part)
  for (const part of ['Untouched', 'Reference material', 'Install (new)']) expect(fields).not.toContain(part)
  expect(await hook('UserPromptSubmit')).toBe('')
  const complete = await hook('SessionStart', { source: 'compact' })
  expect(complete.split('sections: Untouched · Build · Install')).toHaveLength(2)
  expect(complete).toContain('Unrelated decision marker')
  expect(complete).not.toContain('(changed)')
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('only a matching file receipt suppresses a map delta across tool hooks', async () => {
  const { doc, transcript, hook } = await fixture()
  await appendFile(doc, 'Initial.\n\n## Second\nOriginal second.\n')
  await hook('SessionStart')
  await hook('PreToolUse')
  const before = await readFile(doc, 'utf8')
  await writeFile(doc, before.replace('Initial.', 'Mine.'))
  await recordPatch(transcript, doc, '@@ -1 +1 @@\n-Initial.\n+Mine.\n')
  await hook('PostToolUse')
  expect(await hook('PreToolUse')).toBe('')
  await hook('PostToolUse')
  expect(await hook('UserPromptSubmit')).toBe('')
  await writeFile(doc, before.replace('Initial.', 'Mixed.').replace('Original second.', 'Someone else.'))
  await recordPatch(transcript, doc, '@@ -1 +1 @@\n-Mine.\n+Mixed.\n')
  expect(await hook('UserPromptSubmit')).toContain('Second (changed)')
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('a legacy entry-only checkpoint upgrades without repeating the session map', async () => {
  const { doc, home, hook } = await fixture()
  await hook('SessionStart')
  const db = new Database(
    join(home, 'plugins/data/shift-sessions', `session-${createHash('sha256').update('scope').digest('hex')}.json.sqlite`),
  )
  try {
    const row = db.query<{ state: string }, []>('SELECT state FROM checkpoint').get()
    if (!row) throw new Error('Missing checkpoint')
    const state = JSON.parse(row.state)
    delete state.map.documents
    delete state.mapOffset
    db.query('UPDATE checkpoint SET state = ?').run(JSON.stringify(state))
  } finally {
    db.close()
  }
  await appendFile(doc, '\nDetached edit.\n')
  const migrated = await hook('UserPromptSubmit')
  expect(migrated).toContain('docs/example.md` (changed)')
  expect(migrated).not.toContain('sections:')
  expect(migrated).not.toContain('Unrelated decision marker')
  await appendFile(doc, '\nSecond edit.\n')
  expect(await hook('UserPromptSubmit')).toContain('Setup (changed)')
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('archived body changes stay compact and removing a pin leaves its sibling out', async () => {
  const { doc, hook } = await fixture()
  const header = '---\ndescription: Old design\narchived: true\n---\n# Design\n\n## Original proposal\n'
  const first = '\n> [!IMPORTANT]\n> First caveat.\n'
  const second = '\n> [!IMPORTANT]\n> Second caveat.\n'
  await writeFile(doc, header + first + second)
  await hook('SessionStart')
  await writeFile(doc, header + second)
  const change = await hook('PreToolUse')
  expect(change).toContain('pinned (Original proposal) (deleted)')
  expect(change).not.toContain('Second caveat.')
  expect(change).not.toContain('sections:')
  await hook('PostToolUse')
  await appendFile(doc, '\nExtra detail.\n')
  const body = await hook('UserPromptSubmit')
  expect(body).toContain('Text (changed)')
  expect(body).not.toContain('Original proposal')
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('a shell write advances the baseline silently and later external edits in that file survive resume', async () => {
  const { doc, hook, transcript } = await fixture()
  const shell = { tool_name: 'Bash', tool_use_id: 'shell-1', turn_id: 't' }
  const initial = await hook('SessionStart')
  await appendFile(
    transcript,
    `${JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: initial }] } })}\n`,
  )
  await appendFile(doc, 'Edited before the command.\n')
  expect(await hook('PreToolUse', shell)).toContain('Setup (changed)')
  await appendFile(doc, '\n## From script\nOwn text.\n')
  expect(await hook('PostToolUse', shell)).toBe('')
  const prompt = await hook('UserPromptSubmit')
  expect(prompt).not.toContain('From script')
  expect(await hook('SessionStart', { source: 'resume' })).toBe('')
  await appendFile(doc, '\nExternal text.\n')
  const resumed = await hook('SessionStart', { source: 'resume' })
  expect(resumed).toContain('From script (changed)')
  expect(resumed).not.toContain('Setup')
  expect(await hook('UserPromptSubmit')).toBe('')
})

test('edits during a read-only command or a completion without a matching start stay visible', async () => {
  const { hook, doc, transcript } = await fixture()
  const shell = { tool_name: 'Bash', tool_use_id: 'read' }
  await hook('SessionStart')
  await hook('PreToolUse', shell)
  await appendFile(doc, 'External text.\n')
  const item = { type: 'CommandExecution', id: 'read', parsed_cmd: [{ type: 'read' }] }
  await appendFile(transcript, `${JSON.stringify({ type: 'event_msg', payload: { thread_id: 'scope', type: 'item_completed', item } })}\n`)
  expect(await hook('PostToolUse', shell)).toContain('Setup (changed)')
  expect(await hook('UserPromptSubmit')).toBe('')
  await appendFile(doc, 'More external text.\n')
  await hook('PostToolUse', shell)
  expect(await hook('UserPromptSubmit')).toContain('Setup (changed)')
})

test('two threads sharing a document notify each other and silently accept their own edits', async () => {
  const { doc, hook } = await fixture()
  const first = (event: string, extra = {}) => hook(event, { session_id: 'editor-a', ...extra })
  const other = (event: string, extra = {}) => hook(event, { session_id: 'editor-b', ...extra })
  const shell = { tool_name: 'Bash', tool_use_id: 'edit' }
  expect(await first('SessionStart')).toContain('sections: Setup')
  expect(await other('SessionStart')).toContain('sections: Setup')
  await first('PreToolUse', shell)
  await appendFile(doc, 'Added by the first thread.\n')
  expect(await first('PostToolUse', shell)).toBe('')
  expect(await first('UserPromptSubmit')).toBe('')
  expect(await other('PreToolUse', shell)).toContain('Setup (changed)')
  await appendFile(doc, 'Added by the other thread.\n')
  expect(await other('PostToolUse', shell)).toBe('')
  expect(await other('UserPromptSubmit')).toBe('')
  expect(await first('UserPromptSubmit')).toContain('Setup (changed)')
  expect(await first('UserPromptSubmit')).toBe('')
  expect(await other('SessionStart', { source: 'compact' })).toContain('sections: Setup')
  expect(await first('UserPromptSubmit')).toBe('')
})

for (const prompt of ['Continue working', '$shift:unshift']) {
  test(`archive-only wait survives a lost hook result and another chat's rotation: ${prompt}`, async () => {
    const { root, hook, transcript } = await fixture()
    await writeFile(join(root, '.shift/settings.toml'), 'history_limit = 1\n')
    const save = (session: string) => {
      const about = '---\ndescription: Saved fixture\nresult: shifted\nafter: wait\n---'
      const id = archive.query<string>(root, {
        action: 'begin',
        key: session,
        about,
        files: { 'board.md': BOARD, 'letter.md': LETTER + session },
      })
      archive.query(root, { action: 'finish', session, id, about, state: 'complete', wait: session === 'scope', limit: 1 })
      return id
    }
    const id = save('scope')
    const waiting = () => archive.query(root, { action: 'waiting', session: 'scope' })
    await hook('SessionStart')
    expect(await hook('UserPromptSubmit', { prompt, turn_id: 'one' })).toContain(LETTER.trim())
    expect(waiting()).toBe(id)
    save('other')
    const retried = await hook('UserPromptSubmit', { prompt: 'Retry', turn_id: 'two' })
    expect(retried).toContain(LETTER.trim())
    await appendFile(
      transcript,
      `${JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: retried }] } })}\n`,
    )
    expect(await hook('UserPromptSubmit', { prompt: 'Again', turn_id: 'three' })).not.toContain(LETTER.trim())
    expect(waiting()).toBe('')
  })
}

test('one MCP connection follows the hook project for import, edit and knowledge repair', async () => {
  const { root, home, hook } = await fixture()
  const other = await scratch('rebound-project')
  const name = 'knowledge/glossary.md'
  const loose = join(other, '.shift', name)
  await mkdir(join(other, '.shift/knowledge'), { recursive: true })
  await writeFile(join(other, '.shift/board.md'), BOARD)
  await writeFile(join(other, '.shift/OWNER.md'), '- Existing owner rule.')
  await writeFile(loose, '---\nkind: glossary\n---')
  await hook('SessionStart')
  const child = spawn('bun', [join(archive.plugin, 'runtime.js'), 'mcp'], {
    env: { ...process.env, CODEX_HOME: home },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  let id = 0
  const call = async (args: Record<string, string>) => {
    const params = { name: 'shift_record', arguments: args, _meta: { threadId: 'scope' } }
    child.stdin.write(`${JSON.stringify({ id: ++id, method: 'tools/call', params })}\n`)
    const line = await replies.next()
    if (line.done) throw new Error('MCP closed before replying')
    const reply = JSON.parse(line.value)
    return String(reply.result.content[0].text)
  }
  try {
    expect(await call({ action: 'import' })).toContain('Imported')
    await hook('SessionStart', { cwd: other })
    expect(await call({ action: 'import' })).toContain('is a glossary')
    const list = () => archive.query<Record<string, { revision: string; text: string }>>(other, { action: 'working-list' })
    expect(list()['board.md']).toBeUndefined()
    archive.query(other, { action: 'working-write', changes: { [name]: { revision: '', text: 'obsolete' } } })
    const revision = list()[name]?.revision
    if (!revision) throw new Error('Missing imported revision')
    expect(await call({ action: 'delete', name, revision })).toContain('loose source')
    await unlink(loose)
    expect(await call({ action: 'delete', name, revision: 'outdated' })).toContain('changed')
    expect(await call({ action: 'delete', name, revision })).toContain('Deleted')
    expect(await call({ action: 'import' })).toContain('Imported')
    expect(list()[name]).toBeUndefined()
    const board = list()['board.md']
    if (!board) throw new Error('Missing imported board')
    expect(
      await call({ action: 'replace', name: 'board.md', revision: board.revision, find: BOARD, replacement: `${BOARD}\nProject B focus.` }),
    ).toContain('Project B focus')
    expect(list()['board.md']?.text).toContain('Project B focus')
    await hook('SessionStart', { cwd: root })
    expect(await call({ action: 'read', name: 'board.md' })).not.toContain('Project B focus')
  } finally {
    child.stdin.end()
    child.kill()
  }
})

test('a queued transition belongs to its project across a root switch with matching archive IDs', async () => {
  const { root, home, hook, rawHook } = await fixture()
  const other = await fixture()
  const id = archive.seed(root, LETTER, BOARD)
  expect(archive.seed(other.root, `${LETTER}second project`, BOARD)).toBe(id)
  await hook('SessionStart')
  const file = join(home, 'plugins/data/shift-sessions', `session-${createHash('sha256').update('scope').digest('hex')}.json`)
  for (const cwd of [root, other.root]) {
    prepareHandover(file, cwd, id, 0)
    await hook('SessionStart', { cwd, source: 'compact' })
  }
  const prompt = wakeInput(id, root)
  expect((await rawHook('UserPromptSubmit', { cwd: other.root, prompt })).continue).toBe(false)
  expect(await hook('UserPromptSubmit', { cwd: root, prompt })).toContain(LETTER.trim())
  expect(await hook('UserPromptSubmit', { cwd: other.root, prompt: 'Resume here' })).toContain('second project')
})

test.each([
  [1, 9],
  [2, 18],
  [3, 0],
])('restore %i full letters and %i descriptions after rotation', async (full, brief) => {
  const { root, hook } = await fixture()
  const window = full + brief
  await writeFile(join(root, '.shift/settings.toml'), `[history]\nfull = ${full}\nbrief = ${brief}\n`)
  const ids: string[] = []
  for (let i = 1; i <= window + 1; i++) {
    const about = `---\ndescription: Result ${i}.\nresult: shifted\nafter: wait\n---`
    const files = { 'board.md': BOARD, 'letter.md': `${LETTER}\nFull detail ${i}.` }
    const id = archive.query<string>(root, { action: 'begin', key: String(i), about, files })
    archive.query(root, {
      action: 'finish',
      session: 'scope',
      id,
      state: 'complete',
      wait: true,
      about,
      limit: window,
    })
    ids.push(id)
  }
  const restored = await hook('UserPromptSubmit', { prompt: '$shift:unshift' })
  const rows = [...(restored.match(/^- s-[a-f0-9]+ · .*$/gm) ?? [])]
  expect(rows).toEqual(ids.slice(1, brief + 1).map((id, i) => `- ${id} · Result ${i + 2}.`))
  expect([...(restored.match(/Full detail \d+\./g) ?? [])]).toEqual(Array.from({ length: full }, (_, i) => `Full detail ${brief + 2 + i}.`))
  expect(archive.query<{ id: string }[]>(root, { action: 'list' }).map(e => e.id)).toEqual(ids.slice(1))
  for (const [i, id] of ids.slice(1).entries()) {
    expect(archive.query<{ files: Record<string, string> }>(root, { action: 'read', id, file: 'letter.md' }).files['letter.md']).toContain(
      `Full detail ${i + 2}.`,
    )
  }
})

test('subagent hooks cannot restore the main letter or initiate a shift', async () => {
  const { rawHook, root } = await fixture()
  archive.seed(root, LETTER, BOARD)
  expect(await rawHook('UserPromptSubmit', { agent_id: 'child', prompt: '$shift:unshift' })).toEqual({})
  for (const actor of [{}, { agent_id: 'child' }]) {
    for (const event of ['PreToolUse', 'PostToolUse']) {
      const output = await rawHook(event, { ...actor, tool_name: 'mcp__other__shift' })
      expect(output.continue).not.toBe(false)
      expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined()
    }
  }
  expect((await rawHook('PreToolUse', { agent_id: 'child', tool_name: 'mcp__shift__shift' })).hookSpecificOutput.permissionDecision).toBe(
    'deny',
  )
})

test('a former public map seeds internal rules once and receives no further writes', async () => {
  const { root, hook } = await fixture()
  const path = join(root, 'docs', 'old-map.md')
  const source = '# Rules\nKeep private knowledge local.\n'
  await writeFile(path, source)
  await writeFile(join(root, '.shift/settings.toml'), '[files]\nshift = "docs/old-map.md"\n[docs]\ndirs = ["docs"]\ntoc = true\n')
  const first = await hook('SessionStart')
  expect(first).toContain('<file path=".shift/SHIFT.md">')
  const current = () => archive.query<Record<string, { text: string }>>(root, { action: 'working-list' })['SHIFT.md']?.text
  expect(current()).toContain('Keep private knowledge local.')
  expect(current()).toContain('A fixture')
  expect(await readFile(path, 'utf8')).toBe(source)
  await writeFile(path, 'Stale external rule.')
  await hook('SessionStart')
  expect(current()).toContain('Keep private knowledge local.')
  expect(await Bun.file(join(root, '.shift/SHIFT.md')).exists()).toBe(false)
})

test('disabled startup reports a failed migration and subsequent hooks keep the project off', async () => {
  const { root, rawHook } = await fixture()
  const settings = 'enabled = false\nretired = true\n[files]\nshift = "docs"'
  await writeFile(join(root, '.shift/settings.toml'), settings)
  const start = await rawHook('SessionStart')
  expect(start.systemMessage).toContain('Cannot read the former map')
  expect(start.hookSpecificOutput).toBeUndefined()
  expect(await rawHook('UserPromptSubmit', { prompt: '$shift:unshift' })).toEqual({
    continue: false,
    stopReason: 'Shift is disabled in this project.',
  })
  expect(await rawHook('PreToolUse', { tool_name: 'mcp__other__lookup' })).toEqual({})
})

test.each(['current', 'unversioned'])('private writes wait for a working Git exclusion with %s settings', async schema => {
  const { root, hook, rawHook } = await fixture()
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git('init', '-q', '--template=')
  git('config', 'core.excludesFile', join(root, '.git/empty-excludes'))
  const input = '[tasks]\nprepare = "on_start"\n[docs]\ndirs = ["docs", "later"]\n'
  const canonical = settingsDocument(input, true)
  if (typeof canonical === 'string') throw new Error(canonical)
  const source = schema === 'current' ? canonical.next : input
  const settings = join(root, '.shift/settings.toml')
  const db = join(root, '.shift/history.db')
  const launcher = join(root, '.shift/bin', process.platform === 'win32' ? 'shift-task.exe' : 'shift-task')
  await writeFile(settings, source)
  await writeFile(join(root, '.gitignore'), '!.shift/\n')
  expect(await hook('SessionStart')).toContain('overriding rules')
  expect(await Bun.file(db).exists()).toBe(false)
  expect(await Bun.file(launcher).exists()).toBe(false)
  await mkdir(join(root, 'later'))
  await hook('UserPromptSubmit', { prompt: 'Continue.' })
  expect((await rawHook('UserPromptSubmit', { prompt: '$shift:tasks' })).stopReason).toContain('overriding rules')
  expect(await Bun.file(db).exists()).toBe(false)
  expect(await Bun.file(launcher).exists()).toBe(false)
  expect(await readFile(settings, 'utf8')).toBe(source)
  await unlink(join(root, '.gitignore'))
  expect(await hook('SessionStart')).toContain('docs/example.md')
  expect(await Bun.file(db).exists()).toBe(true)
  expect(await Bun.file(launcher).exists()).toBe(true)
  expect(git('check-ignore', '.shift/history.db').trim()).toBe('.shift/history.db')
})

test('an unreadable Git configuration defers private migration until Git can verify its exclusion', async () => {
  const { root, hook } = await fixture()
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git('init', '-q', '--template=')
  git('config', 'core.excludesFile', join(root, '.git/empty-excludes'))
  const config = join(root, '.git/config')
  const original = await readFile(config, 'utf8')
  const settings = join(root, '.shift/settings.toml')
  const source = '[files]\nshift = "docs/example.md"'
  await writeFile(settings, source)
  await writeFile(config, '[core\n')
  expect(await hook('SessionStart')).toContain('could not be excluded')
  expect(await readFile(settings, 'utf8')).toBe(source)
  expect(await Bun.file(join(root, '.shift/history.db')).exists()).toBe(false)
  await writeFile(config, original)
  expect(await hook('SessionStart')).toContain('A fixture')
  expect(await Bun.file(join(root, '.shift/history.db')).exists()).toBe(true)
  expect(git('check-ignore', '.shift/history.db').trim()).toBe('.shift/history.db')
})

test('a disabled private migration protects the database before writing and repairs an old missing exclusion', async () => {
  const { root, rawHook } = await fixture()
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git('init', '-q', '--template=')
  git('config', 'core.excludesFile', join(root, '.git/empty-excludes'))
  const settingsPath = join(root, '.shift/settings.toml')
  const source = 'enabled = false\n[files]\nshift = "docs/example.md"'
  await writeFile(settingsPath, source)
  const exclude = join(root, '.git/info/exclude')
  await mkdir(exclude, { recursive: true })
  expect((await rawHook('SessionStart')).systemMessage).toBeTruthy()
  expect(await readFile(settingsPath, 'utf8')).toBe(source)
  expect(await Bun.file(join(root, '.shift/history.db')).exists()).toBe(false)
  await rmdir(exclude)
  await writeFile(join(root, '.gitignore'), '!.shift/\n')
  for (let attempt = 0; attempt < 2; attempt++) {
    expect((await rawHook('SessionStart')).systemMessage).toContain('overriding rules')
    expect(await readFile(settingsPath, 'utf8')).toBe(source)
    expect(await Bun.file(join(root, '.shift/history.db')).exists()).toBe(false)
    expect(await readFile(exclude, 'utf8')).toBe('.shift/\n')
  }
  await unlink(join(root, '.gitignore'))
  expect(await rawHook('SessionStart')).toEqual({})
  expect(await Bun.file(join(root, '.shift/history.db')).exists()).toBe(true)
  expect(git('check-ignore', '.shift/history.db').trim()).toBe('.shift/history.db')
  await unlink(exclude)
  expect(await rawHook('SessionStart')).toEqual({})
  expect(git('check-ignore', '.shift/history.db').trim()).toBe('.shift/history.db')
})

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'startup retries an inaccessible map source after access returns',
  async () => {
    const { root, rawHook } = await fixture()
    const settings = join(root, '.shift/settings.toml')
    const source = 'enabled = false\n[files]\nshift = "docs/example.md"'
    await writeFile(settings, source)
    await chmod(join(root, 'docs'), 0)
    try {
      expect((await rawHook('SessionStart')).systemMessage).toContain('EACCES')
      expect(await readFile(settings, 'utf8')).toBe(source)
    } finally {
      await chmod(join(root, 'docs'), 0o700)
    }
    expect(await rawHook('SessionStart')).toEqual({})
    expect(await readFile(settings, 'utf8')).toContain('schema_version = 2')
    const records = archive.query<Record<string, { text: string }>>(root, { action: 'working-list', session: '' })
    expect(records['SHIFT.md']?.text).toBe(await readFile(join(root, 'docs/example.md'), 'utf8'))
  },
)

test('a broken Shift checkpoint leaves another plugin in control of its tool', async () => {
  const { home, rawHook } = await fixture()
  await mkdir(join(home, 'plugins', 'data'), { recursive: true })
  await writeFile(join(home, 'plugins', 'data', 'shift-sessions'), 'not a directory')
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const result = await rawHook(event, { tool_name: 'mcp__other__shift' })
    expect(result).toEqual({ systemMessage: expect.stringContaining('Shift could not check its records') })
  }
})
