// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import {
  ARCHIVE,
  BOARD,
  DIR,
  GUIDE_TOOL,
  HISTORY_MAX,
  HISTORY_TOOL,
  INDEX,
  KNOWLEDGE,
  MOD,
  OWNER,
  SETTINGS,
  TASK_LIST,
  TASKS,
} from '../layout'
import { frontmatter } from '../markdown'
import { knowledgeMap, listedTasks } from '../records'
import { DEFAULT_SETTINGS, parseSettings } from '../settings'
import type { Recent, SessionFile, Work } from '../types'

export const ARCHIVED = (name: string) =>
  `Archived to ${ARCHIVE}/${name}/, its line is in ${INDEX}, and ${TASK_LIST} no longer lists it: links to it now point into the archive. Lift to the board any of its decisions that still bind beyond it.`

// What the engine's summarizer is told; the model never sees this framing.
export function compactInstructions(hold: string, board: string, letter: string): string {
  return [
    'The agent is shifting: it continues this same work right after, from its own letter.',
    `Its work board (${board}), the owner's decisions (${OWNER}), its task folders (${TASKS}/), its knowledge (${KNOWLEDGE}/) and its letter (${letter}) are on disk and will be delivered to it, so do not repeat tasks, statuses, rules, lessons or next steps.`,
    'Keep, as precisely as possible, what it asked to hold below, and the reasoning behind its current approach; everything else in this history may be dropped or reduced to one line.',
    'Do not write next steps or a plan.',
    '',
    'What the agent asked to hold:',
    hold,
  ].join('\n')
}

// Added to an automatic compaction the agent did not ask for.
export const UNASSISTED_INSTRUCTIONS = `The agent did not shift before this point, so there is no letter. Its work board may be on disk at ${BOARD}, the owner's decisions at ${OWNER}, its tasks in ${TASKS}/. Keep the overall goal and how it evolved, open tasks with their status, decisions with their reasons, exact paths, commands, error texts and values. End with a short "Where to continue" section.`

// The board and the tasks in progress, whole, and the map of knowledge: what the agent stands on after a shift. OWNER.md,
// TASKS.md, GLOSSARY.md and SHIFT.md are in the session's own block, fresh after every shift.
// Each file goes in a tag with its path: the records carry headings and code blocks of their own, so neither can mark where a file ends.
export function renderWork(work: Work | null): string {
  if (work === null) return `There is no board at ${BOARD}.`
  const tasks = inProgress(work).flatMap(t => [
    file(`${TASKS}/${t.name}/task.md`, t.task ?? 'missing'),
    file(`${TASKS}/${t.name}/track.md`, t.track ?? 'missing'),
  ])

  return [
    file(BOARD, work.board),
    ...(tasks.length === 0 ? ['No task is in progress.'] : tasks),
    `<knowledge path="${KNOWLEDGE}/" note="read a file when its topic comes up" goes="${placement(work.settings)}">\n${knowledgeMap(work.knowledge)}\n</knowledge>`,
  ].join('\n\n')
}

// Where new knowledge goes, by the owner's \`knowledge\` setting.
function placement(settings: string | null): string {
  const parsed = settings === null ? DEFAULT_SETTINGS : parseSettings(settings)
  const knowledge = typeof parsed === 'string' ? null : parsed.knowledge
  if (knowledge === 'local') return 'here: the owner set knowledge = "local"'
  if (knowledge === 'project') return 'to the project\'s docs: the owner set knowledge = "project"'
  if (knowledge === 'split') return `split by the boundary in ${OWNER}: the owner set knowledge = "split"`

  return `here until the owner sets knowledge in ${SETTINGS}; ask them once`
}

// The files loaded into every session, each in its tag; they change during the session only on disk.
export function renderSessionFiles(files: readonly SessionFile[]): string | null {
  if (files.length === 0) return null

  return [
    `<${MOD} note="loaded at the session's start and after each shift; the files on disk are newer if you changed them since">`,
    ...files.map(each => file(each.path, each.text)),
    `</${MOD}>`,
  ].join('\n\n')
}

function file(path: string, text: string): string {
  return `<file path="${path}">\n${text.trim()}\n</file>`
}

function inProgress(work: Work): Work['tasks'] {
  const doing = new Set(
    listedTasks(work)
      .filter(t => t.status === 'in progress')
      .map(t => t.name),
  )

  return work.tasks.filter(t => doing.has(t.name))
}

// What a shift hands back, as paths inside the records folder: the owner's row names them.
export function deliveredFiles(work: Work | null): string[] {
  if (work === null) return ['letter.md']
  const tasks = inProgress(work).map(t => `tasks/${t.name}/`)
  const knowledge = work.knowledge.length === 0 ? [] : ['knowledge/ (the map)']

  return ['letter.md', 'board.md', ...tasks, ...knowledge]
}

// What the agent did before this stretch: a line per recent shift, oldest first, from its about.md.
export function renderRecent(recent: Recent): string {
  if (recent.entries.length === 0) return 'No earlier shifts.'
  const earlier = recent.total - recent.entries.length
  const shifts = (n: number) => (n === 1 ? '1 shift' : `${n} shifts`)
  // No `after`: a row of past waits would pull the agent towards waiting when it could go on.
  const lines = recent.entries.map(entry => `- ${entry.name} · ${frontmatter(entry.about ?? '').get('description') ?? 'no about.md'}`)

  return [
    `What you did before: the last ${shifts(recent.entries.length)}, oldest first, the one you shifted from last.`,
    ...(earlier > 0
      ? [
          `${shifts(earlier)} before them ${earlier === 1 ? 'is' : 'are'} not listed: ${HISTORY_TOOL} reads them, up to ${HISTORY_MAX} at a time.`,
        ]
      : []),
    '<shifts>',
    ...lines,
    '</shifts>',
  ].join('\n')
}

// Everything a shift hands back, in one tag that names the mod: the agent sees at once what came from where.
// Ordered by how a context is read: the records first as reference, the recent shifts in the middle, the letter last,
// right before the turn, so its "Next" is what the agent sees closest to acting.
function shiftMessage(opening: string, letter: string, work: Work | null, recent: Recent, dir: string, closing: string[] = []): string {
  return [
    `<${MOD} shift="${dir}/">`,
    opening,
    '',
    'The board, the tasks in progress and the map of knowledge, as they are now; SHIFT.md, OWNER.md, GLOSSARY.md and TASKS.md are in your session block, read again after this shift:',
    '',
    renderWork(work),
    '',
    renderRecent(recent),
    '',
    'Your letter to yourself, written right before the shift:',
    '',
    `<letter path="${dir}/letter.md">`,
    letter.trim(),
    '</letter>',
    '',
    `The letter and the snapshots of this shift: ${dir}/.`,
    ...closing,
    `</${MOD}>`,
  ].join('\n')
}

export function continuePrompt(letter: string, work: Work | null, recent: Recent, dir: string): string {
  return shiftMessage('Shift done. You continue from where you stopped.', letter, work, recent, dir, ['Continue from "Next".'])
}

export function waitContext(letter: string, work: Work | null, recent: Recent, dir: string): string {
  return shiftMessage("You shifted and waited for the owner; the owner's message is above.", letter, work, recent, dir)
}

export function resumePrompt(letter: string, work: Work | null, recent: Recent, dir: string): string {
  return shiftMessage(
    'You pick up the work from the last shift: this is a new session, you have no history of the previous one, only the records.',
    letter,
    work,
    recent,
    dir,
    [
      `Past shifts — ${HISTORY_TOOL}; archived tasks — ${INDEX}; how a shift works — ${GUIDE_TOOL}.`,
      'Check "Next" against what is on disk now and continue from the first step not done.',
    ],
  )
}

export const ACCEPTED = (dir: string) =>
  `Shift accepted, the letter and the snapshots: ${dir}/. End the turn with one line and do nothing more: after the turn the stretch's history is let go, and you continue from the letter.`

export const NOT_IGNORED = `${DIR}/ is not ignored by this project's git, and the repository's own exclude file was not found. Add "${DIR}/" to the project's .gitignore, or ask the owner to set commit = true in ${SETTINGS}, and call again.`

// The records were not ignored and the mod excluded them: told to the agent and to the owner.
export const EXCLUDED = (file: string) =>
  `${DIR}/ was not ignored by this project's git: the mod added "${DIR}/" to ${file}, which stays local. To commit the records with the project, the owner sets commit = true in ${SETTINGS}.`
