import { settleShift, shiftNotMade, shiftUnsettled } from './flows'
import { type GaugeKeeper, offerHint, takeHint } from './hint'
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
  // A let-go in flight, and whether the owner spoke during it: their message found no letter yet, so the one the
  // shift then leaves for them is sent after it rather than kept for a message they already sent.
  letting?: { heard: boolean } | null
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

// A hint for the agent if the fill calls for one, given at once; none while a shift is pending.
export async function loopHint(loop: Loop, gauge: GaugeKeeper): Promise<string | null> {
  if ((await loop.read()).pending !== null) return null

  return takeHint(gauge)
}

// The same, offered with the next prompt and given once `take` says it went.
export async function loopOffer(loop: Loop, gauge: GaugeKeeper): Promise<{ text: string; take(): Promise<void> } | null> {
  if ((await loop.read()).pending !== null) return null

  return offerHint(gauge)
}

// Once the turn has ended: a pending shift lets the history go, unless the turn was aborted. Every outcome is written
// to the shift's about.md and told to the owner; nothing is lost silently.
export async function afterTurn(project: Project, loop: Loop, harness: LetGoHarness, aborted: boolean): Promise<void> {
  // Claimed in the change that clears it: two ends of a turn never let go twice.
  const claim: { shift?: PendingShift | null } = {}
  await loop.update(current => {
    claim.shift = current.pending
    return current.pending === null ? current : { ...current, pending: null, letting: { heard: current.letting?.heard === true } }
  })
  const { shift } = claim
  if (shift === undefined || shift === null) return
  try {
    await letGoShift(project, loop, harness, shift, aborted)
  } finally {
    await loop.update(current => (current.letting == null ? current : { ...current, letting: null }))
  }
}

async function letGoShift(project: Project, loop: Loop, harness: LetGoHarness, shift: PendingShift, aborted: boolean): Promise<void> {
  const before = await harness.fill().catch(() => undefined)
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
    loop.tell(settled.row, 'info')
    await leave(loop, harness, settled.note)
    return
  }
  loop.tell(settled.row, 'info')
  // The shift is settled and written; a turn that does not start is told, not recorded against it, and its letter
  // waits for the owner's next message as after a wait. A letter an earlier shift left waiting is older than this one.
  await dropWaiting(loop)
  await harness.continueWith(settled.prompt).catch(async (error: unknown) => {
    await loop.update(current => ({ ...current, note: settled.note }))
    loop.tell(NOT_CONTINUED(String(error)), 'error')
  })
}

// A failed shift is told to the agent, who was told it was accepted: at once when it was to continue and may go on,
// otherwise with the owner's next message.
async function tellAgent(loop: Loop, harness: LetGoHarness, shift: PendingShift, context: string, goOn: boolean): Promise<void> {
  if (goOn && shift.after === 'continue') {
    await harness.continueWith(context).catch(async (error: unknown) => {
      await loop.update(current => ({ ...current, note: { context, dir: shift.dir, files: [FAILURE_NOTE] } }))
      loop.tell(NOT_CONTINUED(String(error), FAILURE_NOTE), 'error')
    })
    return
  }
  await leave(loop, harness, { context, dir: shift.dir, files: [FAILURE_NOTE] })
}

// A note for the owner's next message — or, when the owner already spoke while the history was let go, sent after
// that message at once; kept for the next one if it does not go.
async function leave(loop: Loop, harness: LetGoHarness, note: WaitNote): Promise<void> {
  const heard: { now?: boolean } = {}
  await loop.update(current => {
    heard.now = current.letting?.heard === true
    return heard.now ? { ...current, letting: null } : { ...current, note, letting: null }
  })
  if (heard.now !== true) return
  await harness.continueWith(note.context).catch(async (error: unknown) => {
    await loop.update(current => ({ ...current, note }))
    loop.tell(NOT_CONTINUED(String(error), note.files.includes(FAILURE_NOTE) ? FAILURE_NOTE : undefined), 'error')
  })
}

// The note waiting for the owner's message, if any, and what clears it once it went with that message: a failed
// delivery keeps it for the next one.
export async function waitingNote(loop: Loop): Promise<{ context: string; delivered: () => Promise<void> } | null> {
  const { note, pending, letting } = await loop.read()
  if (note === null) {
    // The owner spoke while a shift waits to let the history go or lets it go: what it leaves for them follows their
    // message.
    if (pending !== null || letting != null)
      await loop.update(current =>
        current.pending === null && current.letting == null ? current : { ...current, letting: { heard: true } },
      )
    return null
  }

  return {
    context: note.context,
    delivered: async () => {
      // Only this note: one parked since is newer, and waits for the next message.
      await loop.update(state => (sameNote(state.note, note) ? { ...state, note: null } : state))
      loop.tell(DELIVERED(note.files, note.dir), 'info')
    },
  }
}

// A waiting letter delivered another way — by /unshift, or by a newer shift's — is not delivered again.
export async function dropWaiting(loop: Loop): Promise<void> {
  await loop.update(current => (current.note === null ? current : { ...current, note: null }))
}

// Notes compared by value: a harness may keep them serialized.
function sameNote(a: WaitNote | null, b: WaitNote): boolean {
  return a !== null && a.dir === b.dir && a.context === b.context
}
