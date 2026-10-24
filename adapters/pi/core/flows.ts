// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { addToIndex, checkArchive, indexLine } from './archive'
import { docsReport, refreshTocs } from './doccare'
import { refreshMap } from './docs'
import { shiftFill } from './hint'
import { renderAbout, renderHistory, renderSummary, segment, shiftDir } from './history'
import { resolvePath } from './input'
import { ARCHIVE, BOARD, DIR, GUIDE_TOOL, INDEX, LETTER, MAX_AUTO_STREAK, OLD_DIR, TASK_LIST, TASKS } from './layout'
import { formatK, sections } from './markdown'
import { checkLetter, checkWork } from './records'
import type { Settings } from './settings'
import { DEFAULT_SETTINGS, parseSettings, readSettings } from './settings'
import type { Store } from './store'
import { lastShifts, previousShift, readProject, readSnapshot, recentShifts } from './store'
import { archiveInList, parseTaskList } from './tasks'
import { ACCEPTED, ARCHIVED, continuePrompt, deliveredFiles, EXCLUDED, NOT_IGNORED, resumePrompt, waitContext } from './texts/prompts'
import { CONTINUING, NOT_MADE, WAITING } from './texts/rows'
import type { ArchiveInput, PendingShift, SessionFile, Settled, ShiftInput, TaskFiles } from './types'

// The flows that do not depend on the harness: an adapter hands them its store and what only it knows.

export type ShiftCall = { root: string; input: ShiftInput; at: number; sessionId: string }

// Checks the letter and the records, snapshots them into the new shift folder and leaves a pending about.md there.
export async function acceptShift(store: Store, call: ShiftCall): Promise<{ deny: string } | { shift: PendingShift; result: string }> {
  const { root, input } = call
  const stale = await staleLayout(store, root)
  if (stale !== null) return { deny: stale }
  const letter = await store.read(resolvePath(root, input.letter))
  if (letter === null) return { deny: `No letter at ${input.letter}. Write it (usually ${LETTER}) and call again.` }
  const letterProblem = checkLetter(letter)
  if (letterProblem !== null) return { deny: letterProblem }

  const { settings: current } = await readSettings(store, root)
  if (current.enabled) {
    await refreshTocs(store, root, current.docs)
    await refreshMap(store, root, current.files.shift, current.docs)
  }
  const work = await readProject(store, root)
  if (work === null) return { deny: `No board: create ${BOARD} by the sections in ${GUIDE_TOOL} and call again.` }
  const previousDir = await previousShift(store, root)
  const previous = previousDir === null ? null : await readSnapshot(store, previousDir, `${previousDir}/index.md`)
  const workProblem = checkWork(work, previous?.work ?? null)
  if (workProblem !== null) return { deny: workProblem }
  const settings = work.settings === null ? DEFAULT_SETTINGS : parseSettings(work.settings)
  const kept = await keepRecordsOut(store, root, typeof settings === 'string' ? DEFAULT_SETTINGS : settings)
  if ('deny' in kept) return kept

  const index = await store.read(`${root}/${INDEX}`)
  const dir = shiftDir(root, call.at)
  const shift: PendingShift = {
    after: input.after,
    letter,
    hold: sections(letter).get('Hold') ?? '',
    dir,
    board: `${root}/${BOARD}`,
    sessionId: call.sessionId,
    about: input.about,
    at: call.at,
    segment: segment({ work, index }, previous),
  }
  await store.write(`${dir}/letter.md`, letter)
  await store.write(`${dir}/board.md`, work.board)
  if (index !== null) await store.write(`${dir}/index.md`, index)
  for (const task of work.tasks) {
    if (task.task !== null) await store.write(`${dir}/tasks/${task.name}/task.md`, task.task)
    if (task.track !== null) await store.write(`${dir}/tasks/${task.name}/track.md`, task.track)
  }
  if (work.owner !== null) await store.write(`${dir}/OWNER.md`, work.owner)
  if (work.taskList !== null) await store.write(`${dir}/TASKS.md`, work.taskList)
  if (work.glossary !== null) await store.write(`${dir}/GLOSSARY.md`, work.glossary)
  if (work.shift !== null) await store.write(`${dir}/SHIFT.md`, work.shift)
  if (work.settings !== null) await store.write(`${dir}/settings.toml`, work.settings)
  for (const file of work.knowledge) await store.write(`${dir}/knowledge/${file.name}`, file.text)
  // Rewritten with the outcome once the turn ends; `pending` stays if the session dies first.
  await store.write(`${dir}/about.md`, renderAbout({ ...shift, result: 'pending' }))

  return { shift, result: kept.excluded === null ? ACCEPTED(dir) : `${EXCLUDED(kept.excluded)}\n\n${ACCEPTED(dir)}` }
}

// Moves a finished or dropped task's folder to the archive and adds its line to the index.
export async function archiveTask(store: Store, root: string, input: ArchiveInput): Promise<{ deny: string } | { result: string }> {
  const from = `${root}/${TASKS}/${input.name}`
  const to = `${root}/${ARCHIVE}/${input.name}`
  const task: TaskFiles = {
    name: input.name,
    task: await store.read(`${from}/task.md`),
    track: await store.read(`${from}/track.md`),
  }
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

export async function shiftHistory(store: Store, root: string, count: number): Promise<string> {
  const { entries, total } = await lastShifts(store, root, count)

  return renderHistory(entries, total)
}

// The last shift picked up in a session that has not seen it: the text for the owner, and the prompt when there is one.
export async function resumeShift(store: Store, root: string): Promise<{ text: string; prompt?: string }> {
  const dir = await previousShift(store, root)
  if (dir === null) return { text: `No shifts in this project: ${DIR}/shifts/ is empty.` }
  const letter = await store.read(`${dir}/letter.md`)
  if (letter === null) return { text: `No letter.md in ${dir}/ — nothing to pick up.` }

  const work = await readProject(store, root)
  const recent = await recentShifts(store, root)

  const remarks = await docsReport(store, root)

  return { text: `Picking up shift ${dir.split('/').at(-1)}.`, prompt: resumePrompt(letter, work, recent, dir, remarks) }
}

// The harness did not let the history go: about.md says why, the row tells the owner.
export async function shiftNotMade(store: Store, shift: PendingShift, why: string, tokensBefore: number | undefined): Promise<string> {
  await store.write(`${shift.dir}/about.md`, renderAbout({ ...shift, tokensBefore, result: `not shifted: ${why}` }))

  return NOT_MADE(shiftName(shift), why)
}

export type LetGo = {
  root: string
  shift: PendingShift
  // What the history was let go into, as the harness gives it back.
  messages: readonly { role: string; text: string }[]
  before: number | undefined
  after: number
  // `continue` shifts in a row without the owner before this one.
  streak: number
}

// After the let-go: the summary and the outcome on disk, then continue, or wait — asked for, or forced after
// `MAX_AUTO_STREAK` continues in a row without the owner.
export async function settleShift(store: Store, letGo: LetGo): Promise<Settled> {
  const { root, shift, before, after } = letGo
  const summary = renderSummary(letGo.messages)
  await store.write(`${shift.dir}/summary.md`, summary)
  const streak = letGo.streak + 1
  const isCapped = shift.after === 'continue' && streak > MAX_AUTO_STREAK
  const shrank = `${formatK(before ?? 0)} → ${formatK(after)}`
  const outcome = (result: string) =>
    store.write(
      `${shift.dir}/about.md`,
      renderAbout({ ...shift, tokensBefore: before, tokensAfter: after, summaryChars: summary.length, result }),
    )
  const work = await readProject(store, root)
  const recent = await recentShifts(store, root)
  const remarks = await docsReport(store, root)
  const name = shiftName(shift)

  if (shift.after === 'continue' && !isCapped) {
    await outcome(`shifted (${shrank}), continuing`)

    return {
      after: 'continue',
      streak,
      prompt: continuePrompt(shift.letter, work, recent, shift.dir, remarks),
      row: CONTINUING(name, shrank, shift.dir),
    }
  }

  const why = isCapped ? `waiting: ${MAX_AUTO_STREAK} shifts in a row without the owner` : 'waiting for the owner'
  await outcome(`shifted (${shrank}), ${why}`)
  const note = { context: waitContext(shift.letter, work, recent, shift.dir, remarks), dir: shift.dir, files: deliveredFiles(work) }

  return { after: 'wait', note, row: WAITING(name, shrank, isCapped) }
}

// The fill the stretch started from, if the last shift was this session's: a fresh process counts from there.
export async function shiftBase(store: Store, root: string, sessionId: string): Promise<number | null> {
  const dir = await previousShift(store, root)
  const about = dir === null ? null : await store.read(`${dir}/about.md`)

  return about === null ? null : shiftFill(about, sessionId)
}

// Unless the owner lets the project commit them, the records stay out of its git: when they are not ignored, the mod
// adds them to the repository's own exclude file. The exclude file's path when it did; null when nothing was needed.
export async function keepRecordsOut(
  store: Store,
  root: string,
  settings: Settings,
): Promise<{ excluded: string | null } | { deny: string }> {
  if (settings.commit || (await store.isIgnored(root, DIR))) return { excluded: null }
  const file = await store.excludeFile(root)
  if (file === null) return { deny: NOT_IGNORED }
  const text = (await store.read(file)) ?? ''
  await store.write(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${DIR}/\n`)

  return { excluded: file }
}

// What comes into every session: SHIFT.md with a fresh map of the docs, OWNER.md, GLOSSARY.md and TASKS.md, with
// paths from the project's root; none when the mod is off here.
export async function sessionFiles(store: Store, root: string): Promise<SessionFile[]> {
  const { settings } = await readSettings(store, root)
  if (!settings.enabled || (await staleLayout(store, root)) !== null) return []
  await refreshTocs(store, root, settings.docs)
  await refreshMap(store, root, settings.files.shift, settings.docs)
  const paths = [settings.files.shift, settings.files.owner, settings.files.glossary, TASK_LIST, ...settings.files.always]
  const files = await Promise.all(paths.map(async path => ({ path, text: await store.read(`${root}/${path}`) })))

  return files.filter((file): file is SessionFile => file.text !== null)
}

// Records the mod cannot work on yet: an older name of its folder, or the folder the shift skill left. Then the mod writes
// nothing — a map appended to the skill's own SHIFT.md would come into every session — and says what to move.
export async function staleLayout(store: Store, root: string): Promise<string | null> {
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

function shiftName(shift: PendingShift): string {
  return shift.dir.split('/').at(-1) ?? shift.dir
}
