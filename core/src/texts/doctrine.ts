import {
  ABOUT_MAX,
  ARCHIVE,
  ARCHIVE_TOOL,
  BOARD,
  BOARD_MAX_LINES,
  DIR,
  FOCUS,
  GUIDE_TOOL,
  HISTORY_DEFAULT,
  HISTORY_TOOL,
  INDEX,
  KINDS,
  KNOWLEDGE,
  KNOWLEDGE_MAX_LINES,
  LETTER,
  MOD,
  OWNER,
  OWNER_MAX_LINES,
  OWNER_SECTION,
  RECENT_SHIFTS,
  RESUME_COMMAND,
  SETTINGS,
  STATUS_TOOL,
  STATUSES,
  TASK_SECTIONS,
  TASKS,
  TOOL,
} from '../layout'

const BOARD_RULES = `The board is a state, not a diary:
- lines are rewritten in place, nothing new is appended on top of the old;
- no dates anywhere, in the board or in tasks: each shift's time is recorded by itself;
- no more than ${BOARD_MAX_LINES} lines.

Sections, as \`##\` headings, all required (an empty one says "none"):
- "Goal" — what the project is for and how that changed, briefly;
- "Tasks" — every open task, one line each: \`- [status] <name> — what matters\`, status: ${FOCUS.join(', ')}; deferred and waiting — with the reason;
- "Decisions" — yours, for the whole project, with the reason;
- "Dead ends" — approaches ruled out for the whole project, and why.

A decision or dead end goes on the board only if it outlives any one task; otherwise it belongs to the task.`

const OWNER_RULES = `\`${OWNER}\` is the owner's decisions in force for the whole project: a code of rules as it stands now, not a log. Verbatim where the owner's words matter, grouped under \`##\` headings by meaning, no dates, no "revoked" marks, no more than ${OWNER_MAX_LINES} lines; no decisions yet — "none". A new word is checked against what is written: it contradicts a rule — the rule is rewritten; it narrows, widens or refines one — the rule is rewritten to cover both; it is new — a new line. A rule changes or goes only on the owner's word. A decision that binds one task goes to that task's "${OWNER_SECTION}".`

const KNOWLEDGE_KINDS = `- \`traps\` — what behaves not as expected: \`### <symptom>\`, then ${KINDS.traps.join(' and ')};
- \`lessons\` — an approach that worked or failed: \`### <approach>\`, then ${KINDS.lessons.join(' and ')};
- \`runbook\` — what is run and with what: \`### <task>\`, a command block, then ${KINDS.runbook.join(' and ')};
- \`facts\` — how the project, its tools or its harness behave: \`### <fact>\`, then ${KINDS.facts.join(' and ')} (how it was established);
- \`glossary\` — the project's own names, codes, abbreviations: \`- **<term>** — <meaning>\` lines.`

const KNOWLEDGE_RULES = `\`${KNOWLEDGE}/\` is what you learned that stays true for months: traps, lessons, commands, facts, terms. One file per kind — \`<kind>.md\`, or \`<kind>-<topic>.md\` once split by topic; a frontmatter with \`kind\` and \`about\` (what is in the file and where the neighbouring files are); entries grouped under \`##\` headings by topic. Kinds and the fields every entry carries:
${KNOWLEDGE_KINDS}

No dates, no more than ${KNOWLEDGE_MAX_LINES} lines per file. Freshness is checked when an entry is used, not by age: an entry that lied is fixed or removed right away; a trap met a third time is rewritten as a rule. Writing into a section, clear out what is dead there: a trap about code that is gone, an entry a later one covers, a one-off case with no conclusion, a copy of the project's docs. After a shift only the map of knowledge comes back — read a file when its topic comes up.`

const PLACES = `| What | Where |
|---|---|
| the owner's decision for the whole project | \`${OWNER}\` |
| the owner's decision for one task | that task's "${OWNER_SECTION}" |
| your decision or dead end for the whole project | the board |
| your decision or dead end for one task | the task's \`task.md\` |
| open work and its progress | \`${TASKS}/<name>/\` |
| what you were doing, what is next, what is unverified | the letter |
| a trap, a lesson, a command, a fact, a term | \`${KNOWLEDGE}/\`, unless the owner said it goes to the project's docs |
| fits no row | \`${KNOWLEDGE}/\`, and tell the owner |

Whether knowledge goes into the project's own docs (\`AGENTS.md\`, \`docs/\`, read by people and every contributor) or stays in \`${KNOWLEDGE}/\` is the owner's choice, not yours: all of it in the docs, all of it local, or split by a boundary the owner names. The owner sets it as \`knowledge\` in \`${SETTINGS}\` — "local", "project" or "split"; with "split" the boundary is a rule in \`${OWNER}\`. After a shift the map of knowledge says which. Until it is set, everything stays in \`${KNOWLEDGE}/\` — never write the project's shared files on your own guess — and ask the owner once. What the project's docs already say is never copied into your records.

Each fact lives in one place. Your records live in the project directory, not in a harness's memory: any agent that opens the project reads them.`

const TASK_RULES = `A task is one line of work, split by meaning: a feature, an adapter, a migration. Each lives in \`${TASKS}/<name>/\`, \`<name>\` in lowercase latin with dashes:
- \`task.md\` — what the task is: a \`# <title>\` line; optionally \`continues: ${ARCHIVE}/<name>/\` lines, one per archived task it picks up; then sections ${TASK_SECTIONS.map(s => `"${s}"`).join(', ')}, all required ("none" if empty). Update it as the task changes. Decisions and dead ends that matter only inside this task go here;
- \`track.md\` — the task's tracker: one line per item, \`- [status] item — what matters\`, status: ${STATUSES.join(', ')}. Add items as you go, update their status in place; closed items stay until the task is archived — the track is the task's history.

Every folder in \`${TASKS}/\` is on the board, and every board task has its folder. What is "in progress" on the board is what you are doing now — one task, several, or none.`

// The section's text without its tag, for a harness that wraps a prompt section in a tag of its own.
export const DOCTRINE_BODY = `# Shift

You work in stretches and decide yourself when to shift: the stretch's history is let go, and you continue from where you stopped. You do not change — only what is in front of you does. So everything you need next must be in your records, and a thought you have not written down yet goes into a letter to yourself.

## Board and tasks

\`${BOARD}\` is the state of the work: which tasks are open and which you are doing now. Each task has its own folder with a description and a tracker. Keep them as you go, not before a shift: took a task, finished an item, dropped one, made a decision, heard the owner's decision, hit a dead end — fix the board, \`${OWNER}\` or the task right away. No board — create it.

${BOARD_RULES}

${TASK_RULES}

A finished or dropped task goes to the archive through \`${ARCHIVE_TOOL}\`; \`${INDEX}\` lists every archived task. A new task may continue an archived one. The project may also have a tracker of its own; it is a different thing — do not link tasks to it.

## Owner's decisions and knowledge

${OWNER_RULES}

\`${KNOWLEDGE}/\` holds traps, lessons, commands, facts and terms, one file per kind (${Object.keys(KINDS).join(', ')}); write an entry when you learn it, read a file when its topic comes up. The layout and entry fields are in \`${GUIDE_TOOL}\`.

What goes where:

${PLACES}

## When to shift

At a stage boundary: an item or a task is done, a commit is made, the plan moved to its next step — and the stretch's history is not needed whole any more. Not in the middle of a thought that is easier to finish than to write down.

The mod hints with a "Shift hint" line at the end of a tool result or next to a message: when the history has grown noticeably since the last shift, and when room is running out. A hint names what the history grew from most. A hint is not an order: you decide.

## Tools

- \`${GUIDE_TOOL}\` — how to shift properly and how the files are laid out. Read it before the first shift of a session.
- \`${TOOL}\` — make a shift.
- \`${ARCHIVE_TOOL}\` — archive a finished or dropped task.
- \`${HISTORY_TOOL}\` — what happened in past shifts, briefly.
- \`${STATUS_TOOL}\` — how full the history is, when the next hints come, and what it grew from.`

// In a tag that names the mod: the agent tells this section from the owner's own instructions.
export const DOCTRINE = `<${MOD} note="how the ${MOD} mod works: its tools, its records and when to shift">
${DOCTRINE_BODY}
</${MOD}>`

export const GUIDE = `# Shift: how it works and how to do it right

A shift is the boundary between stretches of work. You prepare your records, call \`${TOOL}\`, the stretch's history is let go, and you continue from your letter. You do not change: you write the letter to yourself, not to a successor.

## Files

\`\`\`
${DIR}/
├── board.md          the board — which tasks are open, what you do now, project-wide decisions
├── owner.md          the owner's decisions in force for the whole project
├── settings.toml     the owner's settings, optional — see below
├── letter.md         the letter to yourself — written anew before every shift
├── knowledge/        traps, lessons, commands, facts, terms — read on demand
│   └── <kind>[-<topic>].md
├── tasks/
│   └── <name>/
│       ├── task.md   what the task is, its decisions and dead ends
│       └── track.md  the task's tracker
├── archive/          written by ${ARCHIVE_TOOL}; do not edit
│   ├── index.md      one line per archived task
│   └── <name>/       the task's folder as it was
└── shifts/           history, written by the mod; do not edit
    └── <YYYYMMDD-hhmmss UTC>/
        ├── about.md      the shift in brief — strict structure below
        ├── letter.md     a copy of the letter
        ├── board.md      a snapshot of the board
        ├── owner.md      a snapshot of the owner's decisions
        ├── settings.toml a snapshot of the settings
        ├── index.md      a snapshot of the archive index
        ├── tasks/        snapshots of the open tasks
        ├── knowledge/    a snapshot of the knowledge
        └── summary.md    what stayed in memory after the shift
\`\`\`

\`${DIR}/\` is yours, not the project's: the project's git ignores it (\`/${DIR}/\` in \`.gitignore\`), and the mod refuses a shift inside a git repository that does not. It needs no git of its own: every shift snapshots the board, the owner's decisions, the tasks and the knowledge, so removing a line is safe.

\`${SETTINGS}\` is the owner's, and you change it only on their word. Both keys are optional:
- \`enabled = false\` turns the mod off in this project from the next session: no tools, no doctrine, no hints;
- \`knowledge = "local" | "project" | "split"\` — where knowledge goes, see below.
A file that does not parse leaves the mod on, and a shift is refused until it is fixed.

## What goes where

${PLACES}

## Board — \`${BOARD}\`

${BOARD_RULES}

## Owner's decisions — \`${OWNER}\`

${OWNER_RULES}

## Tasks — \`${TASKS}/\`

${TASK_RULES}

## Knowledge — \`${KNOWLEDGE}/\`

${KNOWLEDGE_RULES}

## No dates

No record carries a date: a model writes them everywhere, and records turn into a diary. Which of two rules is newer is never a question — a newer word rewrites the older line in place and a revoked one is removed, so only what is in force stands. When something was decided, the shift snapshots tell: \`${HISTORY_TOOL}\` finds the stretch, its folder holds the records as they were.

## Archive — \`${ARCHIVE}/\`

When a task is finished or dropped, call \`${ARCHIVE_TOOL}\`:
- \`name\` — the task's folder name;
- \`outcome\` — \`done\` (every track item is done or dropped) or \`dropped\` (the reason goes into \`about\`);
- \`about\` — one line up to ${ABOUT_MAX} characters: what the task was and how it ended. This is the index line you will look the task up by.

The tool moves the folder to \`${ARCHIVE}/<name>/\` and adds \`- [<outcome>] [<title>](<name>/) — <about>\` to \`${INDEX}\`, with \`; continues <name>, …\` if the task continued archived ones. Then remove the task's line from the board, and lift to the board any of its decisions that still bind beyond it.

To come back to an archived topic, open a new task and put \`continues: ${ARCHIVE}/<name>/\` in its \`task.md\`; read the archived folder first.

## Letter — \`${LETTER}\`

Written anew, whole, before every shift. Sections \`##\`, all required and non-empty (nothing to say — "none"):
- "Where I am" — what you were doing at this moment, the thought you did not finish;
- "Next" — steps: a command or a file and what you expect;
- "Unverified" — and what not to trust;
- "Hold" — what from this stretch must stay in memory exactly: paths, commands, error texts, values, the line of reasoning. Only this section steers what stays in memory; do not repeat the board, the tasks or the letter — they come back to you whole.

## How to shift

1. Board and tasks: every open task on the board with its focus status, each touched task's track up to date, decisions recorded where they belong, finished tasks archived.
2. The letter — by the sections above.
3. Call \`${TOOL}\`:
   - \`letter\` — the path to the letter, usually \`${LETTER}\`;
   - \`after\` — \`continue\` if there is work to do without the owner; \`wait\` if the owner is needed or the work is over;
   - \`about\` — one line up to ${ABOUT_MAX} characters: what the stretch did and where you stand. This is the history line you will look the stretch up by, and it comes back after the next shifts: write the work, not whether you continue or wait.
4. End the turn with one line, no further actions.

After the shift, the first message is "Shift done": the board, the owner's decisions and the tasks in progress, whole, and the map of knowledge; then the descriptions of the last ${RECENT_SHIFTS} shifts; your letter last. Continue from "Next". With \`wait\` they come together with the owner's next message. Three \`continue\` in a row without the owner — the mod then waits for the owner itself.

## When the mod refuses

A refusal names the reason; fix it and call again:
- no letter at the path, a section missing or empty;
- no board, a section missing, more than ${BOARD_MAX_LINES} lines, an "${OWNER_SECTION}" section left on it;
- no \`${OWNER}\`, an empty one, more than ${OWNER_MAX_LINES} lines;
- a knowledge file with an unknown \`kind\`, a name not of its kind, no \`about\`, more than ${KNOWLEDGE_MAX_LINES} lines, an entry without its fields;
- a date (\`YYYY-MM-DD\` or \`DD.MM.YYYY\`) in any record;
- \`${DIR}/\` not ignored by the project's git;
- a board task with an unknown status or name, a task folder missing from the board, a board task without a folder;
- a task without \`task.md\` or \`track.md\`, without a title or a section, a track item without a status;
- nothing changed in the records since the last shift;
- \`about\` empty, multi-line or longer than ${ABOUT_MAX} characters.

## about.md — strict structure

\`\`\`
---
description: <about from the call>
at: <ISO time of the shift, UTC>
after: continue | wait
result: pending | shifted (<before> → <after>), continuing | shifted (…), waiting for the owner | shifted (…), waiting: … in a row without the owner | not shifted: <reason>
tokens: <before> → <after>
summary_chars: <size of summary.md>
session: <session id>
---

## Done
- <task>: <item — what matters>      or "none"

## Dropped
- <task>: <item — reason>            or "none"

## Archived
- <the index line>                   or "none"

## Open
- [<focus>] <task> — what matters    or "none"
\`\`\`

How to read it: frontmatter — \`key: value\` lines between \`---\`; sections — by \`## \` headings, items — lines starting with \`- \`. "Done" and "Dropped" — track items closed during this stretch (not closed in the previous shift's snapshot); "Archived" — index lines added during this stretch; "Open" — the board's tasks at the moment of the shift. The mod derives all of it from the files, not you. \`result: pending\` on an old folder means the session broke off before the shift finished.

## History and a new session

- \`${HISTORY_TOOL}\` with \`count\` (default ${HISTORY_DEFAULT}) — the last shifts in brief: time, outcome, description, what was done, dropped and archived, and for the last one what is open. The stretch in detail — \`letter.md\`, \`board.md\` and \`tasks/\` of its folder.
- \`${INDEX}\` — every archived task, one line each.
- In a new session the owner calls \`/${RESUME_COMMAND}\`: the last shift's letter, the board, the owner's decisions, the tasks in progress and the map of knowledge come to you; continue from "Next".

## Coming from \`.shift\`

A project kept with the \`shift\`/\`unshift\` skills has \`.shift/\`. Move it once, before the first shift, entry by entry — nothing is summarized away:
- \`knowledge/owner.md\` → \`${OWNER}\`, rules as they are;
- \`knowledge/traps*.md\`, \`lessons*.md\`, \`runbook*.md\`, \`glossary*.md\` → \`${KNOWLEDGE}/\` under the same names: keep \`kind\` and \`about\`, rename the entry fields (Причина → Cause, Делать → Do, Почему → Why, Когда не годится → Not when, Покажет → Shows), drop the date lines and the generated tables of contents;
- the \`knowledge\` setting of \`.shift/AGENTS.md\` (\`project\`, \`local\`, \`split\`) is the owner's choice of where knowledge goes → \`knowledge\` in \`${SETTINGS}\`; its "Что где" rows → a rule in \`${OWNER}\`, as they are;
- open items of the last snapshot's \`unfinished.md\` and its "С чего начать" → tasks; its owner decisions → \`${OWNER}\` or the task's; dead ends → the board or the task;
- \`.shift/sessions/\` is not moved: it is history. \`.shift/\` itself is removed only on the owner's word.

The text of records may stay in its language, and the owner is quoted verbatim; section names and entry fields are the ones above.`
