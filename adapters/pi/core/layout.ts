// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
// The mod's name: the tag its texts in the model's context are wrapped in name it.
export const MOD = 'shift'

export const TOOL = 'shift'

export const GUIDE_TOOL = 'shift_guide'

export const HISTORY_TOOL = 'shift_history'

export const OPEN_TOOL = 'task_open'

export const ARCHIVE_TOOL = 'task_archive'

export const TRACK_TOOL = 'task_track'

export const STATUS_TOOL = 'shift_status'

export const SETUP_TOOL = 'shift_setup'

export const OUTLINE_TOOL = 'doc_outline'

export const MENTIONS_TOOL = 'docs_mentioning'

export const RESUME_COMMAND = 'unshift'

// Consecutive self-continued shifts before the mod stops and waits for the owner.
export const MAX_AUTO_STREAK = 3

// The board is the state of the work; past this it has turned into a diary.
export const BOARD_MAX_LINES = 150

// Owner decisions in force for the whole project; past this the code of rules has turned into a log.
export const OWNER_MAX_LINES = 150

// TASKS.md: one short line a task and its links.
export const TASKS_MAX_LINES = 150

// GLOSSARY.md comes into every session whole.
export const GLOSSARY_MAX_LINES = 400

// The docs map in SHIFT.md, in characters; past it only folders and file names are listed.
export const DOCS_MAP_MAX_CHARS = 100000

// The pinned blocks of the docs, in characters; past it the map says so, and shows them all still.
export const DOCS_PINNED_MAX_CHARS = 4000

// A knowledge file past this is split by topic.
export const KNOWLEDGE_MAX_LINES = 400

export const DIR = '.shift'
// Where the records lived before the mod was named shift.
export const OLD_DIR = '.infinity-shift'

// The names of the records inside the records folder, and inside each shift's folder, which keeps them under the
// same names: the one list reading, snapshotting and the setup's tree go by.
export const NAMES = {
  board: 'board.md',
  letter: 'letter.md',
  owner: 'OWNER.md',
  oldOwner: 'owner.md',
  glossary: 'GLOSSARY.md',
  shift: 'SHIFT.md',
  taskList: 'TASKS.md',
  settings: 'settings.toml',
  tasks: 'tasks',
  task: 'task.md',
  track: 'track.md',
  notes: 'notes',
  knowledge: 'knowledge',
  archive: 'archive',
  index: 'index.md',
  shifts: 'shifts',
  about: 'about.md',
  summary: 'summary.md',
} as const

export const BOARD = `${DIR}/${NAMES.board}`

export const LETTER = `${DIR}/${NAMES.letter}`
// The owner's settings for the project.
export const SETTINGS = `${DIR}/${NAMES.settings}`
// Loaded into every session, at these places unless the settings move them.
export const SHIFT_FILE = `${DIR}/${NAMES.shift}`
export const GLOSSARY = `${DIR}/${NAMES.glossary}`
export const TASK_LIST = `${DIR}/${NAMES.taskList}`

export const OWNER = `${DIR}/${NAMES.owner}`

// A text written with the default places of OWNER.md, GLOSSARY.md and SHIFT.md, at the places the project's settings
// give instead: every text names its files once, by the defaults, and is moved here.
// One pass, so a moved path is never moved again, whatever it looks like.
export function atPlaces(text: string, files: { owner: string; glossary: string; shift: string }): string {
  const places: Record<string, string> = { [OWNER]: files.owner, [GLOSSARY]: files.glossary, [SHIFT_FILE]: files.shift }

  return text.replace(new RegExp([OWNER, GLOSSARY, SHIFT_FILE].map(escapeRegExp).join('|'), 'g'), found => places[found] ?? found)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
// The name owner decisions had before OWNER.md.
export const OLD_OWNER = `${DIR}/${NAMES.oldOwner}`

export const KNOWLEDGE = `${DIR}/${NAMES.knowledge}`

export const TASKS = `${DIR}/${NAMES.tasks}`

export const ARCHIVE = `${DIR}/${NAMES.archive}`

export const INDEX = `${ARCHIVE}/${NAMES.index}`

export const SHIFTS = `${DIR}/${NAMES.shifts}`

// A file of a task's folder under `base`, the records folder or a shift's.
export function taskFile(base: string, name: string, file: 'task' | 'track'): string {
  return `${base}/${NAMES.tasks}/${name}/${NAMES[file]}`
}

export const BOARD_SECTIONS = ['Goal', 'Decisions', 'Dead ends'] as const

// Owner decisions moved from the board to their own file; a board that still has the section is refused with the move to make.
export const OWNER_SECTION = 'Owner decisions'

export const TASK_SECTIONS = ['Goal', 'Done when', 'Owner decisions', 'Decisions', 'Dead ends'] as const

export const LETTER_SECTIONS = ['Where I am', 'Next', 'Unverified', 'Hold'] as const
// The letter's steps, the ones the agent continues from, and what the summarizer is told to keep.
export const NEXT = LETTER_SECTIONS[1]
export const HOLD = LETTER_SECTIONS[3]
// The board's section the open tasks lived in before TASKS.md.
export const OLD_TASKS_SECTION = 'Tasks'
// What follows a shift, and how an archived task ended.
export const AFTER = ['continue', 'wait'] as const
export const OUTCOMES = ['done', 'dropped'] as const

// Where a task stands on the board; closing it is archiving it.
export const FOCUS = ['in progress', 'deferred', 'waiting for owner'] as const

// Where an item of a task's track stands: open ones still to do, closed ones done or dropped.
const OPEN = ['in progress', 'open'] as const
const CLOSING = ['done', 'dropped'] as const
export const STATUSES = [...OPEN, ...CLOSING] as const
export const CLOSED: ReadonlySet<string> = new Set(CLOSING)

// Kinds of knowledge files and the fields every `###` entry of a kind carries; a glossary is `- **term** — meaning` lines.
export const KINDS = {
  traps: ['**Cause.**', '**Do.**'],
  lessons: ['**Why.**', '**Not when.**'],
  runbook: ['**Shows.**'],
  facts: ['**Source.**'],
} as const satisfies Record<string, readonly string[]>

// The description of a shift, as `about.md` and the history show it; an archived task's line, as the index shows it.
export const ABOUT_MAX = 400

export const HISTORY_DEFAULT = 10

export const HISTORY_MAX = 50

// How many shifts' descriptions go back with the message after a shift.
export const RECENT_SHIFTS = 10

// A task whose files went unchanged through this many shifts is named after a shift: waiting may have become stuck.
export const STUCK_SHIFTS = 5

// How far back the snapshots are compared for it.
export const STUCK_LOOKBACK = 30

export const NAME = /^[a-z0-9][a-z0-9-]*$/
export const NAME_RULE = 'lowercase latin, digits and dashes'
