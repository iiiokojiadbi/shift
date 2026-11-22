// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { readAbout } from './about'
import { docStamps, followWrite, refreshDocs, settleDocs } from './docs'
import { type ChangedBy, type ConfirmedEdit, changedRecords, handBack, type Seen } from './flows'
import type { GaugeKeeper } from './hint'
import { KNOWLEDGE, MOD, NAMES } from './layout'
import { type Loop, loopHint, loopOffer, waitingNote } from './loop'
import { currentMap, type MapPrints } from './map'
import { fromRoot } from './paths'
import type { Project } from './project'
import { archiveCall, hasArchive, readSaved } from './saved'
import { continuePrompt, NOTE_KINDS, type NoteKind, waitContext } from './texts/prompts'
import { TOLD } from './texts/rows'

// Everything the mod tells the agent goes through here: a hint, the check of the records changed, the docs settled
// after a run, the waiting letter. An adapter fills two slots — a tool's result and the next prompt — and puts
// what comes back where its harness lets it; the kinds, their order, their one format and the owner's rows are here.
// Nothing is queued: every note is pulled at the slot it goes with.

// What the mod last saw of the records and how many of the main agent's tools run now: a change seen while one runs
// may be that tool's own. `written`: the files written since the docs were last settled, from the project's root.
// `docs`: the documents' stamps as the last prompt saw them, so one a script changed is settled like one written.
export type Looks = {
  seen: Seen | null
  running: number
  map?: MapPrints
  mapNotes?: string[]
  written?: readonly string[]
  docs?: Record<string, string>
}

export const FRESH_LOOKS: Looks = { seen: null, running: 0 }

// Save only observations that need to survive reattachment. Running tools belong to the old process.
export type MapCheckpoint = Pick<Looks, 'map' | 'mapNotes' | 'seen' | 'docs'>

export function mapCheckpoint(looks: Looks): MapCheckpoint {
  const { map, mapNotes, seen, docs } = looks
  return { map, mapNotes, seen, docs }
}

export function checkpointChanged(before: Looks, after: Looks): boolean {
  return before.map !== after.map || before.mapNotes !== after.mapNotes || !same(before.seen, after.seen)
}

export type RecordCourier = {
  confirmedEdit?: ConfirmedEdit
  project(): Promise<Project>
  looks(): Promise<Looks>
  // A change applied to the looks as they are then.
  updateLooks(change: (current: Looks) => Looks): Promise<void>
}

export type Courier = RecordCourier & { loop: Loop; gauge: GaugeKeeper }

// A note before it goes: its kind and what it says.
export type Note = { kind: NoteKind; body: string }

// How a tool of the main agent ended; null when it threw.
export type ToolEnd = {
  // The mod's own tool: it writes the records validly, so what it wrote is only remembered.
  own: boolean
  // How the adapter attributes changes without a file receipt.
  recordSource?: ChangedBy
  // A tool that ran read-only changed nothing: no look after it.
  readOnly: boolean
  // The file it wrote, absolute, when it wrote one and did not fail: the docs follow it, settled with the next prompt.
  written?: string
  // A matched shell tool may write arbitrary paths.
  shellWrite?: boolean
  // Full-file write input, when the host supplies it.
  content?: string
}

// Before a tool of the main agent: what changed since the last look is someone else's — the owner's hand, another
// session — unless another tool runs now, whose own change it may be. The notes go with this tool's result.
// Of tools started together only the first looks: the count is claimed in one change, so two never tell the same change.
// What it saw is kept at once: a tool that throws loses its note, which only a failing harness does, while a look kept
// open would let a sibling tool take the change as its own or put back what it saw.
export async function beforeTool(courier: RecordCourier): Promise<Note[]> {
  const claim: { first?: boolean } = {}
  await courier.updateLooks(current => {
    claim.first = current.running === 0
    return { ...current, running: current.running + 1 }
  })
  if (claim.first !== true) return []
  await checkMap(courier)
  const outside = await look(courier, 'other')
  if (outside === null) return []
  await remember(courier, outside.seen)

  return outside.body === null ? [] : [{ kind: 'records', body: outside.body }]
}

// After a tool of the main agent: the notes from before it, what it changed in the records, and a hint if the fill
// calls for one — wrapped, each told to the owner as it goes into the result. A file it wrote is only followed.
export async function afterTool(courier: Courier, before: readonly Note[], done: ToolEnd | null): Promise<string[]> {
  const notes = await afterToolRecords(courier, before, done)
  if (done === null) return []
  const hint = await loopHint(courier.loop, courier.gauge).catch(() => null)
  if (hint !== null) notes.push({ kind: 'hint', body: hint })

  return deliver(courier.loop, notes)
}

export async function afterToolRecords(courier: RecordCourier, before: readonly Note[], done: ToolEnd | null): Promise<Note[]> {
  await courier.updateLooks(current => ({ ...current, running: Math.max(0, current.running - 1) }))
  if (done === null) return []
  const notes = [...before]
  const own = done.readOnly ? null : await look(courier, done.recordSource ?? 'agent')
  if (own !== null) await remember(courier, own.seen)
  if (own?.body != null && !done.own) notes.push({ kind: 'records', body: own.body })
  if (done.written !== undefined) await follow(courier, done.written)
  if (done.written || done.shellWrite) await checkMap(courier, done)
  if ((await courier.looks()).mapNotes?.length) {
    let claimed: readonly string[] = []
    await courier.updateLooks(current => {
      claimed = current.running ? [] : (current.mapNotes ?? [])
      return claimed.length ? { ...current, mapNotes: [] } : current
    })
    notes.push(...claimed.map(body => ({ kind: 'map' as const, body })))
  }
  return notes
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
): Promise<{
  waiting?: string | undefined
  notes: string[]
  attachments?: readonly unknown[] | undefined
  delivered(includeLetter?: boolean): Promise<void>
}> {
  const records = await promptRecords(courier, runStarts, false)
  const notes = records.notes
  const hint = await loopOffer(courier.loop, courier.gauge).catch(() => null)
  if (hint !== null) notes.push({ kind: 'hint', body: hint.text })
  const letter = owner ? await waitingNote(courier.loop, await courier.project()) : null

  return {
    waiting: letter?.dir,
    attachments: letter?.attachments,
    notes: [...notes.map(wrap), ...(letter === null ? [] : [letter.context])],
    delivered: async (includeLetter = true) => {
      await records.delivered()
      await hint?.take()
      for (const note of notes) if (note.kind !== 'map') courier.loop.tell(TOLD(note.body), 'info')
      if (includeLetter) await letter?.delivered()
    },
  }
}

export async function promptRecords(
  courier: RecordCourier,
  runStarts: boolean,
  parkedWait = false,
  submitted = '',
  alreadyDelivered?: string,
) {
  if (runStarts) await courier.updateLooks(current => ({ ...current, running: 0 }))
  const notes: Note[] = []
  const { seen, running } = await courier.looks()
  const project = await courier.project()
  const session = project.actor
  const durableWait =
    running === 0 && parkedWait && session && project.store.beads && (await hasArchive(project))
      ? await archiveCall<string>(project, { action: 'waiting', session: project.deliveryKey ?? session })
      : ''
  let waiting = parkedWait && durableWait !== alreadyDelivered ? durableWait : ''
  let recovery = ''
  if (waiting) {
    const saved = await readSaved(project, waiting, NAMES.letter)
    if (readAbout(saved.about).after === 'continue') {
      // A normal automatic continuation already carries the letter. Its caller acknowledges enqueue.
      const letter = saved.files[NAMES.letter] ?? ''
      if (submitted.startsWith(`<shift id="${waiting}">\nShift done.`) && submitted.includes(letter.trim())) waiting = ''
      else recovery = continuePrompt(letter, await handBack(project, waiting, session))
    } else recovery = waitContext(saved.files[NAMES.letter] ?? '', await handBack(project, waiting, session))
  }
  const outside = running === 0 ? await look(courier, 'other') : null
  if (outside?.body === null) await remember(courier, outside.seen)
  if (outside?.body != null) notes.push({ kind: 'records', body: outside.body })
  if (running === 0) await checkMap(courier)
  const mapNotes = running === 0 ? ((await courier.looks()).mapNotes ?? []) : []
  notes.push(...mapNotes.map(body => ({ kind: 'map' as const, body })))
  if (running === 0) await scripted(courier)
  const docs = running === 0 ? await settle(courier) : null
  if (docs !== null) notes.push({ kind: 'docs', body: docs.body })
  return {
    notes,
    waiting,
    recovery,
    delivered: async () => {
      if (mapNotes.length) await takeMapNotes(courier, mapNotes)
      // Kept unless a look since has kept newer records: putting back the older ones would tell their change again.
      if (outside?.body != null)
        await courier.updateLooks(current => (same(current.seen, seen) ? { ...current, seen: outside.seen } : current))
      if (docs !== null) {
        const skipped = await docs.write().catch(() => docs.paths)
        const settled = docs.paths.filter(path => !skipped.includes(path))
        await forget(courier, settled)
        await restamp(courier, settled)
      }
    },
  }
}

// The run is over: no tool of it runs any more, whatever a process that ended mid-tool left counted.
export async function runEnded(courier: Courier): Promise<void> {
  await courier.updateLooks(current => (current.running === 0 ? current : { ...current, running: 0 }))
}

// Advance this observer only. Queue external changes until a successful tool result or prompt can carry them.
async function checkMap(courier: RecordCourier, done?: ToolEnd): Promise<void> {
  const previous = (await courier.looks()).map
  if (!previous) return
  const project = await courier.project()
  const file = done?.written && fromRoot(project.root, done.written)
  let confirmedFile = false
  const changed = await currentMap(project, previous, (path, text) => {
    if (path === file && (done?.content === undefined || done.content === text)) confirmedFile = true
    return done?.shellWrite === true || (path === file && confirmedFile)
  }).catch(() => null)
  if (!changed || changed.prints === previous) return
  await courier.updateLooks(current => {
    // A parallel writer may have completed another file already. Only acknowledge this tool's path.
    // The first idle observation checks every remaining path against its own previous contents.
    if (file && done && !done.shellWrite) {
      const next = changed.prints.documents?.[file]
      const map = current.map
      if (!confirmedFile || !next || !map?.documents || map.documents[file]?.stamp !== previous.documents?.[file]?.stamp) return current
      return {
        ...current,
        map: { ...map, documents: { ...map.documents, [file]: next }, map: { ...map.map, [file]: changed.prints.map[file] ?? '' } },
      }
    }
    if (JSON.stringify(previous) !== JSON.stringify(current.map)) return current
    const body = done?.shellWrite ? '' : changed.note
    return { ...current, map: changed.prints, mapNotes: body ? [...(current.mapNotes ?? []), body] : current.mapNotes }
  })
}

async function takeMapNotes(courier: RecordCourier, delivered: readonly string[]): Promise<void> {
  await courier.updateLooks(current => {
    const pending = current.mapNotes ?? []
    return delivered.every((body, index) => pending[index] === body) ? { ...current, mapNotes: pending.slice(delivered.length) } : current
  })
}

// The records changed since the last look and what they are now, kept by `remember`; the first look finds nothing to
// tell. A look that fails says nothing: it must never stand between the agent and its tool.
async function look(courier: RecordCourier, by: ChangedBy): Promise<{ body: string | null; seen: Seen } | null> {
  try {
    return await changedRecords(await courier.project(), (await courier.looks()).seen, by, courier.confirmedEdit)
  } catch {
    return null
  }
}

async function remember(courier: RecordCourier, seen: Seen): Promise<void> {
  await courier.updateLooks(current => ({ ...current, seen }))
}

// A written file the docs follow is remembered for the next prompt; the map follows a document at once.
async function follow(courier: RecordCourier, file: string): Promise<void> {
  const path = await followWrite(await courier.project(), file).catch(() => null)
  if (path === null) return
  await courier.updateLooks(current =>
    current.written?.includes(path) ? current : { ...current, written: [...(current.written ?? []), path] },
  )
}

// The files written since the last settling, settled now and forgotten once told; a settling that fails says nothing.
// Nothing to tell is settled and forgotten at once: an adapter calls `delivered` only when a note goes.
async function settle(
  courier: RecordCourier,
): Promise<{ body: string; paths: readonly string[]; write(): Promise<readonly string[]> } | null> {
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
async function scripted(courier: RecordCourier): Promise<void> {
  try {
    const project = await courier.project()
    const now = await docStamps(project)
    const before = (await courier.looks()).docs
    const changed = Object.keys(now).filter(path => before?.[path] !== now[path])
    const removed = Object.keys(before ?? {}).some(path => now[path] === undefined)
    if (before !== undefined && (changed.length > 0 || removed)) {
      await courier.updateLooks(current => ({
        ...current,
        written: [
          ...(current.written ?? []),
          ...changed.filter(path => !path.startsWith(`${KNOWLEDGE}/`) && !(current.written ?? []).includes(path)),
        ],
      }))
      await refreshDocs(project, { tocs: false })
    }
    // Remembered once the map follows: a refresh that failed finds the same change at the next look.
    await courier.updateLooks(current => ({ ...current, docs: now }))
  } catch {
    // A look that fails says nothing: the documents are settled at the next one, or at a shift.
  }
}

// A document settled is remembered as it is now, the toc the mod wrote included, so it is not taken for a script's change.
async function restamp(courier: RecordCourier, paths: readonly string[]): Promise<void> {
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

async function forget(courier: RecordCourier, paths: readonly string[]): Promise<void> {
  await courier.updateLooks(current => ({ ...current, written: (current.written ?? []).filter(path => !paths.includes(path)) }))
}

function deliver(loop: Loop, notes: readonly Note[]): string[] {
  for (const note of notes) if (note.kind !== 'map') loop.tell(TOLD(note.body), 'info')

  return notes.map(wrap)
}

// Every note in the mod's tag, by its kind: the agent tells it from what it came with.
export function wrap({ kind, body }: Note): string {
  return `<${MOD} note="${NOTE_KINDS[kind]}">\n${body}\n</${MOD}>`
}
