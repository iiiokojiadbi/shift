import { ABOUT_MAX, ARCHIVE, GUIDE_TOOL, HISTORY_DEFAULT, HISTORY_MAX, INDEX, LETTER, TASKS } from '../layout'

export const TOOL_DESCRIPTION = `Make a shift: the stretch's history is let go, and you continue from your letter to yourself (after: continue) or wait for the owner (after: wait). Before the call the board, the tasks and the letter must be ready — how, see ${GUIDE_TOOL}. After the call, end the turn with one line.`

export const GUIDE_DESCRIPTION =
  'How a shift works and how to do it right: the files, the board, the tasks and the archive, the letter, the strict structure of about.md, when the mod refuses. Read it before the first shift of a session.'

export const HISTORY_DESCRIPTION = `Past shifts in brief, oldest first: time, outcome, description, what the stretch did, dropped and archived, and for the last one what is open. count — how many of the latest (default ${HISTORY_DEFAULT}).`

export const ARCHIVE_DESCRIPTION = `Archive a finished or dropped task: moves ${TASKS}/<name>/ to ${ARCHIVE}/<name>/ and adds its line to ${INDEX}. It also takes the task out of TASKS.md.`

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
      enum: ['continue', 'wait'],
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
      enum: ['done', 'dropped'],
      description: 'done — every track item is done or dropped; dropped — the task is abandoned, the reason goes into about.',
    },
    about: {
      type: 'string',
      description: `One line up to ${ABOUT_MAX} characters: what the task was and how it ended. The line of the archive index.`,
    },
  },
  required: ['name', 'outcome', 'about'],
}
