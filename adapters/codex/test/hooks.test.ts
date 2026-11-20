import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BOARD } from '../../../core/test/data'
import { cleanup, scratch } from '../../npm/test/scratch'

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
    const child = Bun.spawn(['bun', resolve(import.meta.dir, '../plugin/runtime.js'), 'hook'], {
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
  expect(await hook('UserPromptSubmit')).toBe('')
  await hook('PreToolUse')
  await appendFile(doc, '\n## Verify\nSee [missing](gone.md).\n')
  await appendFile(join(root, '.shift/OWNER.md'), '\nA decision made during the tool.\n')
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

test('parallel installed hooks claim a threshold once', async () => {
  const { transcript, hook } = await fixture()
  async function usage(tokens: number) {
    const info = { model_context_window: 258400, last_token_usage: { total_tokens: tokens } }
    await appendFile(transcript, `${JSON.stringify({ payload: { type: 'token_count', info } })}\n`)
  }
  await usage(60000)
  await hook('SessionStart')
  await usage(184800)
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
  const first = record(60000) + record(208000)
  await writeFile(transcript, first)
  await writeFile(binding, JSON.stringify({ root, hash: 'legacy' }))
  await writeFile(
    `${binding}.usage`,
    JSON.stringify({
      gauge: { base: 60000, hinted: 208000, growth: {}, whole: false, unassisted: false },
      reading: { tokens: 208000, window: 258400 },
      offset: Buffer.byteLength(first),
    }),
  )
  expect(await hook('SessionStart', { source: 'resume' })).not.toContain('Shift hint:')
  await appendFile(transcript, record(210000))
  expect(await hook('PostToolUse')).toBe('')
  expect(await hook('SessionStart', { source: 'compact' })).toContain('Unrelated decision marker')
  await appendFile(transcript, record(50000) + record(184800))
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

test('the two sides of an agent note link settle at the next prompt', async () => {
  const { root, hook } = await fixture()
  const folder = join(root, '.shift/tasks/example')
  await mkdir(join(folder, 'notes'), { recursive: true })
  await writeFile(
    join(folder, 'task.md'),
    `# Work\n\n${['Goal', 'Done when', 'Owner decisions', 'Decisions', 'Dead ends'].map(h => `## ${h}\n\nnone\n`).join('\n')}`,
  )
  const track = join(folder, 'track.md')
  await writeFile(track, '- [open] #1 research\n')
  await hook('SessionStart')
  await hook('PreToolUse')
  await writeFile(track, '- [open] #1 research — see [details](notes/details.md)\n')
  expect(await hook('PostToolUse')).toBe('')
  await hook('PreToolUse')
  await writeFile(join(folder, 'notes/details.md'), '---\ndescription: Details\n---\n')
  expect(await hook('PostToolUse')).toBe('')
  expect(await hook('UserPromptSubmit')).toBe('')
  await hook('PreToolUse')
  await appendFile(track, '- [open] #2 another — see [missing](notes/missing.md)\n')
  expect(await hook('PostToolUse')).toBe('')
  await appendFile(track, '- [open] #3 added elsewhere\n')
  const changed = await hook('PreToolUse')
  expect(changed).toContain('track.md` changed outside')
  expect(changed).not.toContain('notes/missing.md')
  expect(await hook('PostToolUse')).toBe('')
  expect((await hook('UserPromptSubmit')).match(/notes\/missing\.md/g)).toHaveLength(1)
  expect(await hook('UserPromptSubmit')).toBe('')
})
