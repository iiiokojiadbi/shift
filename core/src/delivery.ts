import { followWrite, settleDocs } from './docs'
import { type ChangedBy, changedRecords, type Seen } from './flows'
import type { GaugeKeeper } from './hint'
import { MOD } from './layout'
import { type Loop, loopHint, waitingNote } from './loop'
import type { Project } from './project'
import { NOTE_KINDS, type NoteKind } from './texts/prompts'
import { TOLD } from './texts/rows'

// Everything the mod tells the agent goes through here: a hint, the check of the records changed, the docs settled
// after a run, the waiting letter. An adapter fills two slots — a tool's result and the next prompt — and puts
// what comes back where its harness lets it; the kinds, their order, their one format and the owner's rows are here.
// Nothing is queued: every note is pulled at the slot it goes with.

// What the mod last saw of the records and how many of the main agent's tools run now: a change seen while one runs
// may be that tool's own. `written`: the files written since the docs were last settled, from the project's root.
export type Looks = { seen: Seen | null; running: number; written?: readonly string[] }

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
export async function beforeTool(courier: Courier): Promise<Note[]> {
  const { running } = await courier.looks()
  const outside = running === 0 ? await look(courier, 'other') : null
  await courier.updateLooks(current => ({ ...current, running: current.running + 1 }))

  return outside === null ? [] : [{ kind: 'records', body: outside }]
}

// After a tool of the main agent: the notes from before it, what it changed in the records, and a hint if the fill
// calls for one — wrapped, each told to the owner as it goes into the result. A file it wrote is only followed.
export async function afterTool(courier: Courier, before: readonly Note[], done: ToolEnd | null): Promise<string[]> {
  await courier.updateLooks(current => ({ ...current, running: Math.max(0, current.running - 1) }))
  if (done === null) return []
  const notes = [...before]
  const own = done.readOnly ? null : await look(courier, 'agent')
  if (own !== null && !done.own) notes.push({ kind: 'records', body: own })
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
// The notes are told to the owner and the letter cleared only once `delivered` says the prompt went with them.
export async function atPrompt(
  courier: Courier,
  { runStarts, owner }: { runStarts: boolean; owner: boolean },
): Promise<{ notes: string[]; delivered(): Promise<void> }> {
  if (runStarts) await courier.updateLooks(current => ({ ...current, running: 0 }))
  const notes: Note[] = []
  const { running } = await courier.looks()
  const outside = running === 0 ? await look(courier, 'other') : null
  if (outside !== null) notes.push({ kind: 'records', body: outside })
  const docs = running === 0 ? await settle(courier) : null
  if (docs !== null) notes.push({ kind: 'docs', body: docs })
  const hint = await loopHint(courier.loop, courier.gauge).catch(() => null)
  if (hint !== null) notes.push({ kind: 'hint', body: hint })
  const letter = owner ? await waitingNote(courier.loop) : null

  return {
    notes: [...notes.map(wrap), ...(letter === null ? [] : [letter.context])],
    delivered: async () => {
      for (const note of notes) courier.loop.tell(TOLD(note.body), 'info')
      await letter?.delivered()
    },
  }
}

// The run is over: no tool of it runs any more, whatever a process that ended mid-tool left counted.
export async function runEnded(courier: Courier): Promise<void> {
  await courier.updateLooks(current => (current.running === 0 ? current : { ...current, running: 0 }))
}

// The records changed since the last look; the first look only remembers them. A look that fails says nothing: it
// must never stand between the agent and its tool.
async function look(courier: Courier, by: ChangedBy): Promise<string | null> {
  try {
    const changed = await changedRecords(await courier.project(), (await courier.looks()).seen, by)
    await courier.updateLooks(current => ({ ...current, seen: changed.seen }))

    return changed.body
  } catch {
    return null
  }
}

// A written file the docs follow is remembered for the next prompt; the map follows a document at once.
async function follow(courier: Courier, file: string): Promise<void> {
  const path = await followWrite(await courier.project(), file).catch(() => null)
  if (path === null) return
  await courier.updateLooks(current =>
    current.written?.includes(path) ? current : { ...current, written: [...(current.written ?? []), path] },
  )
}

// The files written since the last settling, settled now and forgotten; a settling that fails says nothing.
async function settle(courier: Courier): Promise<string | null> {
  const written = (await courier.looks()).written ?? []
  if (written.length === 0) return null
  await courier.updateLooks(current => ({ ...current, written: (current.written ?? []).filter(path => !written.includes(path)) }))
  const lines = await settleDocs(await courier.project(), written).catch(() => [])

  return lines.length === 0 ? null : lines.join('\n')
}

function deliver(loop: Loop, notes: readonly Note[]): string[] {
  for (const note of notes) loop.tell(TOLD(note.body), 'info')

  return notes.map(wrap)
}

// Every note in the mod's tag, by its kind: the agent tells it from what it came with.
export function wrap({ kind, body }: Note): string {
  return `<${MOD} note="${NOTE_KINDS[kind]}">\n${body}\n</${MOD}>`
}
