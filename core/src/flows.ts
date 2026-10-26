import { OUTCOME, readAbout, renderAbout, shiftFill } from './about'
import { addToIndex, checkArchive, indexLine } from './archive'
import { docsReport, refreshDocs } from './docs'
import { renderHistory, renderSummary, segment, shiftDir } from './history'
import {
  ARCHIVE,
  BOARD,
  CLOSED,
  DIR,
  GUIDE_TOOL,
  HOLD,
  INDEX,
  KNOWLEDGE,
  LETTER,
  NAMES,
  OLD_DIR,
  SETTINGS,
  SHIFTS,
  STUCK_LOOKBACK,
  STUCK_SHIFTS,
  TASK_LIST,
  TASK_SECTIONS,
  TASKS,
  TRACK_TOOL,
  taskFile,
} from './layout'
import { formatItem, formatK, itemsOf, sections } from './markdown'
import { basename, dirname, join, resolvePath } from './paths'
import type { Project } from './project'
import { checkLetter, checkTask, checkWork, checkWritten, listedTasks } from './records'
import { lastShifts, previousShift, readRecords, readSnapshot, readTask, recentShifts, shiftNames, writeSnapshot } from './store'
import { archiveInList, checkTaskList, formatTaskLine, parseTaskList, withTask } from './tasks'
import {
  ACCEPTED,
  ARCHIVED,
  continuePrompt,
  deliveredFiles,
  EXCLUDED,
  NOT_IGNORED,
  OPENED,
  resumePrompt,
  waitContext,
} from './texts/prompts'
import { CONTINUING, NOT_MADE, renderTasks, type TaskView, UNSETTLED, WAITING } from './texts/rows'
import { numberTracks } from './track'
import type { ArchiveInput, HandedBack, OpenInput, PendingShift, SessionFile, Settled, ShiftInput, Stuck, TaskFiles, Work } from './types'

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
// is told always, so the agent reads it before writing over it. The first look only remembers; a removed file is the
// shift's to tell.
export async function changedRecords(project: Project, seen: Seen | null, by: ChangedBy): Promise<{ seen: Seen; body: string | null }> {
  if (!project.settings.enabled) return { seen: seen ?? {}, body: null }
  // A new stamp alone is not a change: a file rewritten with the same text, or edited and put back, says nothing.
  const now: Seen = {}
  const changed: string[] = []
  for (const [path, stamp] of Object.entries(await recordStamps(project))) {
    const was = seen?.[path] ?? ''
    const at = was.lastIndexOf('#')
    if (at !== -1 && was.slice(0, at) === stamp) {
      now[path] = was
      continue
    }
    const text = await project.store.read(`${project.root}/${path}`)
    if (text === null) continue
    const hash = String(fingerprint(text))
    now[path] = `${stamp}#${hash}`
    if (seen !== null && was.slice(at + 1) !== hash) changed.push(path)
  }
  if (changed.length === 0) return { seen: now, body: null }

  const work = await readRecords(project)
  const lines: string[] = []
  let broken = false
  for (const path of changed) {
    const problem = path === LETTER ? await letterProblem(project) : work === null ? null : checkWritten(path, work, project)
    broken ||= problem !== null
    if (by === 'other') lines.push(`\`${path}\` changed outside your tools — by the owner or another session: read it before you write it.`)
    if (problem !== null) lines.push(`\`${path}\`: ${problem}`)
  }
  if (broken) lines.push('The shift refuses until they are fixed; if you are still writing them, go on.')

  return { seen: now, body: lines.length === 0 ? null : lines.join('\n') }
}

// Every file the record checks look at, by its path from the project's root, with its stamp: a listing per folder,
// no file read.
async function recordStamps({ store, root, settings }: Project): Promise<Seen> {
  const stamped = async (dir: string, only?: (name: string) => boolean): Promise<Seen> =>
    Object.fromEntries(
      Object.entries(await store.stamps(join(root, dir)))
        .filter(([name]) => (name.endsWith('.md') || join(dir, name) === SETTINGS) && (only?.(name) ?? true))
        .map(([name, stamp]) => [join(dir, name), stamp]),
    )
  const own = new Set([BOARD, TASK_LIST, LETTER, SETTINGS, settings.files.owner, settings.files.glossary])
  const tasks = await store.list(`${root}/${TASKS}`, 'dir')
  const parts = await Promise.all([
    ...[...new Set([DIR, dirname(settings.files.owner), dirname(settings.files.glossary)])].map(dir =>
      stamped(dir, name => own.has(join(dir, name))),
    ),
    ...tasks.flatMap(name => [
      stamped(`${TASKS}/${name}`, file => file === NAMES.task || file === NAMES.track),
      stamped(`${TASKS}/${name}/${NAMES.notes}`),
    ]),
    stamped(KNOWLEDGE),
  ])

  return Object.assign({}, ...parts)
}

// FNV-1a over the text: whether a file restamped really changed, without keeping its text.
function fingerprint(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)

  return hash >>> 0
}

async function letterProblem({ store, root }: Project): Promise<string | null> {
  const letter = await store.read(`${root}/${LETTER}`)

  return letter === null ? null : checkLetter(letter)
}

// Checks the letter and the records, snapshots them into the new shift folder and leaves a pending about.md there.
export async function acceptShift(project: Project, call: ShiftCall): Promise<{ deny: string } | { shift: PendingShift; result: string }> {
  const { store, root, settings } = project
  const { input } = call
  const stale = await staleLayout(project)
  if (stale !== null) return { deny: stale }
  const letter = await store.read(resolvePath(root, input.letter))
  if (letter === null) return { deny: `No letter at ${input.letter}. Write it (usually ${LETTER}) and call again.` }
  const letterProblem = checkLetter(letter)
  if (letterProblem !== null) return { deny: letterProblem }

  if (settings.enabled) await refreshDocs(project)
  await numberTracks(project)
  const work = await readRecords(project)
  if (work === null) return { deny: `No board: create ${BOARD} by the sections in ${GUIDE_TOOL} and call again.` }
  const previousDir = await lastMadeShift(project)
  const previous = previousDir === null ? null : await readSnapshot(store, previousDir, `${previousDir}/${NAMES.index}`)
  const workProblem = checkWork(work, previous?.work ?? null, project)
  if (workProblem !== null) return { deny: workProblem }
  const kept = await keepRecordsOut(project)
  if ('deny' in kept) return kept

  const index = await store.read(`${root}/${INDEX}`)
  const dir = await freeShiftDir(project, shiftDir(root, call.at))
  const shift: PendingShift = {
    after: input.after,
    letter,
    hold: sections(letter).get(HOLD) ?? '',
    dir,
    board: `${root}/${BOARD}`,
    owner: `${root}/${settings.files.owner}`,
    sessionId: call.sessionId,
    about: input.about,
    at: call.at,
    segment: segment({ work, index }, previous),
    focus: focusOf(work),
  }
  await writeSnapshot(store, dir, { work, letter, index, settings: project.settingsText })
  // Rewritten with the outcome once the turn ends; `pending` stays if the session dies first.
  await store.write(`${dir}/${NAMES.about}`, renderAbout({ ...shift, result: OUTCOME.pending }))

  // Knowledge is rarely written: a stretch that added none is asked once, while its history is still whole.
  const learned = previous === null || knowledgeText(work) !== knowledgeText(previous.work)
  const accepted = ACCEPTED(dir, learned, input.after)

  return { shift, result: kept.excluded === null ? accepted : `${EXCLUDED(kept.excluded)}\n\n${accepted}` }
}

// The newest shift that let the history go, or may have: one not shifted left the records as they were, so an unchanged
// retry is no empty shift.
async function lastMadeShift(project: Project): Promise<string | null> {
  const names = await shiftNames(project)
  for (const name of names.toReversed()) {
    const dir = `${project.root}/${SHIFTS}/${name}`
    const about = await project.store.read(`${dir}/${NAMES.about}`)
    if (!(readAbout(about ?? '').result ?? '').startsWith(OUTCOME.notShifted(''))) return dir
  }

  return null
}

// Another session may shift in the same second: its folder is never shared, the next free name is taken.
async function freeShiftDir(project: Project, dir: string): Promise<string> {
  const taken = new Set(await shiftNames(project))
  const name = basename(dir)
  let free = name
  for (let n = 2; taken.has(free); n++) free = `${name}-${n}`

  return `${dirname(dir)}/${free}`
}

// The tasks in progress, each with the names of its items in progress.
function focusOf(work: Work): string[] {
  return listedTasks(work)
    .filter(listed => listed.status === 'in progress')
    .map(listed => {
      const track = work.tasks.find(task => task.name === listed.name)?.track ?? ''
      const doing = itemsOf(track)
        .filter(item => item.status === 'in progress')
        .map(item => item.name)

      return doing.length === 0 ? listed.name : `${listed.name}: ${doing.join('; ')}`
    })
}

function knowledgeText(work: Work): string {
  return work.knowledge.map(file => `${file.name}\n${file.text}`).join('\n')
}

// Moves a finished or dropped task's folder to the archive and adds its line to the index.
// A task opened valid by construction: task.md by its sections, track.md with its first items, and its line with the
// links in TASKS.md — all checked before anything is written, so a refusal leaves the records as they were.
export async function openTask(project: Project, input: OpenInput): Promise<{ deny: string } | { result: string }> {
  const { store, root } = project
  const folder = `${root}/${TASKS}/${input.name}`
  if (await store.exists(folder)) return { deny: `${TASKS}/${input.name}/ already exists: set its status with ${TRACK_TOOL}.` }
  const archived = await store.list(`${root}/${ARCHIVE}`, 'dir')
  if (archived.includes(input.name))
    return { deny: `${input.name} is archived: open a task under another name with continues: ${input.name}.` }
  const task: TaskFiles = {
    name: input.name,
    task: renderTask(input),
    track: input.items.map((item, n) => `${formatItem('open', n + 1, item.name, item.note)}\n`).join(''),
    notes: [],
  }
  const listPath = `${root}/${TASK_LIST}`
  const list = withTask(await store.read(listPath), input, archived)
  const folders = [...(await store.list(`${root}/${TASKS}`, 'dir')), input.name]
  const problem = checkTask(task) ?? checkTaskList(list, folders, archived)
  if (problem !== null) return { deny: `Nothing was written. ${problem}` }

  await store.write(`${folder}/${NAMES.task}`, task.task ?? '')
  await store.write(`${folder}/${NAMES.track}`, task.track ?? '')
  await store.write(listPath, list)

  return { result: OPENED(input.name, formatTaskLine(input.status, input.name, input.name, input.about), task.track ?? '') }
}

function renderTask(input: OpenInput): string {
  const body: Record<string, string> = { Goal: input.goal, 'Done when': input.doneWhen }

  return `# ${input.title}\n${TASK_SECTIONS.map(section => `\n## ${section}\n\n${body[section] ?? 'none'}\n`).join('')}`
}

export async function archiveTask(project: Project, input: ArchiveInput): Promise<{ deny: string } | { result: string }> {
  const { store, root } = project
  const from = `${root}/${TASKS}/${input.name}`
  const to = `${root}/${ARCHIVE}/${input.name}`
  const task = await readTask(store, `${root}/${DIR}`, input.name)
  const problem = checkArchive(input, task, await store.exists(to))
  if (problem !== null) return { deny: problem }

  const listPath = `${root}/${TASK_LIST}`
  const list = await store.read(listPath)
  const listed = list === null ? [] : parseTaskList(list)
  const entry = typeof listed === 'string' ? undefined : listed.find(t => t.name === input.name)
  const continued = (entry?.links ?? []).filter(link => link.kind === 'continues').map(link => link.name)

  const failed = await store.move(from, to)
  if (failed !== null) return { deny: `Could not move ${from} to ${to}: ${failed}` }
  const index = await store.read(`${root}/${INDEX}`)
  await store.write(`${root}/${INDEX}`, addToIndex(index, indexLine(input, task.task ?? '', continued)))
  if (list !== null) await store.write(listPath, archiveInList(list, input.name))

  return { result: ARCHIVED(input.name) }
}

export async function shiftHistory(project: Project, count: number): Promise<string> {
  const { entries, total } = await lastShifts(project, count)

  return renderHistory(entries, total)
}

// The last shift picked up in a session that has not seen it: the text for the owner, and the prompt when there is one.
export async function resumeShift(project: Project): Promise<{ text: string; prompt?: string }> {
  const dir = await previousShift(project)
  if (dir === null) return { text: `No shifts in this project: ${SHIFTS}/ is empty.` }
  const letter = await project.store.read(`${dir}/${NAMES.letter}`)
  if (letter === null) return { text: `No letter.md in ${dir}/ — nothing to pick up.` }

  return { text: `Picking up shift ${basename(dir)}.`, prompt: resumePrompt(letter, await handBack(project, dir)) }
}

// The records, the last shifts and the documents' remarks as they are now, for the message after a shift.
async function handBack(project: Project, dir: string): Promise<HandedBack> {
  return {
    work: await readRecords(project),
    knowledge: project.settings.knowledge,
    owner: project.settings.files.owner,
    recent: await recentShifts(project),
    dir,
    remarks: await docsReport(project),
    stuck: await stuckTasks(project),
  }
}

// The listed tasks whose task.md and track.md are the same in the latest shifts' snapshots as now, through at least
// STUCK_SHIFTS of them: counted from the snapshots, since the records carry no dates.
export async function stuckTasks(project: Project): Promise<Stuck[]> {
  const { store, root } = project
  const work = await readRecords(project)
  if (work === null) return []
  const shifts = (await shiftNames(project)).slice(-STUCK_LOOKBACK).reverse()
  const stuck: Stuck[] = []
  for (const listed of listedTasks(work)) {
    const now = work.tasks.find(task => task.name === listed.name)
    if (now === undefined) continue
    let count = 0
    for (const name of shifts) {
      const base = `${root}/${SHIFTS}/${name}`
      const same =
        (await store.read(taskFile(base, listed.name, 'task'))) === now.task &&
        (await store.read(taskFile(base, listed.name, 'track'))) === now.track
      if (!same) break
      count++
    }
    if (count >= STUCK_SHIFTS) stuck.push({ name: listed.name, status: listed.status, shifts: count })
  }

  return stuck
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
    await project.store.write(`${shift.dir}/${NAMES.about}`, about)

    return row
  } catch (error) {
    return `${row} (and ${NAMES.about} was not written: ${String(error)})`
  }
}

export type LetGo = {
  shift: PendingShift
  // What the history was let go into, as the harness gives it back.
  messages: readonly { role: string; text: string }[]
  before: number | undefined
  after: number
}

// After the let-go: the summary and the outcome on disk, then continue or wait, as the agent asked.
export async function settleShift(project: Project, letGo: LetGo): Promise<Settled> {
  const { store } = project
  const { shift, before, after } = letGo
  const summary = renderSummary(letGo.messages)
  await store.write(`${shift.dir}/${NAMES.summary}`, summary)
  const shrank = `${formatK(before ?? 0)} → ${formatK(after)}`
  const outcome = (result: string) =>
    store.write(
      `${shift.dir}/${NAMES.about}`,
      renderAbout({ ...shift, tokensBefore: before, tokensAfter: after, summaryChars: summary.length, result }),
    )
  const back = await handBack(project, shift.dir)
  const name = basename(shift.dir)

  const files = deliveredFiles(back.work)
  if (shift.after === 'continue') {
    await outcome(OUTCOME.continuing(shrank))
    const prompt = continuePrompt(shift.letter, back)

    return { after: 'continue', prompt, note: { context: prompt, dir: shift.dir, files }, row: CONTINUING(name, shrank, shift.dir) }
  }

  await outcome(OUTCOME.waiting(shrank, 'waiting for the owner'))
  const note = { context: waitContext(shift.letter, back), dir: shift.dir, files }

  return { after: 'wait', note, row: WAITING(name, shrank) }
}

// The fill the stretch started from, if the last shift was this session's: a fresh process counts from there.
export async function shiftBase(project: Project, sessionId: string): Promise<number | null> {
  const dir = await previousShift(project)
  const about = dir === null ? null : await project.store.read(`${dir}/${NAMES.about}`)

  return about === null ? null : shiftFill(about, sessionId)
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

// What comes into every session: SHIFT.md with a fresh map of the docs, OWNER.md, GLOSSARY.md and TASKS.md, with
// paths from the project's root; none when the mod is off here.
export async function sessionFiles(project: Project): Promise<SessionFile[]> {
  const { store, root, settings } = project
  if (!settings.enabled || (await staleLayout(project)) !== null) return []
  await refreshDocs(project)
  const paths = [settings.files.shift, settings.files.owner, settings.files.glossary, TASK_LIST, ...settings.files.always]
  const files = await Promise.all(paths.map(async path => ({ path, text: await store.read(`${root}/${path}`) })))

  return files.filter((file): file is SessionFile => file.text !== null)
}

// Records the mod cannot work on yet: an older name of its folder, or the folder the shift skill left. Then the mod writes
// nothing — a map appended to the skill's own SHIFT.md would come into every session — and says what to move.
export async function staleLayout({ store, root }: Project): Promise<string | null> {
  if (await store.exists(`${root}/${OLD_DIR}`)) {
    return (await store.exists(`${root}/${DIR}`))
      ? `Both ${OLD_DIR}/ and ${DIR}/ are here: the records live in ${DIR}/ now. Merge what ${OLD_DIR}/ holds into ${DIR}/ by ${GUIDE_TOOL}, then remove ${OLD_DIR}/.`
      : `The records are in ${OLD_DIR}/, the mod's old name: rename the folder to ${DIR}/ as it is, and call again.`
  }
  if ((await store.exists(`${root}/${DIR}/sessions`)) && !(await store.exists(`${root}/${BOARD}`))) {
    return `${DIR}/ here is the shift skill's: it has sessions/ and no board. Move it in place by "Coming from the shift skill" in ${GUIDE_TOOL}, then call again.`
  }

  return null
}

// What /shift-tasks shows: the open tasks as listed, with their items' count, and the items not closed of those in
// progress. Read only; a list the shift would refuse is shown as far as it parses.
export async function tasksView(project: Project): Promise<string> {
  const { store, root } = project
  const parsed = parseTaskList((await store.read(`${root}/${TASK_LIST}`)) ?? '')
  if (typeof parsed === 'string') return `${TASK_LIST}: ${parsed}`
  const views: TaskView[] = []
  for (const task of parsed) {
    const track = (await store.read(taskFile(`${root}/${DIR}`, task.name, 'track'))) ?? ''
    const items = itemsOf(track).filter(item => item.status !== '')
    const open = items.filter(item => !CLOSED.has(item.status))
    views.push({
      status: task.status,
      name: task.name,
      about: task.about,
      items:
        task.status === 'in progress'
          ? open.map(item => ({ status: item.status, name: item.id === null ? item.name : `#${item.id} ${item.name}` }))
          : null,
      closed: items.length - open.length,
      total: items.length,
    })
  }

  return renderTasks(views)
}
