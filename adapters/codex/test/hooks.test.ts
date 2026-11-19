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
  async function hook(event: string, extra = {}) {
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
    return String(output.hookSpecificOutput?.additionalContext ?? '')
  }
  return { root, home, transcript, doc, hook }
}

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
