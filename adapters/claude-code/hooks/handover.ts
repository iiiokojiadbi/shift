import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { PendingShift } from '../types'
import { compactInstructions, settleShift, shiftNotMade } from './core/index'
import { claudeStore } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const autoStreak = atom({ plugin: 'infinity-shift', key: 'autoStreak' } as const, 0)
const pending = atom({ plugin: 'infinity-shift', key: 'pending' } as const, null)
const waitNote = atom({ plugin: 'infinity-shift', key: 'waitNote' } as const, null)

export async function handOver($: EngineInterface): Promise<void> {
  const shift: PendingShift | null = await read($, pending)
  if (shift === null) return
  await update($, pending, () => null)

  const store = claudeStore($)
  const tokensBefore = (await $.session.usage()).context.tokens
  const done = await $.session
    .compact({ instructions: compactInstructions(shift.hold, shift.board, `${shift.dir}/letter.md`) })
    .catch((error: unknown) => ({ skip: `compaction failed: ${String(error)}`, messages: undefined }))
  if (done.messages === undefined) {
    $.ui.log(await shiftNotMade(store, shift, done.skip, tokensBefore))
    return
  }

  const settled = await settleShift(store, {
    root: await $.session.root(),
    shift,
    messages: done.messages,
    before: done.tokensBefore ?? tokensBefore,
    after: (await $.session.usage()).context.tokens ?? done.tokensAfter ?? 0,
    streak: await read($, autoStreak),
  })
  if (settled.after === 'continue') {
    await update($, autoStreak, () => settled.streak)
    $.ui.log(settled.row)
    await $.prompt.submit({ text: settled.prompt })
    return
  }

  await update($, waitNote, () => settled.note)
  $.ui.log(settled.row)
}
