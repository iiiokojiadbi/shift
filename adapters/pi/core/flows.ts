// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { addToIndex, checkArchive, indexLine } from './archive'
import { docsReport, refreshDocs } from './docs'
import { shiftFill } from './hint'
import { renderAbout, renderHistory, renderSummary, segment, shiftDir } from './history'
import { resolvePath } from './input'
import { ARCHIVE, BOARD, DIR, GUIDE_TOOL, INDEX, LETTER, MAX_AUTO_STREAK, OLD_DIR, TASK_LIST, TASKS } from './layout'
import { formatK, sections } from './markdown'
import type { Project } from './project'
import { checkLetter, checkWork } from './records'
import { lastShifts, previousShift, readRecords, readSnapshot, recentShifts } from './store'
import { archiveInList, parseTaskList } from './tasks'
import { ACCEPTED, ARCHIVED, continuePrompt, deliveredFiles, EXCLUDED, NOT_IGNORED, resumePrompt, waitContext } from './texts/prompts'
import { CONTINUING, NOT_MADE, WAITING } from './texts/rows'
import type { ArchiveInput, HandedBack, PendingShift, SessionFile, Settled, ShiftInput, TaskFiles } from './types'

// The flows that do not depend on the harness: an adapter hands them the loaded project and what only it knows.

export type ShiftCall = { input: ShiftInput; at: number; sessionId: string }

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
  const work = await readRecords(project)
  if (work === null) return { deny: `No board: create ${BOARD} by the sections in ${GUIDE_TOOL} and call again.` }
  const previousDir = await previousShift(project)
  const previous = previousDir === null ? null : await readSnapshot(store, previousDir, `${previousDir}/index.md`)
  const workProblem = checkWork(work, previous?.work ?? null, project)
  if (workProblem !== null) return { deny: workProblem }
  const kept = await keepRecordsOut(project)
  if ('deny' in kept) return kept

  const index = await store.read(`${root}/${INDEX}`)
  const dir = shiftDir(root, call.at)
  const shift: PendingShift = {
    after: input.after,
    letter,
    hold: sections(letter).get('Hold') ?? '',
    dir,
    board: `${root}/${BOARD}`,
    owner: `${root}/${settings.files.owner}`,
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
  if (project.settingsText !== null) await store.write(`${dir}/settings.toml`, project.settingsText)
  for (const file of work.knowledge) await store.write(`${dir}/knowledge/${file.name}`, file.text)
  // Rewritten with the outcome once the turn ends; `pending` stays if the session dies first.
  await store.write(`${dir}/about.md`, renderAbout({ ...shift, result: 'pending' }))

  return { shift, result: kept.excluded === null ? ACCEPTED(dir) : `${EXCLUDED(kept.excluded)}\n\n${ACCEPTED(dir)}` }
}

// Moves a finished or dropped task's folder to the archive and adds its line to the index.
export async function archiveTask(project: Project, input: ArchiveInput): Promise<{ deny: string } | { result: string }> {
  const { store, root } = project
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

export async function shiftHistory(project: Project, count: number): Promise<string> {
  const { entries, total } = await lastShifts(project, count)

  return renderHistory(entries, total)
}

// The last shift picked up in a session that has not seen it: the text for the owner, and the prompt when there is one.
export async function resumeShift(project: Project): Promise<{ text: string; prompt?: string }> {
  const dir = await previousShift(project)
  if (dir === null) return { text: `No shifts in this project: ${DIR}/shifts/ is empty.` }
  const letter = await project.store.read(`${dir}/letter.md`)
  if (letter === null) return { text: `No letter.md in ${dir}/ — nothing to pick up.` }

  return { text: `Picking up shift ${dir.split('/').at(-1)}.`, prompt: resumePrompt(letter, await handBack(project, dir)) }
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
  }
}

// The harness did not let the history go: about.md says why, the row tells the owner.
export async function shiftNotMade(project: Project, shift: PendingShift, why: string, tokensBefore: number | undefined): Promise<string> {
  await project.store.write(`${shift.dir}/about.md`, renderAbout({ ...shift, tokensBefore, result: `not shifted: ${why}` }))

  return NOT_MADE(shiftName(shift), why)
}

export type LetGo = {
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
export async function settleShift(project: Project, letGo: LetGo): Promise<Settled> {
  const { store } = project
  const { shift, before, after } = letGo
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
  const back = await handBack(project, shift.dir)
  const name = shiftName(shift)

  if (shift.after === 'continue' && !isCapped) {
    await outcome(`shifted (${shrank}), continuing`)

    return {
      after: 'continue',
      streak,
      prompt: continuePrompt(shift.letter, back),
      row: CONTINUING(name, shrank, shift.dir),
    }
  }

  const why = isCapped ? `waiting: ${MAX_AUTO_STREAK} shifts in a row without the owner` : 'waiting for the owner'
  await outcome(`shifted (${shrank}), ${why}`)
  const note = { context: waitContext(shift.letter, back), dir: shift.dir, files: deliveredFiles(back.work) }

  return { after: 'wait', note, row: WAITING(name, shrank, isCapped) }
}

// The fill the stretch started from, if the last shift was this session's: a fresh process counts from there.
export async function shiftBase(project: Project, sessionId: string): Promise<number | null> {
  const dir = await previousShift(project)
  const about = dir === null ? null : await project.store.read(`${dir}/about.md`)

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

function shiftName(shift: PendingShift): string {
  return shift.dir.split('/').at(-1) ?? shift.dir
}
