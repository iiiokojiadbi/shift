// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
// The mod's name: the tag its texts in the model's context are wrapped in name it.
export const MOD = 'shift'

export const TOOL = 'shift'

export const READ_TOOL = 'shift_read'

export const RECORD_TOOL = 'shift_record'

export const GUIDE_TOOL = 'shift_guide'

export const HISTORY_TOOL = 'shift_history'

export const STATUS_TOOL = 'shift_status'

export const SIZES_TOOL = 'shift_sizes'

export const SETUP_TOOL = 'shift_setup'

export const OUTLINE_TOOL = 'doc_outline'

export const MENTIONS_TOOL = 'docs_mentioning'

export const RESUME_COMMAND = 'unshift'

export const TASKS_COMMAND = 'shift-tasks'

export const SHIFT_COMMAND = 'shift'

// The board is the state of the work; past this it has turned into a diary.
export const BOARD_MAX_LINES = 150

// Owner decisions in force for the whole project; past this the code of rules has turned into a log.
export const OWNER_MAX_LINES = 150

// GLOSSARY.md comes into every session whole.
export const GLOSSARY_MAX_LINES = 400

// Historical default for the accepted docs.max_chars setting.
export const DOCS_MAP_MAX_CHARS = 100000

// The pinned blocks of the docs, in characters; past it the map says so, and shows them all still.
export const DOCS_PINNED_MAX_CHARS = 4000

// How many folders deep a docs folder is walked: a store may follow a link to a folder, and a link back up must not make
// a walk endless. A document deeper is not mapped.
export const DOCS_MAX_DEPTH = 8

// A knowledge file past this is split by topic.
export const KNOWLEDGE_MAX_LINES = 400

export const DIR = '.shift'

// Current records and their names in the native archive.
export const NAMES = {
  board: 'board.md',
  letter: 'letter.md',
  owner: 'OWNER.md',
  glossary: 'GLOSSARY.md',
  shift: 'SHIFT.md',
  settings: 'settings.toml',
  knowledge: 'knowledge',
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

export const KNOWLEDGE = `${DIR}/${NAMES.knowledge}`

export const BOARD_SECTIONS = ['Goal', 'Current focus'] as const

// Owner decisions moved from the board to their own file; a board that still has the section is refused with the move to make.
export const OWNER_SECTION = 'Owner decisions'

export const LETTER_SECTIONS = ['Where I am', 'Next', 'Unverified', 'Hold'] as const
// The letter's steps, the ones the agent continues from, and what the summarizer is told to keep.
export const NEXT = LETTER_SECTIONS[1]
export const HOLD = LETTER_SECTIONS[3]
export const AFTER = ['continue', 'wait'] as const
// Kinds of knowledge files and the fields every `###` entry of a kind carries; a glossary is `- **term** — meaning` lines.
export const KINDS = {
  traps: ['**Cause.**', '**Do.**'],
  lessons: ['**Why.**', '**Not when.**'],
  runbook: ['**Shows.**'],
  facts: ['**Source.**'],
} as const satisfies Record<string, readonly string[]>

// The length limit for the description shown in shift history.
export const ABOUT_MAX = 400

export const HISTORY_DEFAULT = 10

export const HISTORY_MAX = 50
