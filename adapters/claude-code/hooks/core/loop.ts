// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { settleShift, shiftNotMade, shiftUnsettled } from './flows'
import { type GaugeKeeper, offerHint, takeHint } from './hint'
import { basename } from './paths'
import type { Project } from './project'
import { compactInstructions, FAILURE_NOTE, HELD_NOTE, NOT_MADE_NOTE, ourWords, SHIFT_NOW, UNSETTLED_NOTE } from './texts/prompts'
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
  // shift then leaves for them is sent after it rather than kept for a message they already sent. A harness that can
  // take the owner's message back holds it here instead, and it goes after the letter, never before it.
  letting?: { heard: boolean; held?: HeldMessage[] } | null
}

// An owner's message held back while a shift is under way; what it carried besides the text, as the harness gave it.
export type HeldMessage = { text: string; attachments?: readonly unknown[] }

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
  // Starts the agent's next turn with the prompt, and what the owner's held messages carried besides their text.
  continueWith(prompt: string, attachments?: readonly unknown[]): Promise<void>
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
  // The let-go is marked before the shift is claimed, so an owner's message never falls between the two: a harness may
  // keep them apart. Claimed in the change that clears it: two ends of a turn never let go twice.
  await loop.update(current => (current.pending === null ? current : { ...current, letting: lettingOf(current) }))
  const claim: { shift?: PendingShift | null } = {}
  await loop.update(current => {
    claim.shift = current.pending
    return current.pending === null ? current : { ...current, pending: null, letting: lettingOf(current) }
  })
  const { shift } = claim
  if (shift === undefined || shift === null) return
  try {
    await letGoShift(project, loop, harness, shift, aborted)
  } finally {
    // Whatever way the shift ended, a message the owner sent meanwhile is never dropped with it.
    const held = await release(loop)
    if (held.length > 0) await send(loop, harness, { context: '', dir: shift.dir, files: [] }, held)
  }
}

function lettingOf(current: LoopState): { heard: boolean; held?: HeldMessage[] } {
  return { ...current.letting, heard: current.letting?.heard === true }
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
    // The harness's reason, in the mod's words wherever it goes: the note, the row and about.md.
    const why = ourWords(done.skip)
    loop.tell(await shiftNotMade(project, shift, why, before), 'error')
    await tellAgent(loop, harness, shift, NOT_MADE_NOTE(name, why), true)
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
    const why = ourWords(String(error))
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
  await dropWaiting(loop).catch(() => undefined)
  const held = await release(loop)
  await harness.continueWith(withHeld(settled.prompt, held), attachmentsOf(held)).catch(async (error: unknown) => {
    await loop.update(current => ({ ...current, note: { ...settled.note, context: withHeld(settled.note.context, held) } }))
    loop.tell(NOT_CONTINUED(String(error)), 'error')
  })
}

// A failed shift is told to the agent, who was told it was accepted: at once when it was to continue and may go on,
// otherwise with the owner's next message.
async function tellAgent(loop: Loop, harness: LetGoHarness, shift: PendingShift, context: string, goOn: boolean): Promise<void> {
  if (goOn && shift.after === 'continue') {
    await send(loop, harness, { context, dir: shift.dir, files: [FAILURE_NOTE] }, await release(loop))
    return
  }
  await leave(loop, harness, { context, dir: shift.dir, files: [FAILURE_NOTE] })
}

// A note for the owner's next message — or, when the owner already spoke while the history was let go, sent after
// that message at once; kept for the next one if it does not go.
async function leave(loop: Loop, harness: LetGoHarness, note: WaitNote): Promise<void> {
  const heard: { now?: boolean; held: HeldMessage[] } = { held: [] }
  await loop.update(current => {
    heard.now = current.letting?.heard === true
    heard.held = current.letting?.held ?? []
    return heard.now ? { ...current, letting: null } : { ...current, note, letting: null }
  })
  if (heard.now !== true) return
  await send(loop, harness, note, heard.held)
}

// The note and the owner's held messages after it start the next turn; kept together for the owner's next message
// if the turn does not start.
async function send(loop: Loop, harness: LetGoHarness, note: WaitNote, held: readonly HeldMessage[]): Promise<void> {
  const kept = { ...note, context: withHeld(note.context, held) }
  await harness.continueWith(kept.context, attachmentsOf(held)).catch(async (error: unknown) => {
    await loop.update(current => ({ ...current, note: kept }))
    loop.tell(NOT_CONTINUED(String(error), note.files.includes(FAILURE_NOTE) ? FAILURE_NOTE : undefined), 'error')
  })
}

// The let-go is over: the owner's messages held during it are taken in the change that ends it, so one sent after it
// is not held at all.
async function release(loop: Loop): Promise<HeldMessage[]> {
  const taken: { held: HeldMessage[] } = { held: [] }
  await loop.update(current => {
    taken.held = current.letting?.held ?? []
    return current.letting == null ? current : { ...current, letting: null }
  })

  return taken.held
}

function withHeld(context: string, held: readonly HeldMessage[]): string {
  if (held.length === 0) return context
  const words = HELD_NOTE(held.map(message => message.text))

  return context === '' ? words : `${context}\n\n${words}`
}

function attachmentsOf(held: readonly HeldMessage[]): readonly unknown[] | undefined {
  const all = held.flatMap(message => message.attachments ?? [])

  return all.length === 0 ? undefined : all
}

// The owner's message while a shift waits for its turn to end or lets the history go, from a harness that can take it
// back: held, to go after the letter, and true; false when no shift is under way and the message goes as it is.
export async function holdOwner(loop: Loop, message: HeldMessage): Promise<boolean> {
  const held = { now: false }
  await loop.update(current => {
    held.now = current.pending !== null || current.letting != null
    return held.now ? { ...current, letting: { heard: true, held: [...(current.letting?.held ?? []), message] } } : current
  })

  return held.now
}

// The note waiting for the owner's message, if any, and what clears it once it went with that message: a failed
// delivery keeps it for the next one.
export async function waitingNote(loop: Loop): Promise<{ context: string; delivered: () => Promise<void> } | null> {
  const { note, pending, letting } = await loop.read()
  // The owner spoke while a shift waits to let the history go or lets it go: what it leaves for them follows their
  // message, whether an older letter goes with this one or not.
  if (pending !== null || letting != null)
    await loop.update(current =>
      current.pending === null && current.letting == null ? current : { ...current, letting: { ...current.letting, heard: true } },
    )
  if (note === null) return null

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

// The owner's /shift: the ask to shift, after a letter still waiting for them, which goes with it — the agent shifts
// from its records, never past a letter it has not read.
export async function shiftNow(loop: Loop, words: string): Promise<{ text: string; delivered: () => Promise<void> }> {
  const letter = await waitingNote(loop)
  const ask = SHIFT_NOW(words)

  return letter === null ? { text: ask, delivered: async () => {} } : { text: `${letter.context}\n\n${ask}`, delivered: letter.delivered }
}
