import { readAbout } from '../about'
import {
  atPlaces,
  BOARD,
  DIR,
  GUIDE_TOOL,
  HISTORY_MAX,
  HISTORY_TOOL,
  LETTER,
  MOD,
  NAMES,
  NEXT,
  OWNER,
  RESUME_COMMAND,
  SETTINGS,
  SHIFT_COMMAND,
  TOOL,
} from '../layout'
import type { Placement, Settings } from '../settings'
import type { HandedBack, PendingShift, Recent, SessionFile, ShiftAfter, Work } from '../types'

// The `note=` of each kind of note the mod tells the agent, so it tells the note from what the note came with.
export const NOTE_KINDS = {
  hint: 'a hint from the mod, not part of what it came with',
  records: "the mod's check of the records just changed",
  map: 'changes to the documentation map',
  docs: "the mod's check of the files written in the last run",
} as const

export type NoteKind = keyof typeof NOTE_KINDS

// What the engine's summarizer is told; the model never sees this framing.
export function compactInstructions(shift: Pick<PendingShift, 'hold' | 'board' | 'owner' | 'dir'>): string {
  return [
    'The agent is shifting: it continues this same work right after, from its own letter.',
    `Its board (${shift.board}) and saved letter (${shift.dir}) return after the shift. Preserve the reasoning behind the work without repeating these records.`,
    'Keep, as precisely as possible, what it asked to hold below, and the reasoning behind its current approach; everything else in this history may be dropped or reduced to one line.',
    'Do not write next steps or a plan.',
    '',
    'What the agent asked to hold:',
    shift.hold,
  ].join('\n')
}

// Added to an automatic compaction the agent did not ask for.
export function unassistedInstructions(files: Settings['files']): string {
  return atPlaces(
    `The agent did not shift before this point, so there is no letter. Its current board is identified by ${BOARD}, the owner's decisions at ${OWNER}. Keep the overall goal and how it evolved, open tasks with their status, decisions with their reasons, exact paths, commands, error texts and values. End with a short "Where to continue" section.`,
    files,
  )
}

// The board and the knowledge map follow a shift. Session files are delivered separately.
// Each file goes in a tag with its path: the records carry headings and code blocks of their own, so neither can mark where a file ends.
export function renderWork(work: Work | null, knowledge: Placement | null, owner: string): string {
  if (work === null) return `There is no board at ${BOARD}.`
  return [`**Board**\n\n${fileBlock(BOARD, work.board)}`, `Knowledge placement: ${placement(knowledge, owner)}.`].join('\n\n---\n\n')
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
    `<${MOD} note="loaded at the session's start and after each shift; read current records if they have changed since">`,
    ...files.map(each => fileBlock(each.path, each.text)),
    `</${MOD}>`,
  ].join('\n\n')
}

export function fileBlock(path: string, text: string): string {
  return `<file path="${path}">\n${text.trim()}\n</file>`
}

// What a shift hands back, as paths inside the records folder: the owner's row names them.
export function deliveredFiles(work: Work | null): string[] {
  if (work === null) return [NAMES.letter]
  return [NAMES.letter, NAMES.board]
}

// What the agent did before this stretch: a line per recent shift, oldest first, from its about.md.
export function renderRecent(recent: Recent): string {
  if (recent.entries.length === 0) return 'No earlier shifts.'
  const earlier = recent.total - recent.entries.length
  const shifts = (n: number) => (n === 1 ? '1 shift' : `${n} shifts`)
  // No `after`: a row of past waits would pull the agent towards waiting when it could go on.
  const lines = recent.entries.map(entry =>
    entry.letter === undefined
      ? `- ${entry.name} · ${readAbout(entry.about ?? '').description ?? 'no about.md'}`
      : `<previous_letter shift="${entry.name}">\n${entry.letter.trim()}\n</previous_letter>`,
  )

  return [
    `What you did before: the last ${shifts(recent.entries.length)}, oldest first.`,
    ...(earlier > 0
      ? [
          `${shifts(earlier)} before them ${earlier === 1 ? 'is' : 'are'} not listed: ${HISTORY_TOOL} reads them, up to ${HISTORY_MAX} at a time.`,
        ]
      : []),
    ...(recent.entries.some(entry => entry.letter !== undefined)
      ? ['Earlier letters describe past work. Continue from the current letter below.']
      : []),
    '<shifts>',
    ...lines,
    '</shifts>',
  ].join('\n')
}

// Everything a shift hands back, in one tag that names the mod: the agent sees at once what came from where.
// Ordered by how a context is read: the records first as reference, the recent shifts in the middle, the letter last,
// right before the turn, so its "Next" is what the agent sees closest to acting.
function shiftMessage(opening: string, letter: string, back: HandedBack, closing: string[] = []): string {
  const { work, recent, dir, remarks } = back

  return [
    `<${MOD} id="${dir}">`,
    opening,
    '',
    'Your current board follows. The session files were read again after this shift.',
    '',
    renderWork(work, back.knowledge, back.owner),
    '',
    renderRecent(recent),
    '',
    ...(remarks === null ? [] : ['Documents with remarks from the mod — fix them as the work passes by them:', '', remarks, '']),
    'Your letter to yourself, written right before the shift:',
    '',
    `<letter shift="${dir}">`,
    letter.trim(),
    '</letter>',
    '',
    `Read saved records with shift_history using ID ${dir}.`,
    ...closing,
    `</${MOD}>`,
  ].join('\n')
}

// After a let-go the agent cannot tell its first shift from a later one, and read the guide before every shift.
const GUIDE_KNOWN = `You have shifted here before: use ${GUIDE_TOOL} for a specific record format or refusal.`

export function continuePrompt(letter: string, back: HandedBack): string {
  return shiftMessage('Shift done. You continue from where you stopped.', letter, back, [GUIDE_KNOWN, `Continue from "${NEXT}".`])
}

// The turn after a let-go whose message the harness already put into the replacement history: the letter, the board
// and the other records are above this line, so only the turn has to be started, never the message told twice.
export const WAKE = `The shift is done and your letter is above. Continue from "${NEXT}".`

export function waitContext(letter: string, back: HandedBack): string {
  return shiftMessage("You shifted and waited for the owner; the owner's message comes with this one.", letter, back, [GUIDE_KNOWN])
}

export function resumePrompt(letter: string, back: HandedBack, outcome: string | null = null): string {
  return shiftMessage(
    `You pick up the work from the last shift: this is a new session, you have no history of the previous one, only the records.${
      outcome === null
        ? ''
        : ` That shift did not finish — "${outcome}": its letter was written when it was accepted, the records below are as they are now; where they differ, the records are the later state.`
    }`,
    letter,
    back,
    [
      `Past shifts — ${HISTORY_TOOL}; archived tasks — the project Beads command in your session instructions; how a shift works — ${GUIDE_TOOL}.`,
      `Check "${NEXT}" against what is on disk now and continue from the first step not done; the owner's accompanying request takes priority.`,
    ],
  )
}

// What starts the turn after /unshift when the owner wrote nothing with it: the letter is already in the history.
export const RESUME_GO = `<${MOD} note="from the mod after /${RESUME_COMMAND}">Pick up from the shift above: continue from "${NEXT}".</${MOD}>`

// The owner's /shift: their word to shift now, the first hint or not, with what they typed after the command.
export const SHIFT_NOW = (words: string) =>
  `<${MOD} note="from the owner's /${SHIFT_COMMAND}">The owner asks you to shift now, whether a hint has come or not. Bring the step in hand to a point the letter can name, keep your records, write the letter and call ${TOOL}; choose after as the work needs.${words === '' ? '' : ` The owner's words: ${words}`}</${MOD}>`

// How the turn ends once a shift is accepted. The owner reads the turn's last message, not the letter or the records:
// with `wait` it is the answer they come back to.
const TURN_END: Record<ShiftAfter, string> = {
  continue: 'End the turn with one line and do nothing more',
  wait: 'End the turn with your answer to the owner, whole — what you did and found, what you ask them to decide — and do nothing more: it is all the owner reads before you wait, they see neither your records nor this call',
}

export const ACCEPTED = (dir: string, after: ShiftAfter) =>
  `Shift accepted, read its records with shift_history ID ${dir}. ${TURN_END[after]}. After the turn the stretch's history is let go, and you continue from the letter${after === 'wait' ? " with the owner's next message" : ''}.`

export const NOT_IGNORED = `${DIR}/ is not ignored by this project's git, and the repository's own exclude file was not found. Add "${DIR}/" to the project's .gitignore, or ask the owner to set commit = true in ${SETTINGS}, and call again.`

// The records were not ignored and the mod excluded them: told to the agent and to the owner.
export const EXCLUDED = (file: string) =>
  `${DIR}/ was not ignored by this project's git: the mod added "${DIR}/" to ${file}, which stays local. To commit the records with the project, the owner sets commit = true in ${SETTINGS}.`

// The shift refused before anything is written: the harness would not let this history go.
export const SHIFT_TOO_EARLY = (why: string) =>
  `Nothing to shift yet: ${why} Nothing was written. Keep working with the records as they are, and shift once the history has grown — after the first hint.`

// A reason the harness gives, in the mod's words: it reaches the model, which reads only "shift" and "let go". A word
// inside a path or a file's name is left as it is, so the path still names the file.
const OUTSIDE_NAME = (word: string) => new RegExp(`(?<![\\w./-])(?:${word})(?![\\w/-]|\\.\\w)`, 'gi')
export function ourWords(why: string): string {
  return why
    .replace(OUTSIDE_NAME('compaction|summarization|compression'), 'let-go')
    .replace(OUTSIDE_NAME('(?:compact|summari[sz]e|compress)(?:s|ed|ing)?'), 'let go')
    .replace(OUTSIDE_NAME('summary'), 'digest')
}

// A shift accepted and then not made: the agent was told it was accepted, so it is told it was not.
export const NOT_MADE_NOTE = (name: string, why: string) =>
  `<${MOD} note="from the mod: the shift was not made">
Shift ${name} was not made — ${why}. Nothing was let go: your history is whole, and your records stay as you wrote them; its saved records remain in history. Go on from where you stopped, and shift again later.
</${MOD}>`

// A shift let go and its message not built: the agent has lost its history and got nothing back.
export const UNSETTLED_NOTE = (name: string, why: string, dir: string) =>
  `<${MOD} note="from the mod: the history was let go, the records were not handed back">
Shift ${name}: the history was let go, but the mod could not hand your records back — ${why}. Read the letter of this shift, shift_history(action="read", id="${dir}") — the one it accepted, whatever ${LETTER} holds now — then ${BOARD}, and continue from "${NEXT}".
</${MOD}>`

// The owner's messages held back while the history was let go, after the letter: their words as they wrote them.
export const HELD_NOTE = (texts: readonly string[]) =>
  `<${MOD} note="from the mod: the owner wrote while you shifted">The owner sent ${texts.length === 1 ? 'this message' : `these ${texts.length} messages`} while the history was let go; the mod held ${texts.length === 1 ? 'it' : 'them'} back to reach you after your letter. ${texts.length === 1 ? 'It goes' : 'They go'} first, before "${NEXT}".</${MOD}>\n\n${texts.join('\n\n')}`

// What the owner's row names when a failure's note went with their message.
export const FAILURE_NOTE = 'the note that the shift failed'
