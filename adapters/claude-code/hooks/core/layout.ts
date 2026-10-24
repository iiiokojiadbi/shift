// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
// The mod's name: the tag its texts in the model's context are wrapped in name it.
export const MOD = 'shift'

export const TOOL = 'shift'

export const GUIDE_TOOL = 'shift_guide'

export const HISTORY_TOOL = 'shift_history'

export const ARCHIVE_TOOL = 'task_archive'

export const STATUS_TOOL = 'shift_status'

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

// A knowledge file past this is split by topic.
export const KNOWLEDGE_MAX_LINES = 400

export const DIR = '.shift'
// Where the records lived before the mod was named shift.
export const OLD_DIR = '.infinity-shift'

export const BOARD = `${DIR}/board.md`

export const LETTER = `${DIR}/letter.md`
// The owner's settings for the project.
export const SETTINGS = `${DIR}/settings.toml`
// Loaded into every session, at these places unless the settings move them.
export const SHIFT_FILE = `${DIR}/SHIFT.md`
export const GLOSSARY = `${DIR}/GLOSSARY.md`
export const TASK_LIST = `${DIR}/TASKS.md`

export const OWNER = `${DIR}/OWNER.md`
// The name owner decisions had before OWNER.md.
export const OLD_OWNER = `${DIR}/owner.md`

export const KNOWLEDGE = `${DIR}/knowledge`

export const TASKS = `${DIR}/tasks`

export const ARCHIVE = `${DIR}/archive`

export const INDEX = `${ARCHIVE}/index.md`

export const BOARD_SECTIONS = ['Goal', 'Decisions', 'Dead ends'] as const

// Owner decisions moved from the board to their own file; a board that still has the section is refused with the move to make.
export const OWNER_SECTION = 'Owner decisions'

export const TASK_SECTIONS = ['Goal', 'Done when', 'Owner decisions', 'Decisions', 'Dead ends'] as const

export const LETTER_SECTIONS = ['Where I am', 'Next', 'Unverified', 'Hold'] as const

// Where a task stands on the board; closing it is archiving it.
export const FOCUS = ['in progress', 'deferred', 'waiting for owner'] as const

// Where an item of a task's track stands.
export const STATUSES = ['in progress', 'open', 'done', 'dropped'] as const

export const CLOSED = new Set(['done', 'dropped'])

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

export const NAME = /^[a-z0-9][a-z0-9-]*$/
