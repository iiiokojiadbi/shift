// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { addToIndex, checkArchive, indexLine } from './archive'
import { shiftFill } from './hint'
import { renderAbout, renderHistory, renderSummary, segment, shiftDir } from './history'
import { resolvePath } from './input'
import { ARCHIVE, BOARD, DIR, GUIDE_TOOL, INDEX, LETTER, MAX_AUTO_STREAK, TASKS } from './layout'
import { formatK, sections } from './markdown'
import { checkLetter, checkWork } from './records'
import type { Store } from './store'
import { lastShifts, previousShift, readSnapshot, readWork, recentShifts } from './store'
import { ACCEPTED, ARCHIVED, continuePrompt, deliveredFiles, NOT_IGNORED, resumePrompt, waitContext } from './texts/prompts'
import { CONTINUING, NOT_MADE, WAITING } from './texts/rows'
import type { ArchiveInput, PendingShift, Settled, ShiftInput, TaskFiles } from './types'

// The flows that do not depend on the harness: an adapter hands them its store and what only it knows.

export type ShiftCall = { root: string; input: ShiftInput; at: number; sessionId: string }

// Checks the letter and the records, snapshots them into the new shift folder and leaves a pending about.md there.
export async function acceptShift(store: Store, call: ShiftCall): Promise<{ deny: string } | { shift: PendingShift; result: string }> {
  const { root, input } = call
  const letter = await store.read(resolvePath(root, input.letter))
  if (letter === null) return { deny: `No letter at ${input.letter}. Write it (usually ${LETTER}) and call again.` }
  const letterProblem = checkLetter(letter)
  if (letterProblem !== null) return { deny: letterProblem }

  const work = await readWork(store, `${root}/${DIR}`)
  if (work === null) return { deny: `No board: create ${BOARD} by the sections in ${GUIDE_TOOL} and call again.` }
  const previousDir = await previousShift(store, root)
  const previous = previousDir === null ? null : await readSnapshot(store, previousDir, `${previousDir}/index.md`)
  const workProblem = checkWork(work, previous?.work ?? null)
  if (workProblem !== null) return { deny: workProblem }
  if (!(await store.isIgnored(root, DIR))) return { deny: NOT_IGNORED }

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
  if (work.owner !== null) await store.write(`${dir}/owner.md`, work.owner)
  if (work.settings !== null) await store.write(`${dir}/settings.toml`, work.settings)
  for (const file of work.knowledge) await store.write(`${dir}/knowledge/${file.name}`, file.text)
  // Rewritten with the outcome once the turn ends; `pending` stays if the session dies first.
  await store.write(`${dir}/about.md`, renderAbout({ ...shift, result: 'pending' }))

  return { shift, result: ACCEPTED(dir) }
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

  const failed = await store.move(from, to)
  if (failed !== null) return { deny: `Could not move ${from} to ${to}: ${failed}` }
  const index = await store.read(`${root}/${INDEX}`)
  await store.write(`${root}/${INDEX}`, addToIndex(index, indexLine(input, task.task ?? '')))

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

  const work = await readWork(store, `${root}/${DIR}`)
  const recent = await recentShifts(store, root)

  return { text: `Picking up shift ${dir.split('/').at(-1)}.`, prompt: resumePrompt(letter, work, recent, dir) }
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
  const work = await readWork(store, `${root}/${DIR}`)
  const recent = await recentShifts(store, root)
  const name = shiftName(shift)

  if (shift.after === 'continue' && !isCapped) {
    await outcome(`shifted (${shrank}), continuing`)

    return {
      after: 'continue',
      streak,
      prompt: continuePrompt(shift.letter, work, recent, shift.dir),
      row: CONTINUING(name, shrank, shift.dir),
    }
  }

  const why = isCapped ? `waiting: ${MAX_AUTO_STREAK} shifts in a row without the owner` : 'waiting for the owner'
  await outcome(`shifted (${shrank}), ${why}`)
  const note = { context: waitContext(shift.letter, work, recent, shift.dir), dir: shift.dir, files: deliveredFiles(work) }

  return { after: 'wait', note, row: WAITING(name, shrank, isCapped) }
}

// The fill the stretch started from, if the last shift was this session's: a fresh process counts from there.
export async function shiftBase(store: Store, root: string, sessionId: string): Promise<number | null> {
  const dir = await previousShift(store, root)
  const about = dir === null ? null : await store.read(`${dir}/about.md`)

  return about === null ? null : shiftFill(about, sessionId)
}

function shiftName(shift: PendingShift): string {
  return shift.dir.split('/').at(-1) ?? shift.dir
}
