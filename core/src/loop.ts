import { settleShift, shiftNotMade, shiftUnsettled } from './flows'
import { type GaugeKeeper, takeHint } from './hint'
import type { Project } from './project'
import { compactInstructions } from './texts/prompts'
import { DELIVERED, HINTED } from './texts/rows'
import type { PendingShift, WaitNote } from './types'

// The shift loop: from an accepted shift through the let-go to continuing or waiting for the owner, and the owner's
// next message. The state and its transitions are the core's; an adapter keeps the state where its harness keeps
// state and does only what its harness alone can: let the history go, start a turn, show a row.

export type LoopState = {
  // The shift accepted in this turn, let go once the turn ends.
  pending: PendingShift | null
  // `continue` shifts in a row without the owner.
  streak: number
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

export const FRESH_LOOP: LoopState = { pending: null, streak: 0, note: null }

// An accepted shift waits for its turn to end.
export async function holdShift(loop: Loop, shift: PendingShift): Promise<void> {
  await loop.update(state => ({ ...state, pending: shift }))
}

// A hint for the agent if the fill calls for one, told to the owner too; none while a shift is pending.
export async function loopHint(loop: Loop, gauge: GaugeKeeper): Promise<string | null> {
  if ((await loop.read()).pending !== null) return null
  const text = await takeHint(gauge)
  if (text !== null) loop.tell(HINTED(text), 'info')

  return text
}

// Once the turn has ended: a pending shift lets the history go, unless the turn was aborted. Every outcome is written
// to the shift's about.md and told to the owner; nothing is lost silently.
export async function afterTurn(project: Project, loop: Loop, harness: LetGoHarness, aborted: boolean): Promise<void> {
  const state = await loop.read()
  const shift = state.pending
  if (shift === null) return
  await loop.update(current => ({ ...current, pending: null }))
  const before = await harness.fill()
  if (aborted) {
    loop.tell(await shiftNotMade(project, shift, 'the turn was aborted', before), 'warning')
    return
  }

  const done = await harness.letGo(compactInstructions(shift)).catch((error: unknown) => ({ skip: `the let-go failed: ${String(error)}` }))
  if ('skip' in done) {
    loop.tell(await shiftNotMade(project, shift, done.skip, before), 'error')
    return
  }
  try {
    await harness.afterLetGo?.()
    const settled = await settleShift(project, {
      shift,
      messages: done.messages,
      before: done.before ?? before,
      after: done.after ?? (await harness.fill()) ?? 0,
      streak: state.streak,
    })
    if (settled.after === 'continue') {
      await loop.update(current => ({ ...current, streak: settled.streak }))
      loop.tell(settled.row, 'info')
      await harness.continueWith(settled.prompt)
      return
    }
    await loop.update(current => ({ ...current, note: settled.note }))
    loop.tell(settled.row, 'info')
  } catch (error) {
    loop.tell(await shiftUnsettled(project, shift, String(error), done.before ?? before), 'error')
  }
}

// The owner spoke: the count of shifts without them starts over.
export async function ownerSpoke(loop: Loop): Promise<void> {
  await loop.update(state => ({ ...state, streak: 0 }))
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
