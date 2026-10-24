// The mod's name: the tag its texts in the model's context are wrapped in name it.
export const MOD = 'infinity-shift'

export const TOOL = 'shift'

export const GUIDE_TOOL = 'shift_guide'

export const HISTORY_TOOL = 'shift_history'

export const ARCHIVE_TOOL = 'task_archive'

export const STATUS_TOOL = 'shift_status'

export const RESUME_COMMAND = 'shift-resume'

// Consecutive self-continued shifts before the mod stops and waits for the owner.
export const MAX_AUTO_STREAK = 3

// The board is the state of the work; past this it has turned into a diary.
export const BOARD_MAX_LINES = 150

// Owner decisions in force for the whole project; past this the code of rules has turned into a log.
export const OWNER_MAX_LINES = 150

// A knowledge file past this is split by topic.
export const KNOWLEDGE_MAX_LINES = 400

export const DIR = '.infinity-shift'

export const BOARD = `${DIR}/board.md`

export const LETTER = `${DIR}/letter.md`

export const OWNER = `${DIR}/owner.md`

export const KNOWLEDGE = `${DIR}/knowledge`

export const TASKS = `${DIR}/tasks`

export const ARCHIVE = `${DIR}/archive`

export const INDEX = `${ARCHIVE}/index.md`

export const BOARD_SECTIONS = ['Goal', 'Tasks', 'Decisions', 'Dead ends'] as const

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
  glossary: [],
} as const satisfies Record<string, readonly string[]>

// The description of a shift, as `about.md` and the history show it; an archived task's line, as the index shows it.
export const ABOUT_MAX = 400

export const HISTORY_DEFAULT = 10

export const HISTORY_MAX = 50

// How many shifts' descriptions go back with the message after a shift.
export const RECENT_SHIFTS = 10

export const NAME = /^[a-z0-9][a-z0-9-]*$/
