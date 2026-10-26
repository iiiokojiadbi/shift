// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { docStamps, followWrite, refreshDocs, settleDocs } from './docs'
import { type ChangedBy, changedRecords, type Seen } from './flows'
import type { GaugeKeeper } from './hint'
import { MOD } from './layout'
import { type Loop, loopHint, loopOffer, waitingNote } from './loop'
import type { Project } from './project'
import { NOTE_KINDS, type NoteKind } from './texts/prompts'
import { TOLD } from './texts/rows'

// Everything the mod tells the agent goes through here: a hint, the check of the records changed, the docs settled
// after a run, the waiting letter. An adapter fills two slots — a tool's result and the next prompt — and puts
// what comes back where its harness lets it; the kinds, their order, their one format and the owner's rows are here.
// Nothing is queued: every note is pulled at the slot it goes with.

// What the mod last saw of the records and how many of the main agent's tools run now: a change seen while one runs
// may be that tool's own. `written`: the files written since the docs were last settled, from the project's root.
// `docs`: the documents' stamps as the last prompt saw them, so one a script changed is settled like one written.
export type Looks = { seen: Seen | null; running: number; written?: readonly string[]; docs?: Record<string, string> }

export const FRESH_LOOKS: Looks = { seen: null, running: 0 }

export type Courier = {
  loop: Loop
  gauge: GaugeKeeper
  project(): Promise<Project>
  looks(): Promise<Looks>
  // A change applied to the looks as they are then.
  updateLooks(change: (current: Looks) => Looks): Promise<void>
}

// A note before it goes: its kind and what it says.
export type Note = { kind: NoteKind; body: string }

// How a tool of the main agent ended; null when it threw.
export type ToolEnd = {
  // The mod's own tool: it writes the records validly, so what it wrote is only remembered.
  own: boolean
  // A tool that ran read-only changed nothing: no look after it.
  readOnly: boolean
  // The file it wrote, absolute, when it wrote one and did not fail: the docs follow it, settled with the next prompt.
  written?: string
}

// Before a tool of the main agent: what changed since the last look is someone else's — the owner's hand, another
// session — unless another tool runs now, whose own change it may be. The notes go with this tool's result.
// Of tools started together only the first looks: the count is claimed in one change, so two never tell the same change.
// What it saw is kept at once: a tool that throws loses its note, which only a failing harness does, while a look kept
// open would let a sibling tool take the change as its own or put back what it saw.
export async function beforeTool(courier: Courier): Promise<Note[]> {
  const claim: { first?: boolean } = {}
  await courier.updateLooks(current => {
    claim.first = current.running === 0
    return { ...current, running: current.running + 1 }
  })
  if (claim.first !== true) return []
  const outside = await look(courier, 'other')
  if (outside === null) return []
  await remember(courier, outside.seen)

  return outside.body === null ? [] : [{ kind: 'records', body: outside.body }]
}

// After a tool of the main agent: the notes from before it, what it changed in the records, and a hint if the fill
// calls for one — wrapped, each told to the owner as it goes into the result. A file it wrote is only followed.
export async function afterTool(courier: Courier, before: readonly Note[], done: ToolEnd | null): Promise<string[]> {
  await courier.updateLooks(current => ({ ...current, running: Math.max(0, current.running - 1) }))
  if (done === null) return []
  const notes = [...before]
  const own = done.readOnly ? null : await look(courier, 'agent')
  if (own !== null) await remember(courier, own.seen)
  if (own?.body != null && !done.own) notes.push({ kind: 'records', body: own.body })
  if (done.written !== undefined) await follow(courier, done.written)
  const hint = await loopHint(courier.loop, courier.gauge).catch(() => null)
  if (hint !== null) notes.push({ kind: 'hint', body: hint })

  return deliver(courier.loop, notes)
}

// A file written by a subagent: the docs follow it, settled with the main agent's next prompt.
export async function afterWrite(courier: Courier, file: string): Promise<void> {
  await follow(courier, file)
}

// With the next prompt: what changed between turns, the docs written in the run settled, a hint, and after a wait the
// letter, last, when the owner speaks. With a tool running — a message queued mid-run — the docs wait: it may be an edit.
// Nothing is marked told — the records seen, the docs settled, the hint, the letter — until `delivered` says the prompt
// went with them: a prompt that failed or was dropped leaves every note for the next one.
export async function atPrompt(
  courier: Courier,
  { runStarts, owner }: { runStarts: boolean; owner: boolean },
): Promise<{ notes: string[]; delivered(): Promise<void> }> {
  if (runStarts) await courier.updateLooks(current => ({ ...current, running: 0 }))
  const notes: Note[] = []
  const { running } = await courier.looks()
  const { seen } = await courier.looks()
  const outside = running === 0 ? await look(courier, 'other') : null
  if (outside?.body === null) await remember(courier, outside.seen)
  if (outside?.body != null) notes.push({ kind: 'records', body: outside.body })
  if (running === 0) await scripted(courier)
  const docs = running === 0 ? await settle(courier) : null
  if (docs !== null) notes.push({ kind: 'docs', body: docs.body })
  const hint = await loopOffer(courier.loop, courier.gauge).catch(() => null)
  if (hint !== null) notes.push({ kind: 'hint', body: hint.text })
  const letter = owner ? await waitingNote(courier.loop) : null

  return {
    notes: [...notes.map(wrap), ...(letter === null ? [] : [letter.context])],
    delivered: async () => {
      // Kept unless a look since has kept newer records: putting back the older ones would tell their change again.
      if (outside?.body != null)
        await courier.updateLooks(current => (same(current.seen, seen) ? { ...current, seen: outside.seen } : current))
      if (docs !== null) {
        const skipped = await docs.write().catch(() => docs.paths)
        const settled = docs.paths.filter(path => !skipped.includes(path))
        await forget(courier, settled)
        await restamp(courier, settled)
      }
      await hint?.take()
      for (const note of notes) courier.loop.tell(TOLD(note.body), 'info')
      await letter?.delivered()
    },
  }
}

// The run is over: no tool of it runs any more, whatever a process that ended mid-tool left counted.
export async function runEnded(courier: Courier): Promise<void> {
  await courier.updateLooks(current => (current.running === 0 ? current : { ...current, running: 0 }))
}

// The records changed since the last look and what they are now, kept by `remember`; the first look finds nothing to
// tell. A look that fails says nothing: it must never stand between the agent and its tool.
async function look(courier: Courier, by: ChangedBy): Promise<{ body: string | null; seen: Seen } | null> {
  try {
    return await changedRecords(await courier.project(), (await courier.looks()).seen, by)
  } catch {
    return null
  }
}

async function remember(courier: Courier, seen: Seen): Promise<void> {
  await courier.updateLooks(current => ({ ...current, seen }))
}

// A written file the docs follow is remembered for the next prompt; the map follows a document at once.
async function follow(courier: Courier, file: string): Promise<void> {
  const path = await followWrite(await courier.project(), file).catch(() => null)
  if (path === null) return
  await courier.updateLooks(current =>
    current.written?.includes(path) ? current : { ...current, written: [...(current.written ?? []), path] },
  )
}

// The files written since the last settling, settled now and forgotten once told; a settling that fails says nothing.
// Nothing to tell is settled and forgotten at once: an adapter calls `delivered` only when a note goes.
async function settle(courier: Courier): Promise<{ body: string; paths: readonly string[]; write(): Promise<readonly string[]> } | null> {
  const written = (await courier.looks()).written ?? []
  if (written.length === 0) return null
  const settled = await settleDocs(await courier.project(), written).catch(() => null)
  if (settled !== null && settled.lines.length > 0) return { body: settled.lines.join('\n'), paths: written, write: settled.write }
  const skipped = (await settled?.write().catch(() => written)) ?? []
  const done = written.filter(path => !skipped.includes(path))
  await forget(courier, done)
  await restamp(courier, done)

  return null
}

// The documents changed since the last prompt that no write of the agent's tools named — a script, a command — are
// taken as written, and the map follows them. The first look only remembers: there is nothing to compare with yet.
async function scripted(courier: Courier): Promise<void> {
  try {
    const project = await courier.project()
    const now = await docStamps(project)
    const before = (await courier.looks()).docs
    await courier.updateLooks(current => ({ ...current, docs: now }))
    if (before === undefined) return
    const changed = Object.keys(now).filter(path => before[path] !== now[path])
    const removed = Object.keys(before).some(path => now[path] === undefined)
    if (changed.length === 0 && !removed) return
    await courier.updateLooks(current => ({
      ...current,
      written: [...(current.written ?? []), ...changed.filter(path => !(current.written ?? []).includes(path))],
    }))
    await refreshDocs(project, { tocs: false })
  } catch {
    // A look that fails says nothing: the documents are settled at the next one, or at a shift.
  }
}

// A document settled is remembered as it is now, the toc the mod wrote included, so it is not taken for a script's change.
async function restamp(courier: Courier, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  const now = await docStamps(await courier.project()).catch(() => null)
  if (now === null) return
  await courier.updateLooks(current => {
    if (current.docs === undefined) return current
    const docs = { ...current.docs }
    for (const path of paths) {
      if (now[path] === undefined) delete docs[path]
      else docs[path] = now[path]
    }
    return { ...current, docs }
  })
}

// Seen records compared by value: a harness may keep them serialized.
function same(a: Seen | null, b: Seen | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function forget(courier: Courier, paths: readonly string[]): Promise<void> {
  await courier.updateLooks(current => ({ ...current, written: (current.written ?? []).filter(path => !paths.includes(path)) }))
}

function deliver(loop: Loop, notes: readonly Note[]): string[] {
  for (const note of notes) loop.tell(TOLD(note.body), 'info')

  return notes.map(wrap)
}

// Every note in the mod's tag, by its kind: the agent tells it from what it came with.
export function wrap({ kind, body }: Note): string {
  return `<${MOD} note="${NOTE_KINDS[kind]}">\n${body}\n</${MOD}>`
}
