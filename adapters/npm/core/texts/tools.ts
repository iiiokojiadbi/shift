// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import {
  ABOUT_MAX,
  AFTER,
  ARCHIVE,
  ARCHIVE_TOOL,
  FOCUS,
  GUIDE_TOOL,
  HISTORY_DEFAULT,
  HISTORY_MAX,
  HISTORY_TOOL,
  INDEX,
  LETTER,
  MENTIONS_TOOL,
  NAME_RULE,
  NAMES,
  OPEN_TOOL,
  OUTCOMES,
  OUTLINE_TOOL,
  SETUP_TOOL,
  STATUS_TOOL,
  STATUSES,
  TASK_LIST,
  TASKS,
  TOOL,
  TRACK_TOOL,
} from '../layout'
import { quote } from '../markdown'

export const TOOL_DESCRIPTION = `Make a shift: the stretch's history is let go, and you continue from your letter to yourself (after: continue) or wait for the owner (after: wait). Before the call the board, the tasks and the letter must be ready — how is in ${GUIDE_TOOL}, read once per project. After the call, end the turn: one line with continue; with wait, your whole answer to the owner — it is all they read. Only the main agent shifts: a subagent's call is refused.`

export const GUIDE_DESCRIPTION =
  'How to shift: the steps, the letter, when the mod refuses, the strict structure of about.md, then the rules of the board, the tasks, the archive and the other records a shift checks. Read it once, before your first shift in a project; after that only when a refusal sends you to it — the steps do not change between shifts.'

export const SETUP_DESCRIPTION =
  "How the mod is set up in this project: every key of settings.toml with its value here, its default and the mod's version it came in; the records by every check a shift makes; the files loaded into every session and whether this session's copy is older than them; the documents with remarks; the layout of .shift/ and moving from earlier layouts. Call it when setting a project up, after the mod or the settings changed, or when the session's files look stale."

export const TASKS_DESCRIPTION = 'The open tasks and the items of those in progress, read from .shift/; the agent is not asked'

export const SHIFT_NOW_DESCRIPTION = 'Ask the agent to shift now; words typed after it go to the agent with the ask'

export const RESUME_DESCRIPTION = 'Pick up the work from the last shift: the letter, the board and the tasks in progress go to the agent'

export const SETUP_SCHEMA = { type: 'object', properties: {} }

export const HISTORY_DESCRIPTION = `Past shifts in brief, oldest first: time, outcome, description, what the stretch did, dropped and archived, and for the last one what is open. count — how many of the latest (default ${HISTORY_DEFAULT}).`

export const OPEN_DESCRIPTION = `Open a task instead of creating its files by hand: writes ${TASKS}/<name>/${NAMES.task} with its sections, ${NAMES.track} with the first items, and the task's line with its links in ${TASK_LIST}, all checked first — a refusal writes nothing. Decisions, dead ends and owner decisions start as "none".`

const LINK_LINES = (what: string) => ({
  type: 'array',
  items: { type: 'string' },
  description: `Task names, each optionally followed by " — why": ${what}.`,
})

export const OPEN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: `The folder name in ${TASKS}/: ${NAME_RULE}.` },
    title: { type: 'string', description: "One line: the task.md's # title." },
    goal: { type: 'string', description: 'What the task is for: the "Goal" section.' },
    done_when: { type: 'string', description: 'When it is finished: the "Done when" section.' },
    status: { type: 'string', enum: [...FOCUS], description: 'in progress by default; deferred or waiting carries its reason in about.' },
    about: {
      type: 'string',
      description: `One line up to ${ABOUT_MAX} characters after the task's line in ${TASK_LIST}: what it is, and why it waits if it does.`,
    },
    items: {
      type: 'array',
      items: { type: 'string' },
      description: 'The first track items, each "item — what matters" or just "item"; all open.',
    },
    needs: LINK_LINES('open tasks this one cannot finish without'),
    after: LINK_LINES('archived tasks it stands on; an open one is "needs"'),
    continues: LINK_LINES('archived tasks it picks up'),
  },
  required: ['name', 'title', 'goal', 'done_when', 'about'],
}

export const ARCHIVE_DESCRIPTION = `Archive a finished or dropped task: moves ${TASKS}/<name>/ to ${ARCHIVE}/<name>/ and adds its line to ${INDEX}. It also takes the task out of ${TASK_LIST}.`

export const TRACK_DESCRIPTION = `Set a status instead of editing the records by hand. With id: the track item with that id, the number in its "#<id>". With item: a new item with that text, given the next id; its text differs from every item's in the track, case aside. Without either: the task's own status in ${TASK_LIST}. status — for an item ${quote(STATUSES)}; for a task ${quote(FOCUS)}. note — replaces what follows " — ": what matters, or the reason a task is deferred or waits (required then). Several items at once — when a stage closes one item and opens the next: items, a list of {id or item, status, note}, applied together or not at all; status beside items is then the task's own.`

export const TRACK_SCHEMA = {
  type: 'object',
  properties: {
    task: { type: 'string', description: `The task's folder name in ${TASKS}/.` },
    id: { type: 'integer', description: 'The track item to change: the number in its "#<id>".' },
    item: { type: 'string', description: 'The text of a new track item; what matters goes in note.' },
    status: { type: 'string', enum: [...new Set([...STATUSES, ...FOCUS])] },
    note: { type: 'string', description: 'One line: replaces what follows " — ".' },
    items: {
      type: 'array',
      description: 'Several items in one call, in place of id and item: each changed or added as alone; one that fails writes nothing.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          item: { type: 'string' },
          status: { type: 'string', enum: [...STATUSES] },
          note: { type: 'string' },
        },
        required: ['status'],
      },
    },
  },
  required: ['task'],
}

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

export const GUIDE_SCHEMA = { type: 'object', properties: {} }

export const HISTORY_SCHEMA = {
  type: 'object',
  properties: {
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
      description: `The path to the letter to yourself, usually ${LETTER}.`,
    },
    after: {
      type: 'string',
      enum: [...AFTER],
      description: 'continue — you go on right after the shift; wait — you wait for the owner.',
    },
    about: {
      type: 'string',
      description: `One line up to ${ABOUT_MAX} characters: what the stretch did and where you stand. The line of the shift history, shown after later shifts too; the work only, not whether you continue or wait.`,
    },
  },
  required: ['letter', 'after', 'about'],
}

export const ARCHIVE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: `The task's folder name in ${TASKS}/.` },
    outcome: {
      type: 'string',
      enum: [...OUTCOMES],
      description: 'done — every track item is done or dropped; dropped — the task is abandoned, the reason goes into about.',
    },
    about: {
      type: 'string',
      description: `One line up to ${ABOUT_MAX} characters: what the task was and how it ended. The line of the archive index.`,
    },
  },
  required: ['name', 'outcome', 'about'],
}

// What the model and the owner read of each tool: the label a harness shows, the description, the line of the
// doctrine's tool list, and the schema of its arguments.
export type ToolText = { label: string; description: string; brief: string; schema: Record<string, unknown> }

export const TOOL_TEXTS: Record<string, ToolText> = {
  [GUIDE_TOOL]: {
    label: 'Shift guide',
    description: GUIDE_DESCRIPTION,
    brief:
      'how to shift properly and how the files are laid out. Read it once, before your first shift in a project; after that only when a refusal sends you to it — the steps do not change between shifts.',
    schema: GUIDE_SCHEMA,
  },
  [TOOL]: { label: 'Shift', description: TOOL_DESCRIPTION, brief: 'make a shift.', schema: TOOL_SCHEMA },
  [OPEN_TOOL]: {
    label: 'Open a task',
    description: OPEN_DESCRIPTION,
    brief: `open a task: its folder, task.md, track.md and its line in \`${TASK_LIST}\`, checked before anything is written.`,
    schema: OPEN_SCHEMA,
  },
  [ARCHIVE_TOOL]: {
    label: 'Archive a task',
    description: ARCHIVE_DESCRIPTION,
    brief: 'archive a finished or dropped task.',
    schema: ARCHIVE_SCHEMA,
  },
  [TRACK_TOOL]: {
    label: 'Task status',
    description: TRACK_DESCRIPTION,
    brief: `set a track item's status by its id or add an item, several at once with items; without either, the task's own status in \`${TASK_LIST}\`.`,
    schema: TRACK_SCHEMA,
  },
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
  [SETUP_TOOL]: {
    label: 'Shift setup',
    description: SETUP_DESCRIPTION,
    brief:
      "how the mod is set up here: the settings with their values and the version each came in, the session's files and whether they changed since the session read them, the documents with remarks.",
    schema: SETUP_SCHEMA,
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
