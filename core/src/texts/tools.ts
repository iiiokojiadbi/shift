import {
  AFTER,
  GUIDE_TOOL,
  HISTORY_DEFAULT,
  HISTORY_MAX,
  HISTORY_TOOL,
  LETTER,
  MENTIONS_TOOL,
  OUTLINE_TOOL,
  READ_TOOL,
  RECORD_TOOL,
  SETUP_TOOL,
  SIZES_TOOL,
  STATUS_TOOL,
  TOOL,
} from '../layout'

export const TOOL_DESCRIPTION = `Make a shift: the stretch's history is let go, and you continue from your letter to yourself (after: continue) or wait for the owner (after: wait). Before the call the board and the letter must be ready — how is in ${GUIDE_TOOL}, read once per project. After the call, end the turn: one line with continue; with wait, your whole answer to the owner — it is all they read. Only the main agent shifts: a subagent's call is refused.`

export const GUIDE_SECTIONS = ['flow', 'records', 'migration'] as const
export const GUIDE_DESCRIPTION = `Read once before your first shift in a project. Use section "flow" for the shift, letter, refusals and saved history. Use "records" for documentation and keeping records. Use "migration" for upgrading an existing project and retiring old files.`

export const SETUP_DESCRIPTION =
  "How the mod is set up in this project: every key of settings.toml with its value here, its default and the mod's version it came in; the records by every check a shift makes; the files loaded into every session and whether this session's copy is older than them; the documents with remarks; the layout of .shift/. Call it when setting a project up, after the mod or the settings changed, or when the session's files look stale."

export const TASKS_DESCRIPTION = 'Show the project-local Beads command for listing tasks'

export const SHIFT_NOW_DESCRIPTION = 'Ask the agent to shift now; words typed after it go to the agent with the ask'

export const RESUME_DESCRIPTION = 'Pick up the work from the last shift: the letter and current board go to the agent'

export const SETUP_SCHEMA = { type: 'object', properties: {} }

export const HISTORY_DESCRIPTION = `Past shifts in brief, oldest first: their IDs, outcomes and descriptions. count — how many of the latest (default ${HISTORY_DEFAULT}).`

export const STATUS_DESCRIPTION =
  'How full the history is: used of the window, where the harness lets it go by itself, the growth since the last shift, when the next shift hints come, and what the history grew from most. Read-only.'

export const STATUS_SCHEMA = { type: 'object', properties: {} }

export const OUTLINE_DESCRIPTION =
  "A document's description and its ## and ### sections with line numbers, to read only the section you need. path — from the project's root."

export const OUTLINE_SCHEMA = {
  type: 'object',
  properties: { path: { type: 'string', description: "The document, from the project's root." } },
  required: ['path'],
}

export const MENTIONS_DESCRIPTION =
  'Which documents of the project mention a file: its name without the folder, as a whole word. Call it after changing code, before calling the work done, to check those documents against the change.'

export const MENTIONS_SCHEMA = {
  type: 'object',
  properties: { file: { type: 'string', description: 'The file whose name to look for; a path or just the name.' } },
  required: ['file'],
}

export const GUIDE_SCHEMA = {
  type: 'object',
  properties: {
    section: { type: 'string', enum: [...GUIDE_SECTIONS], description: 'Optional part to read. Omit for the complete guide.' },
  },
}

export const HISTORY_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['list', 'read', 'compare', 'export', 'delete', 'search'] },
    id: { type: 'string', description: 'Saved shift ID.' },
    query: { type: 'string', description: 'Local search across saved shift records.' },
    before: { type: 'string', description: 'List shifts older than this saved ID (exclusive).' },
    other: { type: 'string', description: 'Second ID to compare against.' },
    file: { type: 'string', description: 'Record to read, default letter.md.' },
    count: {
      type: 'integer',
      minimum: 1,
      maximum: HISTORY_MAX,
      description: `How many of the latest shifts to show, default ${HISTORY_DEFAULT}.`,
    },
  },
}

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    letter: {
      type: 'string',
      description: `The logical path of the applied working letter, usually ${LETTER}. Open "Where I am" with 2–3 short sentences about the work and its outcome. Shift uses that paragraph in history.`,
    },
    after: {
      type: 'string',
      enum: [...AFTER],
      description: 'continue — you go on right after the shift; wait — you wait for the owner.',
    },
    about: {
      type: 'string',
      description: `Optional legacy description. Omit when using the opening paragraph of the letter.`,
    },
  },
  required: ['letter', 'after'],
}

// What the model and the owner read of each tool: the label a harness shows, the description, the line of the
// doctrine's tool list, and the schema of its arguments.
export type ToolText = { label: string; description: string; brief: string; schema: Record<string, unknown> }

export const TOOL_TEXTS: Record<string, ToolText> = {
  [READ_TOOL]: {
    label: 'Read knowledge or documentation',
    brief: 'read a mapped file, topic or single entry by heading.',
    description:
      'Read a project document or local knowledge file from the map in SHIFT.md. Pass an exact heading to read its text and nested entries. Omit section for the whole file.',
    schema: { type: 'object', properties: { path: { type: 'string' }, section: { type: 'string' } }, required: ['path'] },
  },
  [RECORD_TOOL]: {
    label: 'Working records',
    brief: 'read, edit and import current Markdown records.',
    description:
      'Read current Markdown by logical name. Replace one exact passage at its revision. For long edits checkout a temporary file, edit it and apply using the returned revision. Use drafts to recover a draft or discard to remove it. Import validates existing internal files before adopting them together. Delete removes a current knowledge record at its revision after its loose source has been retired.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'replace', 'checkout', 'apply', 'drafts', 'discard', 'delete', 'import'] },
        name: { type: 'string', description: 'board.md, letter.md, OWNER.md, GLOSSARY.md, SHIFT.md or knowledge/<name>.md' },
        revision: { type: 'string' },
        find: { type: 'string' },
        replacement: { type: 'string' },
        section: { type: 'string' },
      },
      required: ['action'],
    },
  },
  [GUIDE_TOOL]: {
    label: 'Shift guide',
    description: GUIDE_DESCRIPTION,
    brief: 'the shift procedure and record formats, optionally by section.',
    schema: GUIDE_SCHEMA,
  },
  [TOOL]: { label: 'Shift', description: TOOL_DESCRIPTION, brief: 'make a shift.', schema: TOOL_SCHEMA },
  [HISTORY_TOOL]: {
    label: 'Shift history',
    description: HISTORY_DESCRIPTION,
    brief: 'what happened in past shifts, briefly.',
    schema: HISTORY_SCHEMA,
  },
  [STATUS_TOOL]: {
    label: 'Shift status',
    description: STATUS_DESCRIPTION,
    brief: 'how full the history is, when the next hints come, and what it grew from.',
    schema: STATUS_SCHEMA,
  },
  [SIZES_TOOL]: {
    label: 'Shift sizes',
    description:
      'Report estimated token counts by entity for the session and continuation, and for the last three saved letters. Returns sizes and paths only.',
    brief: 'sizes of delivered records and saved letters.',
    schema: SETUP_SCHEMA,
  },
  [SETUP_TOOL]: {
    label: 'Shift setup',
    description: `${SETUP_DESCRIPTION} Use section runtime to check the bundled executable or tasks to prepare and locate the project command.`,
    brief:
      "how the mod is set up here: the settings with their values and the version each came in, the session's files and whether they changed since the session read them, the documents with remarks.",
    schema: { type: 'object', properties: { section: { type: 'string', enum: ['runtime', 'tasks', 'sbd'] } } },
  },
  [OUTLINE_TOOL]: {
    label: 'Document outline',
    description: OUTLINE_DESCRIPTION,
    brief: "a document's description and sections with line numbers: read only the section you need.",
    schema: OUTLINE_SCHEMA,
  },
  [MENTIONS_TOOL]: {
    label: 'Documents mentioning a file',
    description: MENTIONS_DESCRIPTION,
    brief: 'which documents mention a file: call it after changing code, before calling the work done.',
    schema: MENTIONS_SCHEMA,
  },
}
