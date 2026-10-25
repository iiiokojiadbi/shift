// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { readAbout } from '../about'
import {
  ARCHIVE,
  ARCHIVE_TOOL,
  atPlaces,
  BOARD,
  DIR,
  GUIDE_TOOL,
  HISTORY_MAX,
  HISTORY_TOOL,
  INDEX,
  KNOWLEDGE,
  MOD,
  NAMES,
  NEXT,
  OWNER,
  RESUME_COMMAND,
  SETTINGS,
  TASK_LIST,
  TASKS,
  TRACK_TOOL,
} from '../layout'
import { frontmatter } from '../markdown'
import { knowledgeMap, listedTasks } from '../records'
import type { Placement, Settings } from '../settings'
import type { HandedBack, PendingShift, Recent, SessionFile, Stuck, Work } from '../types'

// The `note=` of each kind of note the mod tells the agent, so it tells the note from what the note came with.
export const NOTE_KINDS = {
  hint: 'a hint from the mod, not part of what it came with',
  records: "the mod's check of the records just changed",
  docs: "the mod's check of the file just written",
} as const

export type NoteKind = keyof typeof NOTE_KINDS

export const OPENED = (name: string, line: string) =>
  `Opened ${TASKS}/${name}/ with task.md and track.md, and its line in ${TASK_LIST}:\n${line}\nIts decisions, dead ends and owner decisions say "none" until there are some; add items as you go with ${TRACK_TOOL}.`

export const ARCHIVED = (name: string) =>
  `Archived to ${ARCHIVE}/${name}/, its line is in ${INDEX}, and ${TASK_LIST} no longer lists it: links to it now point into the archive. Lift to the board any of its decisions that still bind beyond it.`

// What the engine's summarizer is told; the model never sees this framing.
export function compactInstructions(shift: Pick<PendingShift, 'hold' | 'board' | 'owner' | 'dir' | 'focus'>): string {
  const focus = shift.focus ?? []
  return [
    'The agent is shifting: it continues this same work right after, from its own letter.',
    `Its work board (${shift.board}), the owner's decisions (${shift.owner ?? OWNER}), its task folders (${TASKS}/), its knowledge (${KNOWLEDGE}/) and its letter (${shift.dir}/${NAMES.letter}) are on disk and will be delivered to it, so do not repeat tasks, statuses, rules, lessons or next steps.`,
    'Keep, as precisely as possible, what it asked to hold below, and the reasoning behind its current approach; everything else in this history may be dropped or reduced to one line.',
    'Do not write next steps or a plan.',
    ...(focus.length === 0
      ? []
      : [
          '',
          'What it is working on now — keep the reasoning, findings and failed attempts around these fuller than the rest:',
          ...focus.map(each => `- ${each}`),
        ]),
    '',
    'What the agent asked to hold:',
    shift.hold,
  ].join('\n')
}

// Added to an automatic compaction the agent did not ask for.
export function unassistedInstructions(files: Settings['files']): string {
  return atPlaces(
    `The agent did not shift before this point, so there is no letter. Its work board may be on disk at ${BOARD}, the owner's decisions at ${OWNER}, its tasks in ${TASKS}/. Keep the overall goal and how it evolved, open tasks with their status, decisions with their reasons, exact paths, commands, error texts and values. End with a short "Where to continue" section.`,
    files,
  )
}

// The board and the tasks in progress, whole, and the map of knowledge: what the agent stands on after a shift. OWNER.md,
// TASKS.md, GLOSSARY.md and SHIFT.md are in the session's own block, fresh after every shift.
// Each file goes in a tag with its path: the records carry headings and code blocks of their own, so neither can mark where a file ends.
export function renderWork(work: Work | null, knowledge: Placement | null, owner: string): string {
  if (work === null) return `There is no board at ${BOARD}.`
  const tasks = inProgress(work).flatMap(t => [
    fileBlock(`${TASKS}/${t.name}/${NAMES.task}`, t.task ?? 'missing'),
    fileBlock(`${TASKS}/${t.name}/${NAMES.track}`, t.track ?? 'missing'),
    ...(t.notes.length === 0 ? [] : [notesList(t.name, t.notes)]),
  ])

  return [
    fileBlock(BOARD, work.board),
    ...(tasks.length === 0 ? ['No task is in progress.'] : tasks),
    `<knowledge path="${KNOWLEDGE}/" note="read a file when its topic comes up" goes="${placement(knowledge, owner)}">\n${knowledgeMap(work.knowledge)}\n</knowledge>`,
  ].join('\n\n')
}

// A task's notes, by their descriptions: read one when its item comes up; they do not come whole.
function notesList(task: string, notes: Work['tasks'][number]['notes']): string {
  const folder = `${TASKS}/${task}/${NAMES.notes}`
  const rows = notes.map(note => `- ${folder}/${note.name} — ${frontmatter(note.text).get('description') ?? 'no description'}`)

  return `<notes path="${folder}/" note="read a note when its item comes up">\n${rows.join('\n')}\n</notes>`
}

// Where new knowledge goes, by the owner's \`knowledge\` setting.
function placement(knowledge: Placement | null, owner: string): string {
  if (knowledge === 'local') return 'here: the owner set knowledge = "local"'
  if (knowledge === 'project') return 'to the project\'s docs: the owner set knowledge = "project"'
  if (knowledge === 'split') return `split by the boundary in ${owner}: the owner set knowledge = "split"`

  return `here until the owner sets knowledge in ${SETTINGS}; ask them once`
}

// The files loaded into every session, each in its tag; they change during the session only on disk.
export function renderSessionFiles(files: readonly SessionFile[]): string | null {
  if (files.length === 0) return null

  return [
    `<${MOD} note="loaded at the session's start and after each shift; the files on disk are newer if you changed them since">`,
    ...files.map(each => fileBlock(each.path, each.text)),
    `</${MOD}>`,
  ].join('\n\n')
}

export function fileBlock(path: string, text: string): string {
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
  if (work === null) return [NAMES.letter]
  const tasks = inProgress(work).map(t => `${NAMES.tasks}/${t.name}/`)
  const knowledge = work.knowledge.length === 0 ? [] : [`${NAMES.knowledge}/ (the map)`]

  return [NAMES.letter, NAMES.board, ...tasks, ...knowledge]
}

// What the agent did before this stretch: a line per recent shift, oldest first, from its about.md.
export function renderRecent(recent: Recent): string {
  if (recent.entries.length === 0) return 'No earlier shifts.'
  const earlier = recent.total - recent.entries.length
  const shifts = (n: number) => (n === 1 ? '1 shift' : `${n} shifts`)
  // No `after`: a row of past waits would pull the agent towards waiting when it could go on.
  const lines = recent.entries.map(entry => `- ${entry.name} · ${readAbout(entry.about ?? '').description ?? 'no about.md'}`)

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

// Tasks whose files went unchanged through many shifts: a wait that may have become stuck, or work forgotten.
export function renderStuck(stuck: readonly Stuck[]): string {
  return [
    `Tasks unchanged through the last shifts — still right? Ask the owner, change the status, or archive the task as dropped with ${ARCHIVE_TOOL}:`,
    ...stuck.map(task => `- ${task.name} (${task.status}) — ${task.shifts} shifts`),
  ].join('\n')
}

// Everything a shift hands back, in one tag that names the mod: the agent sees at once what came from where.
// Ordered by how a context is read: the records first as reference, the recent shifts in the middle, the letter last,
// right before the turn, so its "Next" is what the agent sees closest to acting.
function shiftMessage(opening: string, letter: string, back: HandedBack, closing: string[] = []): string {
  const { work, recent, dir, remarks } = back

  return [
    `<${MOD} folder="${dir}/">`,
    opening,
    '',
    'The board, the tasks in progress and the map of knowledge, as they are now; SHIFT.md, OWNER.md, GLOSSARY.md and TASKS.md are in your session block, read again after this shift:',
    '',
    renderWork(work, back.knowledge, back.owner),
    '',
    renderRecent(recent),
    '',
    ...(back.stuck.length === 0 ? [] : [renderStuck(back.stuck), '']),
    ...(remarks === null ? [] : ['Documents with remarks from the mod — fix them as the work passes by them:', '', remarks, '']),
    'Your letter to yourself, written right before the shift:',
    '',
    `<letter path="${dir}/${NAMES.letter}">`,
    letter.trim(),
    '</letter>',
    '',
    `The letter and the snapshots of this shift: ${dir}/.`,
    ...closing,
    `</${MOD}>`,
  ].join('\n')
}

// After a let-go the agent cannot tell its first shift from a later one, and read the guide before every shift.
const GUIDE_KNOWN = `You have shifted here before: read ${GUIDE_TOOL} again only if a refusal sends you to it.`

export function continuePrompt(letter: string, back: HandedBack): string {
  return shiftMessage('Shift done. You continue from where you stopped.', letter, back, [GUIDE_KNOWN, `Continue from "${NEXT}".`])
}

export function waitContext(letter: string, back: HandedBack): string {
  return shiftMessage("You shifted and waited for the owner; the owner's message is above.", letter, back, [GUIDE_KNOWN])
}

export function resumePrompt(letter: string, back: HandedBack): string {
  return shiftMessage(
    'You pick up the work from the last shift: this is a new session, you have no history of the previous one, only the records.',
    letter,
    back,
    [
      `Past shifts — ${HISTORY_TOOL}; archived tasks — ${INDEX}; how a shift works — ${GUIDE_TOOL}.`,
      `Check "${NEXT}" against what is on disk now and continue from the first step not done; a message from the owner after this one goes first.`,
    ],
  )
}

// What starts the turn after /unshift when the owner wrote nothing with it: the letter is already in the history.
export const RESUME_GO = `<${MOD} note="from the mod after /${RESUME_COMMAND}">Pick up from the shift above: continue from "${NEXT}".</${MOD}>`

export const ACCEPTED = (dir: string, learned: boolean) =>
  `Shift accepted, the letter and the snapshots: ${dir}/. ${learned ? '' : `Nothing went into ${KNOWLEDGE}/ this stretch: if you learned something that stays true for months — a trap, a lesson, a command, a fact — write it where knowledge goes here now, while the stretch is still whole; then `}${learned ? 'End' : 'end'} the turn with one line and do nothing more: after the turn the stretch's history is let go, and you continue from the letter.`

export const NOT_IGNORED = `${DIR}/ is not ignored by this project's git, and the repository's own exclude file was not found. Add "${DIR}/" to the project's .gitignore, or ask the owner to set commit = true in ${SETTINGS}, and call again.`

// The records were not ignored and the mod excluded them: told to the agent and to the owner.
export const EXCLUDED = (file: string) =>
  `${DIR}/ was not ignored by this project's git: the mod added "${DIR}/" to ${file}, which stays local. To commit the records with the project, the owner sets commit = true in ${SETTINGS}.`
