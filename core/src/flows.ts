import { OUTCOME, readAbout, renderAbout, shiftFill } from './about'
import { installTaskCommand, taskInstructions } from './beads'
import { docsReport, isDoc, refreshDocs, withMap, withToc } from './docs'
import { renderHistory, renderSummary } from './history'
import { ABOUT_MAX, BOARD, DIR, GUIDE_TOOL, HOLD, KNOWLEDGE, LETTER, LETTER_SECTIONS, NAMES, SETTINGS } from './layout'
import { formatK, frontmatter, openingParagraph, sections } from './markdown'
import { basename, dirname, join, resolvePath } from './paths'
import type { Project } from './project'
import { checkLetter, checkWork, checkWritten, ownerRevisionProblem } from './records'
import { archiveCall, readSaved, type SavedEntry, savedEntries, savedFiles } from './saved'
import { lastShifts, readRecords, recentShifts } from './store'
import { ACCEPTED, continuePrompt, deliveredFiles, EXCLUDED, NOT_IGNORED, resumePrompt, waitContext } from './texts/prompts'
import { CONTINUING, NOT_MADE, UNSETTLED, WAITING } from './texts/rows'
import type { HandedBack, PendingShift, SessionFile, Settled, ShiftInput, WaitNote, Work } from './types'

// The flows that do not depend on the harness: an adapter hands them the loaded project and what only it knows.

export type ShiftCall = { input: ShiftInput; at: number; sessionId: string }

// What the mod last saw of the records: per file, by its path from the project's root, its stamp and a fingerprint of
// its text as `<stamp>#<fingerprint>`.
export type Seen = Record<string, string>

// Who changed the records since the mod last looked: the agent's own tool — a write, a shell command, a script — or
// someone else between its tools: the owner's hand, another session.
export type ChangedBy = 'agent' | 'other'

// The records changed since the mod last looked, each checked by the checks of its file, so what the shift would refuse
// is told as it is written, not hundreds of K later. The agent's own change is told only when broken; someone else's
// is told always, so the agent reads it before writing over it. The first look only remembers. Generated map and toc changes have their own delivery slot.
export type ConfirmedEdit = (path: string, current: string | null, previous: string | undefined) => boolean

export function recordFingerprint(project: Project, path: string, text: string): string {
  let observed = text
  if (path === project.settings.files.shift) observed = withMap(text, '').trim()
  else if (project.settings.docs.toc && isDoc(path, project.settings.docs.dirs)) observed = withToc(text) ?? text
  return String(textFingerprint(observed))
}

export async function changedRecords(
  project: Project,
  seen: Seen | null,
  by: ChangedBy,
  confirmed?: ConfirmedEdit,
): Promise<{ seen: Seen; body: string | null }> {
  if (!project.settings.enabled) return { seen: seen ?? {}, body: null }
  // A new stamp alone is not a change: a file rewritten with the same text, or edited and put back, says nothing.
  const now: Seen = Object.create(null)
  const changed: string[] = []
  const external = new Set<string>()
  const records = watchedFiles(project)
  for (const [path, stamp] of Object.entries(await recordStamps(project, records))) {
    const was = seen && Object.hasOwn(seen, path) ? (seen[path] ?? '') : ''
    const at = was.lastIndexOf('#')
    if (at !== -1 && was.slice(0, at) === stamp) {
      now[path] = was
      continue
    }
    const text = await project.store.read(`${project.root}/${path}`)
    if (text === null) continue
    const hash = recordFingerprint(project, path, text)
    now[path] = `${stamp}#${hash}`
    const generated = !was && path === project.settings.files.shift && withMap(text, '').trim() === withMap(null, '').trim()
    if (seen !== null && was.slice(at + 1) !== hash && !generated) {
      changed.push(path)
      if (by === 'other' && !confirmed?.(path, text, was ? was.slice(at + 1) : undefined)) external.add(path)
    }
  }
  const lines: string[] = []
  if (by === 'other' && seen) {
    for (const path of Object.keys(seen))
      if (
        !(path in now) &&
        (records.has(path) || (dirname(path) === KNOWLEDGE && path.endsWith('.md'))) &&
        !(await project.store.exists(`${project.root}/${path}`)) &&
        !confirmed?.(path, null, seen[path]?.split('#').pop())
      )
        lines.push(`\`${path}\` was removed outside your tools.`)
  }
  if (changed.length === 0) return { seen: now, body: lines.join('\n') || null }

  const work = await readRecords(project)
  let broken = false
  for (const path of changed) {
    const problem = path === LETTER ? await letterProblem(project) : work === null ? null : checkWritten(path, work, project)
    broken ||= problem !== null
    if (external.has(path))
      lines.push(`\`${path}\` changed outside your tools — by the owner or another session: read it before you write it.`)
    if (problem !== null) lines.push(`\`${path}\`: ${problem}`)
  }
  if (broken) lines.push('The shift refuses until they are fixed; if you are still writing them, go on.')

  return { seen: now, body: lines.length === 0 ? null : lines.join('\n') }
}

function watchedFiles({ settings }: Project): Set<string> {
  return new Set([BOARD, LETTER, SETTINGS, settings.files.owner, settings.files.glossary, settings.files.shift, ...settings.files.always])
}

// Every file the record checks look at, by its path from the project's root, with its stamp: a listing per folder,
// no file read.
async function recordStamps(project: Project, own: Set<string>): Promise<Seen> {
  const { store, root } = project
  const stamped = async (dir: string, only?: (name: string) => boolean): Promise<Seen> =>
    Object.fromEntries(
      Object.entries(await store.stamps(join(root, dir)))
        .filter(([name]) => (only ? only(name) : name.endsWith('.md')))
        .map(([name, stamp]) => [join(dir, name), stamp]),
    )
  const parts = await Promise.all([
    ...[...new Set([...own].map(dirname))].map(dir => stamped(dir, name => own.has(join(dir, name)))),
    stamped(KNOWLEDGE),
  ])

  return Object.assign({}, ...parts)
}

// FNV-1a over the text: whether a file restamped really changed, without keeping its text.
export function textFingerprint(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)

  return hash >>> 0
}

async function letterProblem({ store, root }: Project): Promise<string | null> {
  const letter = await store.read(`${root}/${LETTER}`)

  return letter === null ? null : checkLetter(letter)
}

// Checks the letter and the records, saves them together as a pending entry in the archive.
export async function acceptShift(project: Project, call: ShiftCall): Promise<{ deny: string } | { shift: PendingShift; result: string }> {
  const { store, root, settings } = project
  const { input } = call
  const stale = await staleLayout(project)
  if (stale !== null) return { deny: stale }
  const letter = await store.read(resolvePath(root, input.letter))
  if (letter === null) return { deny: `No letter at ${input.letter}. Write it (usually ${LETTER}) and call again.` }
  const letterProblem = checkLetter(letter)
  if (letterProblem !== null) return { deny: letterProblem }

  const parts = sections(letter)
  const opening = parts.get(LETTER_SECTIONS[0]) ?? ''
  const description = input.about ?? openingParagraph(opening)
  if (!description) return { deny: 'Start "Where I am" with a paragraph describing the work and its outcome.' }
  if (description.length > ABOUT_MAX)
    return { deny: `Shorten the opening paragraph of "Where I am" to ${ABOUT_MAX} characters. Keep further details in the next paragraph.` }

  if (settings.enabled) await refreshDocs(project)
  const work = await readRecords(project)
  if (work === null) return { deny: `No board: create ${BOARD} by the sections in ${GUIDE_TOOL} and call again.` }
  const entries = await savedEntries(project)
  const workProblem = await currentWorkProblem(project, work, entries)
  if (workProblem !== null) return { deny: workProblem }
  const kept = await keepRecordsOut(project)
  if ('deny' in kept) return kept

  const shift: PendingShift = {
    after: input.after,
    letter,
    hold: parts.get(HOLD) ?? '',
    dir: '',
    board: `${root}/${BOARD}`,
    owner: `${root}/${settings.files.owner}`,
    sessionId: call.sessionId,
    about: description,
    at: call.at,
  }
  const about = renderAbout({ ...shift, result: OUTCOME.pending })
  const files = savedFiles(work, letter, project.settingsText)
  const previous = entries.toReversed().find(e => e.state === 'complete' && readAbout(e.about).session === call.sessionId)
  shift.dir = await archiveCall<string>(project, {
    action: 'begin',
    ...(project.working ? { expected: await project.working.revisions(), session: project.working.session } : {}),
    key: JSON.stringify([call.sessionId, call.at]),
    files,
    about,
    compare: previous?.id,
  })
  if (!shift.dir) return { deny: 'Nothing changed in the records since the last shift. Record progress before shifting.' }
  const earlier = entries.find(e => e.id === shift.dir)
  if (earlier) shift.at = Date.parse(frontmatter(earlier.about).get('at') ?? '')
  const accepted = ACCEPTED(shift.dir, input.after)

  return { shift, result: kept.excluded === null ? accepted : `${EXCLUDED(kept.excluded)}\n\n${accepted}` }
}

export async function currentWorkProblem(project: Project, work: Work, entries?: SavedEntry[]) {
  return checkWork(work, project) ?? ownerRevisionProblem(project, work.owner, entries)
}

export async function shiftHistory(project: Project, count: number): Promise<string> {
  const { entries, total } = await lastShifts(project, count)

  return renderHistory(entries, total)
}

// Prefer the letter waiting for this chat. Otherwise restore the newest saved letter.
export async function resumeShift(project: Project, actor = project.actor): Promise<{ text: string; prompt?: string; waiting?: string }> {
  const entries = await savedEntries(project)
  const newest = entries.at(-1)
  if (newest) {
    const waiting = actor ? await archiveCall<string>(project, { action: 'waiting', session: project.deliveryKey ?? actor }) : ''
    const saved = await readSaved(project, waiting || newest.id, NAMES.letter)
    const letter = saved.files[NAMES.letter]
    if (letter === undefined) throw new Error(`Missing letter in saved shift ${saved.id}.`)
    const about = readAbout(saved.about)
    return {
      text: `Picking up shift ${saved.id}.`,
      ...(waiting ? { waiting } : {}),
      prompt: resumePrompt(letter, await handBack(project, saved.id, actor, !!waiting), about.shifted ? null : about.result),
    }
  }
  return { text: 'No shifts in this project yet.' }
}

// The records, the last shifts and the documents' remarks as they are now, for the message after a shift. A harness
// that carries the message into the replacement history reads them before the let-go, not after it.
export async function handBack(project: Project, dir: string, actor?: string, preview = true): Promise<HandedBack> {
  return {
    work: await readRecords(project),
    knowledge: project.settings.knowledge,
    owner: project.settings.files.owner,
    recent: await recentShifts(project, dir, project.deliveryKey ?? actor, preview),
    dir,
    remarks: await docsReport(project),
  }
}

// The harness did not let the history go: about.md says why, the row tells the owner — even when about.md fails.
export async function shiftNotMade(project: Project, shift: PendingShift, why: string, tokensBefore: number | undefined): Promise<string> {
  const row = NOT_MADE(basename(shift.dir), why)

  return recordFailure(project, shift, renderAbout({ ...shift, tokensBefore, result: OUTCOME.notShifted(why) }), row)
}

// The harness let the history go, but what follows failed: about.md and the row say so, the letter stays on disk.
export async function shiftUnsettled(
  project: Project,
  shift: PendingShift,
  why: string,
  tokensBefore: number | undefined,
): Promise<string> {
  const row = UNSETTLED(basename(shift.dir), why)

  return recordFailure(project, shift, renderAbout({ ...shift, tokensBefore, result: OUTCOME.unsettled(why) }), row)
}

// A failure's about.md, written before the row is told; a failed write still leaves the row.
async function recordFailure(project: Project, shift: PendingShift, about: string, row: string): Promise<string> {
  try {
    await archiveCall(project, {
      action: 'finish',
      id: shift.dir,
      state: readAbout(about).result?.startsWith('not shifted') ? 'failed' : 'unsettled',
      about,
      limit: project.settings.historyLimit,
    })

    return row
  } catch (error) {
    return `${row} (and ${NAMES.about} was not written: ${String(error)})`
  }
}

export type LetGo = {
  shift: PendingShift
  carried?: boolean | undefined
  parkWait?(note: WaitNote): Promise<void>
  // What the history was let go into, as the harness gives it back.
  messages: readonly { role: string; text: string }[]
  before: number | undefined
  after: number | undefined
}

// After the let-go: the summary and the outcome on disk, then continue or wait, as the agent asked. `back` is what
// the message hands back, read before the let-go when the harness carries it into the replacement history.
export async function settleShift(project: Project, letGo: LetGo, back?: HandedBack): Promise<Settled> {
  const { shift, before, after } = letGo
  const summary = renderSummary(letGo.messages)
  const shrank = `${before === undefined ? '?' : formatK(before)} → ${after === undefined ? '?' : formatK(after)}`
  const outcome = (result: string) => {
    const about = renderAbout({ ...shift, tokensBefore: before, tokensAfter: after, summaryChars: summary.length, result })
    return archiveCall(project, {
      action: 'finish',
      id: shift.dir,
      state: 'complete',
      session: project.deliveryKey ?? shift.sessionId,
      wait: !letGo.carried,
      about,
      files: { [NAMES.summary]: summary },
      limit: project.settings.historyLimit,
    })
  }
  const handed = back ?? (await handBack(project, shift.dir, shift.sessionId))
  const name = basename(shift.dir)

  const files = deliveredFiles(handed.work)
  if (shift.after === 'continue') {
    await outcome(OUTCOME.continuing(shrank))
    const prompt = continuePrompt(shift.letter, handed)

    return { after: 'continue', prompt, note: { context: prompt, dir: shift.dir, files }, row: CONTINUING(name, shrank, shift.dir) }
  }

  const note = { context: waitContext(shift.letter, handed), dir: shift.dir, files }
  // Publish the waiting outcome only once a harness with durable thread history has parked the letter.
  await letGo.parkWait?.(note)
  await outcome(OUTCOME.waiting(shrank, 'waiting for the owner'))

  return { after: 'wait', note, row: WAITING(name, shrank) }
}

// The fill the stretch started from, if the last shift that let the history go was this session's: a fresh process
// counts from there. A shift not made, or still pending, left the history as it was and is passed over.
export async function shiftBase(project: Project, sessionId: string): Promise<number | null> {
  const entries = await savedEntries(project)
  const last = entries.toReversed().find(e => e.state === 'complete' && readAbout(e.about).session === sessionId)
  return last ? shiftFill(last.about, sessionId) : null
}

// Unless the owner lets the project commit them, the records stay out of its git: when they are not ignored, the mod
// adds them to the repository's own exclude file. The exclude file's path when it did; null when nothing was needed.
export async function keepRecordsOut(project: Project): Promise<{ excluded: string | null } | { deny: string }> {
  const { store, root } = project
  if (project.settings.commit) return { excluded: null }
  // 1 — not ignored; any other answer, or no git at all, means nothing to keep the records out of.
  const ignored = await store.git(root, ['check-ignore', '-q', DIR])
  if (ignored === null || ignored.code !== 1) return { excluded: null }
  // git names it relative to the root, or absolute in a linked worktree.
  const found = await store.git(root, ['rev-parse', '--git-path', 'info/exclude'])
  const path = found === null || found.code !== 0 ? '' : found.stdout.trim()
  if (path === '') return { deny: NOT_IGNORED }
  const file = path.startsWith('/') ? path : `${root}/${path}`
  const text = (await store.read(file)) ?? ''
  await store.write(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${DIR}/\n`)

  return { excluded: file }
}

// Version of the rendered file block retained across a host restart. Earlier blocks contain a live task list.
export const SESSION_FILES_VERSION = 5

// What comes into every session: SHIFT.md with a fresh map of the docs, OWNER.md, GLOSSARY.md, with
// paths from the project's root; none when the mod is off here. `refresh: false` reads them as they are, writing nothing.
export async function sessionFiles(project: Project, { refresh = true }: { refresh?: boolean } = {}): Promise<SessionFile[]> {
  const { store, root, settings } = project
  if (!settings.enabled || (await staleLayout(project)) !== null) return []
  if (refresh) await refreshDocs(project)
  const paths = [...new Set([settings.files.shift, settings.files.owner, settings.files.glossary, ...settings.files.always])]
  const loaded = await Promise.all(paths.map(async path => ({ path, text: await store.read(`${root}/${path}`) })))
  return loaded.filter((file): file is SessionFile => file.text !== null)
}

// Avoid writing the documentation map into another tool’s workspace at the same path.
export async function staleLayout({ store, root }: Project): Promise<string | null> {
  if ((await store.exists(`${root}/${DIR}/sessions`)) && !(await store.exists(`${root}/${BOARD}`))) {
    return `${DIR}/ here is the shift skill's: it has sessions/ and no board. Check the project root before using Shift here.`
  }

  return null
}

// The display command points to the same private CLI used for ordinary task work.
export async function tasksView(project: Project): Promise<string> {
  try {
    return `Run ${await installTaskCommand(project)} list from the project root to see tasks.`
  } catch (error) {
    return `${taskInstructions()}\n${String(error)}`
  }
}
