import { afterAll, expect, test } from 'bun:test'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanup, scratch } from '../../npm/test/scratch'
import { freshSample, sample, status } from '../gauge'

afterAll(cleanup)

test('transcript reminders and status follow the usable window when it changes', async () => {
  const root = await scratch('codex-hints')
  const usage = freshSample()
  const transcript = join(root, 'transcript')
  async function report(window: number, tokens: number, softHints = true) {
    const info = { model_context_window: window, last_token_usage: { total_tokens: tokens } }
    await appendFile(transcript, `${JSON.stringify({ payload: { type: 'token_count', info } })}\n`)
    return sample(usage, transcript, false, softHints)
  }

  expect(await report(475_000, 20_000)).toBeNull()
  expect(status(usage)).toContain('next soft hint at 300K; final at 410K')
  expect(await report(475_000, 299_999)).toBeNull()
  expect(await report(475_000, 300_000)).toContain('grown by 280K')
  expect(await report(475_000, 409_999)).toBeNull()
  expect(await report(475_000, 410_000)).toContain('Shift now')
  expect(await report(258_400, 184_799)).toBeNull()
  expect(status(usage)).toContain('no soft hint')
  expect(await report(258_400, 184_800)).toBeNull()
  expect(await report(258_400, 205_631)).toBeNull()
  expect(await report(258_400, 205_632)).toContain('Shift now')
  expect(await report(258_400, 208_000)).toBeNull()
  expect(await report(1_000_000, 210_000)).toBeNull()
  expect(status(usage)).toContain('final at 840K')
  expect(status(usage, false)).toContain('no soft hint before the final')
  expect(await report(1_000_000, 600_000, false)).toBeNull()
  expect(await report(1_000_000, 840_000, false)).toContain('Shift now')
})
