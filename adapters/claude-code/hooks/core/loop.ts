// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { settleShift, shiftNotMade, shiftUnsettled } from './flows'
import { type GaugeKeeper, takeHint } from './hint'
import { basename } from './paths'
import type { Project } from './project'
import { compactInstructions, FAILURE_NOTE, NOT_MADE_NOTE, UNSETTLED_NOTE } from './texts/prompts'
import { DELIVERED, NOT_CONTINUED } from './texts/rows'
import type { PendingShift, Settled, WaitNote } from './types'

// The shift loop: from an accepted shift through the let-go to continuing or waiting for the owner, and the owner's
// next message. The state and its transitions are the core's; an adapter keeps the state where its harness keeps
// state and does only what its harness alone can: let the history go, start a turn, show a row.

export type LoopState = {
  // The shift accepted in this turn, let go once the turn ends.
  pending: PendingShift | null
  // The letter and the records waiting for the owner's next message.
  note: WaitNote | null
}

export type Level = 'info' | 'warning' | 'error'

export type Loop = {
  read(): Promise<LoopState>
  // A change applied to the state as it is then.
  update(change: (current: LoopState) => LoopState): Promise<void>
  tell(row: string, level: Level): void
}

// What only the harness does at a let-go.
export type LetGoHarness = {
  // How full the history is now; undefined before the first reading.
  fill(): Promise<number | undefined>
  // Lets the history go with the instructions: what it went into and the fills around it, or why it did not.
  letGo(
    instructions: string,
  ): Promise<{ messages: readonly { role: string; text: string }[]; before?: number; after?: number } | { skip: string }>
  // Starts the agent's next turn with the prompt.
  continueWith(prompt: string): Promise<void>
  // What the harness refreshes once the history is let go, before the message after it.
  afterLetGo?(): Promise<void>
}

export const FRESH_LOOP: LoopState = { pending: null, note: null }

// An accepted shift waits for its turn to end.
export async function holdShift(loop: Loop, shift: PendingShift): Promise<void> {
  await loop.update(state => ({ ...state, pending: shift }))
}

// A hint for the agent if the fill calls for one; none while a shift is pending.
export async function loopHint(loop: Loop, gauge: GaugeKeeper): Promise<string | null> {
  if ((await loop.read()).pending !== null) return null

  return takeHint(gauge)
}

// Once the turn has ended: a pending shift lets the history go, unless the turn was aborted. Every outcome is written
// to the shift's about.md and told to the owner; nothing is lost silently.
export async function afterTurn(project: Project, loop: Loop, harness: LetGoHarness, aborted: boolean): Promise<void> {
  const shift = (await loop.read()).pending
  if (shift === null) return
  await loop.update(current => ({ ...current, pending: null }))
  const before = await harness.fill()
  const name = basename(shift.dir)
  if (aborted) {
    const why = 'the turn was aborted'
    loop.tell(await shiftNotMade(project, shift, why, before), 'warning')
    await tellAgent(loop, harness, shift, NOT_MADE_NOTE(name, why), false)
    return
  }

  const done = await harness.letGo(compactInstructions(shift)).catch((error: unknown) => ({ skip: `the let-go failed: ${String(error)}` }))
  if ('skip' in done) {
    loop.tell(await shiftNotMade(project, shift, done.skip, before), 'error')
    await tellAgent(loop, harness, shift, NOT_MADE_NOTE(name, done.skip), true)
    return
  }
  let settled: Settled
  try {
    await harness.afterLetGo?.()
    settled = await settleShift(project, {
      shift,
      messages: done.messages,
      before: done.before ?? before,
      after: done.after ?? (await harness.fill()) ?? 0,
    })
  } catch (error) {
    const why = String(error)
    loop.tell(await shiftUnsettled(project, shift, why, done.before ?? before), 'error')
    await tellAgent(loop, harness, shift, UNSETTLED_NOTE(name, why, shift.dir), true)
    return
  }
  if (settled.after === 'wait') {
    const { note } = settled
    await loop.update(current => ({ ...current, note }))
    loop.tell(settled.row, 'info')
    return
  }
  loop.tell(settled.row, 'info')
  // The shift is settled and written; a turn that does not start is told, not recorded against it.
  await harness.continueWith(settled.prompt).catch((error: unknown) => loop.tell(NOT_CONTINUED(String(error)), 'error'))
}

// A failed shift is told to the agent, who was told it was accepted: at once when it was to continue and may go on,
// otherwise with the owner's next message.
async function tellAgent(loop: Loop, harness: LetGoHarness, shift: PendingShift, context: string, goOn: boolean): Promise<void> {
  if (goOn && shift.after === 'continue') {
    await harness.continueWith(context).catch((error: unknown) => loop.tell(NOT_CONTINUED(String(error)), 'error'))
    return
  }
  await loop.update(current => ({ ...current, note: { context, dir: shift.dir, files: [FAILURE_NOTE] } }))
}

// The note waiting for the owner's message, if any, and what clears it once it went with that message: a failed
// delivery keeps it for the next one.
export async function waitingNote(loop: Loop): Promise<{ context: string; delivered: () => Promise<void> } | null> {
  const { note } = await loop.read()
  if (note === null) return null

  return {
    context: note.context,
    delivered: async () => {
      await loop.update(state => ({ ...state, note: null }))
      loop.tell(DELIVERED(note.files, note.dir), 'info')
    },
  }
}
