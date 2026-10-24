import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { PendingShift } from '../types'
import {
  compactInstructions,
  continuePrompt,
  DIR,
  deliveredFiles,
  formatK,
  MAX_AUTO_STREAK,
  renderAbout,
  renderSummary,
  waitContext,
} from './core/index'
import { readWork, recentShifts } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const autoStreak = atom({ plugin: 'infinity-shift', key: 'autoStreak' } as const, 0)
const pending = atom({ plugin: 'infinity-shift', key: 'pending' } as const, null)
const waitNote = atom({ plugin: 'infinity-shift', key: 'waitNote' } as const, null)

export async function handOver($: EngineInterface): Promise<void> {
  const shift: PendingShift | null = await read($, pending)
  if (shift === null) return
  await update($, pending, () => null)

  const tokensBefore = (await $.session.usage()).context.tokens
  const name = shift.dir.split('/').at(-1) ?? shift.dir
  const outcome = (result: string, after?: number, summaryChars?: number, before = tokensBefore) =>
    $.fs.write(`${shift.dir}/about.md`, renderAbout({ ...shift, tokensBefore: before, tokensAfter: after, summaryChars, result }))

  const done = await $.session
    .compact({ instructions: compactInstructions(shift.hold, shift.board, `${shift.dir}/letter.md`) })
    .catch((error: unknown) => ({ skip: `compaction failed: ${String(error)}`, messages: undefined }))
  if (done.messages === undefined) {
    await outcome(`not shifted: ${done.skip}`)
    $.ui.log(`shift ${name} not made — ${done.skip}`)
    return
  }

  const summary = renderSummary(done.messages)
  await $.fs.write(`${shift.dir}/summary.md`, summary)
  const after = (await $.session.usage()).context.tokens ?? done.tokensAfter ?? 0
  const streak: number = (await read($, autoStreak)) + 1
  const isCapped = shift.after === 'continue' && streak > MAX_AUTO_STREAK
  const before = done.tokensBefore ?? tokensBefore
  const shrank = `${formatK(before ?? 0)} → ${formatK(after)}`
  const root = await $.session.root()
  const work = await readWork($, `${root}/${DIR}`)
  const recent = await recentShifts($, root)

  if (shift.after === 'continue' && !isCapped) {
    await update($, autoStreak, () => streak)
    await outcome(`shifted (${shrank}), continuing`, after, summary.length, before)
    $.ui.log(`shift ${name} done (${shrank}), continuing from the letter — ${shift.dir}/letter.md`)
    await $.prompt.submit({ text: continuePrompt(shift.letter, work, recent, shift.dir) })
    return
  }

  await update($, waitNote, () => ({
    context: waitContext(shift.letter, work, recent, shift.dir),
    dir: shift.dir,
    files: deliveredFiles(work),
  }))
  const why = isCapped ? `waiting: ${MAX_AUTO_STREAK} shifts in a row without the owner` : 'waiting for the owner'
  await outcome(`shifted (${shrank}), ${why}`, after, summary.length, before)
  const capped = isCapped ? `, ${MAX_AUTO_STREAK} in a row without you` : ''
  $.ui.log(`shift ${name} done (${shrank})${capped} — waiting for you, the letter goes with your next message`)
}
