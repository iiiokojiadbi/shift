import { type SbdCommand, taskInstructions } from '../beads'
import { TOC_END, TOC_START } from '../docs'
import {
  ABOUT_MAX,
  BOARD,
  BOARD_MAX_LINES,
  BOARD_SECTIONS,
  DIR,
  GLOSSARY,
  GUIDE_TOOL,
  KINDS,
  KNOWLEDGE,
  KNOWLEDGE_MAX_LINES,
  LETTER,
  MENTIONS_TOOL,
  MOD,
  NAMES,
  OLD_DIR,
  OLD_OWNER,
  OLD_TASKS_SECTION,
  OUTLINE_TOOL,
  OWNER,
  OWNER_MAX_LINES,
  SETTINGS,
  SHIFT_FILE,
  STATUS_TOOL,
  TASK_LIST,
  TOOL,
} from '../layout'
import { TOOL_TEXTS } from './tools'

// A list of sections in their order, each with what goes in it: a section without its text does not compile.
function described<Name extends string>(names: readonly Name[], texts: Record<Name, string>): string {
  return names.map((name, at) => `- "${name}" — ${texts[name]}${at === names.length - 1 ? '.' : ';'}`).join('\n')
}

const BOARD_RULES = `The board is a state, not a diary:
- lines are rewritten in place, nothing new is appended on top of the old;
- keep dates off the board; each shift records its own time;
- no more than ${BOARD_MAX_LINES} lines.

Sections, as \`##\` headings, all required (an empty one says "none"):
${described(BOARD_SECTIONS, {
  Goal: 'who or what the project serves and the outcome it must deliver, in a sentence or two. Rewrite when that outcome changes. Milestones and next steps belong to tasks',
  Decisions:
    'one line per choice other tasks still depend on. State what to do, when it applies and why. Revise that line when the choice changes. An alternative considered can go on the same line as `rejected: <option> — <why>`',
  'Dead ends':
    'one line per failed approach another task might try again. State what was tried, what happened and under which condition. Revisit when that condition changes',
})}

Example from a stocktaking project:
- Goal: Let warehouse staff record counts offline and sync them when connectivity returns.
- Decisions: Assign each count an ID on the device so retrying a sync cannot count it twice.
- Dead ends: Deduplicating by timestamp merged distinct counts on devices with identical clocks. Keep this warning while old devices send timestamps alone.

When taking over an existing board or closing a task, ask of each affected line: what would another task do differently after reading this? Keep that instruction short. Put single-task findings with the task. Keep owner policy in the owner record. Store useful background once according to the project's knowledge rules (local knowledge works without project docs). Check that its destination preserves the reason before removing a still-useful detail. Drop superseded or duplicated lines; earlier boards remain in shift snapshots. Age alone says nothing about whether a rule still applies.`

const OWNER_RULES = `\`${OWNER}\` is the owner's decisions in force for the whole project: a code of rules as it stands now, not a log. Verbatim where the owner's words matter, grouped under \`##\` headings by meaning, no dates, no "revoked" marks, no more than ${OWNER_MAX_LINES} lines; no decisions yet — "none". A new word is checked against what is written: it contradicts a rule — the rule is rewritten; it narrows, widens or refines one — the rule is rewritten to cover both; it is new — a new line. A rule changes or goes only on the owner's word. A decision that binds one task goes in the Beads issue.`

const KNOWLEDGE_KINDS = `- \`traps\` — what behaves not as expected: \`### <symptom>\`, then ${KINDS.traps.join(' and ')};
- \`lessons\` — an approach that worked or failed: \`### <approach>\`, then ${KINDS.lessons.join(' and ')};
- \`runbook\` — what is run and with what: \`### <task>\`, a command block, then ${KINDS.runbook.join(' and ')};
- \`facts\` — how the project, its tools or its harness behave: \`### <fact>\`, then ${KINDS.facts.join(' and ')} (how it was established).

Terms are not a kind: they live in \`${GLOSSARY}\`.`

const KNOWLEDGE_RULES = `\`${KNOWLEDGE}/\` is what you learned that stays true for months: traps, lessons, commands, facts. One file per kind — \`<kind>.md\`, or \`<kind>-<topic>.md\` once split by topic; a frontmatter with \`kind\` and \`about\` (what is in the file and where the neighbouring files are); entries grouped under \`##\` headings by topic. Kinds and the fields every entry carries:
${KNOWLEDGE_KINDS}

No dates, no more than ${KNOWLEDGE_MAX_LINES} lines per file. Freshness is checked when an entry is used, not by age: an entry that lied is fixed or removed right away; a trap met a third time is rewritten as a rule. Writing into a section, clear out what is dead there: a trap about code that is gone, an entry a later one covers, a one-off case with no conclusion, a copy of the project's docs. After a shift only the map of knowledge comes back — read a file when its topic comes up.`

const GLOSSARY_RULES = `\`${GLOSSARY}\` holds the project's own words, one article each — names, codes, abbreviations, terms that mean something particular here:

\`\`\`
## Stretch
Variants: stretches
Means: the work between two shifts.
Avoid: session
Where: the owner says «отрезок».
Unconfirmed: is a stretch ever longer than a session?
\`\`\`

Each field is one line. \`Means\` says what the thing is, not what it does, in one or two sentences; \`Avoid\` — words not to use for it, so one thing has one name; \`Variants\` and \`Where\` as needed. Labels are in English; the term and its meaning in the language the term lives in. Write an article as a term settles in the talk, not at a shift. A meaning you inferred and did not check with the owner carries \`Unconfirmed: <what to ask>\` — ask, then drop the line. Only this project's words; no general programming terms.`

const SHIFT_RULES = `\`${SHIFT_FILE}\` is how this project keeps its knowledge: rules written on the owner's word — where each kind of knowledge goes, how the documents are kept — and a map of the documents the mod writes between its markers. The map lists each document the settings name — a folder of them, or one such as \`AGENTS.md\` — with its \`description:\` (frontmatter: what is in the file and when to open it) and its \`##\` sections. With \`archived: true\` in its frontmatter, the entry shows its path, archive status, description and pins. Use \`${OUTLINE_TOOL}\` for its sections. The map only points: numbers, commands and names come from the document itself. A document without a description shows as such — give it one. A folder or a document of the settings with nothing to list is named in the map as \`no such folder\`, \`no documents\` or \`no such file\`: the project has no docs there, do not go searching. With \`[docs] dirs = []\` the owner turned the map off: leave the project's docs as they are.

A \`> [!IMPORTANT]\` block in one of those documents is pinned: the map shows it under its document with its section, so it is in front of you in every session without opening the document. Pin only what you would get wrong in any task without it, in a line or two; change it in the document, never in the map. Nothing is pinned until you pin it. Past \`[docs] max_pinned\` the map says so and still shows every block — unpin what is not needed in every task.

Those documents the mod keeps as you write them. After an Edit or a Write the map follows at once; with \`[docs] toc = true\` each document carries a toc between \`${TOC_START}\` and \`${TOC_END}\` under its \`# \` title, written by the mod from its \`##\` and \`###\` and the \`> \` line under a heading — never edit it by hand. The rest waits until the run is over, so a set of documents can be written in any order: with the next message the mod writes the tocs of the files you wrote — by any tool, a script's change is found by its file's stamp — and checks them, in one note — the tocs it wrote, so read such a file again before editing it, and the remarks: no description, a description or a file over the limits the settings set, a link to a document that is not there. Silence means all is well. The documents with remarks also come after a shift.`

// The section's text without its tag, for a harness that wraps a prompt section in a tag of its own; the tools are the
// ones shown in this project, in the order given.
const LETTER_OPENING = `Open "Where I am" with one paragraph of 2–3 short sentences (up to ${ABOUT_MAX} characters). Say what you worked on, what you found or verified, and where that leaves the work. This paragraph becomes the description in later shift history.`

export function doctrineBody(tools: readonly string[], command?: SbdCommand | null): string {
  return `# Shift

You work in stretches and decide yourself when to shift: the stretch's history is let go, and you continue from where you stopped. You do not change — only what is in front of you does. So everything you need next must be in your records, and a thought you have not written down yet goes into a letter to yourself.

## Board and tasks

\`${BOARD}\` keeps the project outcome and choices other tasks depend on. ${taskInstructions(command)} Update a task, owner rule, board decision or glossary term when it changes. No board — create it. Before starting the next item, record the outcome of this one. When a change affects a documented interface, workflow or design decision, choose its document by the behavior that changed and update it alongside the change. ${tools.includes(MENTIONS_TOOL) ? `Use \`${MENTIONS_TOOL}\` to find additional filename references. ` : ''}Follow the project's knowledge rules in \`${SHIFT_FILE}\`. At shift time, check the records and write the letter. ${LETTER_OPENING}

\`${SHIFT_FILE}\`, \`${OWNER}\`, \`${GLOSSARY}\` come into the session. The board and letter return after a shift. The settings may move the first three elsewhere in the project.

Include a relevant task ID in the letter when it helps you resume. On the board, Goal names the current outcome, Decisions give cross-task choices and reasons, and Dead ends warn of observed failures others may repeat. When scope changes or a task closes, revise the affected lines in place and retire those that no longer guide other work. Keep task-specific decisions and evidence with the task. Read comments and closed work on demand. Dates belong to the mod's snapshots.

\`${OWNER}\` is the owner's standing decisions. On the owner's word, find the rule on that subject, check its scope and revise it in place. Add a line for a distinct decision. Quote wording that determines its meaning. Record decisions for one task in that task. Keep project terms in \`${GLOSSARY}\`. Read \`${SHIFT_FILE}\` for the project's knowledge rules, documentation map and pinned advice. Open the mapped document for details. Keep knowledge local in \`${KNOWLEDGE}/\` until the owner chooses its placement.

Read \`${GUIDE_TOOL}\` before your first shift in this project. For writing project documentation or keeping records, ask for section "records"; for the letter, a refusal or how to continue, use "flow".

## When to shift

Keep working until the first hint unless the owner asks for an earlier shift. Each shift rebuilds the history cache and rereads the records. A finished task alone is too early. \`${STATUS_TOOL}\` shows when the next hint comes.

A soft hint is optional. Shift at a stage boundary when you can continue from your records. At the final hint, shift now. Check the records, write the letter and call \`${TOOL}\` before starting more work. Use \`continue\` when work remains and you can proceed on your own.

## Tools

${tools.map(name => `- \`${name}\` — ${TOOL_TEXTS[name]?.brief ?? ''}`).join('\n')}`
}

// In a tag that names the mod: the agent tells this section from the owner's own instructions.
export function doctrine(tools: readonly string[], command?: SbdCommand | null): string {
  return `<${MOD} note="how the ${MOD} mod works: its tools, its records and when to shift">
${doctrineBody(tools, command)}
</${MOD}>`
}

const DOC_WRITING = `When you change what someone using or maintaining the project needs to know, update the relevant document in the same change, before taking the next item. Do this on your own initiative within the knowledge rules in \`${SHIFT_FILE}\`. A refactor that leaves the documented behavior accurate needs no new entry.

1. Name the reader's question. If a message can arrive during a shift, for example, the reader needs to know whether the agent receives its letter before answering. Use the map to find the document that explains that behavior. Where enabled, use \`${MENTIONS_TOOL}\` to catch other documents naming a changed file. A document can explain the behavior without naming the file.
2. Rewrite the affected passage in place. Say what happens, under which conditions, and why the distinction matters. Put exact commands and limits with the interface they belong to. For example, attach a character limit to the specific field and file. Link other mentions to that passage. Create a document when a distinct topic has no home. Give it a short \`description:\` saying what question it answers and when to open it. For example: "Which message reaches the agent first. Read before changing delivery during a shift." Use \`##\` headings a reader can choose from the map, such as "Messages received during a shift". Verify any command, field name or limit you publish against its source.
3. Keep the board useful at the next shift. A project-wide decision needs the action to preserve and the reason a future agent could get it wrong. For the message example, record the letter-first guarantee and why the answer depends on it. Link to the adapter document for event order and exceptions. Before shortening a long board entry, check that the linked section preserves the reasons worth keeping.
4. When the owner gives a decision, find earlier wording on the same subject. Name the scope (project, harness, task or field), fold refinements into the existing rule, and keep a quote where its wording matters. Recover an ambiguous reference from its source when possible. Ask if the evidence leaves two meanings that would lead to different actions.
5. When a design is superseded and its rationale is still useful, mark the reference \`archived: true\` and describe when to consult it. Keep current instructions in the active document. Read the resulting map entry as a new agent would: can you find the right document and tell when its instructions apply? Edit its frontmatter or headings to improve the entry.`

export const GRAPH_LAYOUT = `Current board, owner rules, glossary, documentation map, knowledge and working letter are files. Project settings select their paths. .shift/beads/ holds this project's private active and closed tasks. .shift/history.db stores letters and versioned project records for retained shifts. Copy the whole project with all writers stopped to transfer both stores and configured files.`

export const GUIDE_RECORDS = [
  '## What goes where',
  GRAPH_LAYOUT,
  'Project-wide focus can go in the board Goal. Keep issue status, dependencies and discussion in Beads. For an issue created by an earlier Shift version, show its JSON to read its original metadata, including numbered items and evidence.',
  BOARD_RULES,
  OWNER_RULES,
  GLOSSARY_RULES,
  KNOWLEDGE_RULES,
  SHIFT_RULES,
  DOC_WRITING,
].join('\n\n')

export const GUIDE_FLOW = `## How to shift

Check the board and current project records. At the final hint, write the letter at ${LETTER} with four nonempty sections under level-two Markdown headings. Write "none" for a section with nothing to record:
- Where I am: ${LETTER_OPENING}
- Next: the concrete work to resume and how to check it. Include a Beads ID when a task is relevant.
- Unverified: what still needs evidence.
- Hold: reasoning and details to carry through the shift.

Call shift with the letter path and after. Choose continue for autonomous work and wait for the owner's input. After acceptance end the turn with one line for continue, or your complete answer to the owner for wait. If refused, correct the named record and call again. Shift checks the board, owner rules, glossary, knowledge, settings, letter and recorded progress. The guide’s records section describes their formats. Read the restored letter with the board and current project records. For task work, use the project command confirmed in your session instructions or by shift_setup(section="sbd"). Run its prime subcommand.

List saved shifts with shift_history. Use its stable IDs to read a record, compare any pair, export or delete a completed entry. Search saved records locally with action="search" and query. Project retention is history_limit, default 30 completions. Pending letters stay protected. To resume from a fresh chat use the unshift action.

On a migration reminder use shift_migrate(action="start"). Manually transfer every open legacy task, including deferred work and tasks waiting for the owner. Verify its items, links, status and evidence and confirm the mapping. Historical shifts and closed tasks remain in the verified backup. Make one new shift and receive its letter. Run cleanup with the supplied ID and restoration receipt. If source records changed, rerun start and verify the new backup generation.`

export const GUIDE = `${GUIDE_FLOW.trimEnd()}\n\n${GUIDE_RECORDS}`

// The tree's rows: the prefix, the name, padded to its level's column, and what it is.
const row = (prefix: string, name: string, width: number, what: string) => `${prefix}${name.padEnd(width)}${what}`

const LAYOUT_TREE = [
  `${DIR}/`,
  row('├── ', NAMES.board, 18, 'the board — the goal, project-wide decisions and dead ends'),
  row('├── ', NAMES.taskList, 18, 'the open tasks, what you do now, their links — every session'),
  row('├── ', NAMES.owner, 18, "the owner's decisions in force for the whole project — every session"),
  row('├── ', NAMES.glossary, 18, "the project's own words — every session"),
  row('├── ', NAMES.shift, 18, 'how the project keeps its knowledge, and the map of its docs — every session'),
  row('├── ', NAMES.settings, 18, "the owner's settings, optional — above"),
  row('├── ', NAMES.letter, 18, 'the letter to yourself — written anew before every shift'),
  row('├── ', `${NAMES.knowledge}/`, 18, 'traps, lessons, commands, facts — read on demand'),
  '│   └── <kind>[-<topic>].md',
  `├── ${NAMES.tasks}/`,
  '│   └── <name>/',
  row('│       ├── ', NAMES.task, 10, 'what the task is, its decisions and dead ends'),
  row('│       ├── ', NAMES.track, 10, "the task's tracker"),
  row('│       └── ', `${NAMES.notes}/`, 10, `notes on its items, each linked from ${NAMES.track} or ${NAMES.task}`),
  row('├── ', `${NAMES.archive}/`, 18, `legacy archived tasks`),
  row('│   ├── ', NAMES.index, 14, 'one line per archived task'),
  row('│   └── ', '<name>/', 14, "the task's folder as it was"),
  row('└── ', `${NAMES.shifts}/`, 18, 'history, written by the mod; do not edit'),
  '    └── <YYYYMMDD-hhmmss UTC>/',
  row('        ├── ', NAMES.about, 14, `the shift in brief — its structure is in ${GUIDE_TOOL}`),
  row('        ├── ', NAMES.letter, 14, 'a copy of the letter'),
  row('        ├── ', NAMES.board, 14, 'a snapshot of the board'),
  row('        ├── ', `${[NAMES.taskList, NAMES.owner, NAMES.glossary, NAMES.shift, NAMES.settings].join(', ')}`, 0, '   snapshots'),
  row('        ├── ', NAMES.index, 14, 'a snapshot of the archive index'),
  row('        ├── ', `${NAMES.tasks}/`, 14, 'snapshots of the open tasks'),
  row('        ├── ', `${NAMES.knowledge}/`, 14, 'a snapshot of the knowledge'),
  row('        └── ', NAMES.summary, 14, 'what stayed in memory after the shift'),
].join('\n')

export const SETUP_LAYOUT = `\`\`\`
${LAYOUT_TREE}
\`\`\`

\`${DIR}/\` is yours. Whether the project's git takes it in is the owner's choice (\`commit\` above); by default it stays out: when the project's git does not ignore it, the mod adds it to the repository's local exclude file, which is never committed, and says so. It needs no git of its own: every shift snapshots the board, the owner's decisions, the tasks and the knowledge, so removing a line is safe.`

export const SETUP_MIGRATION = `## Coming from the earlier layout

Records kept before \`${TASK_LIST}\`, \`${OWNER}\` and \`${GLOSSARY}\` are moved once, before the next shift; the refusals name each step:
- \`${OLD_DIR}/\` → \`${DIR}/\`, the folder renamed as it is;
- \`${OLD_OWNER}\` → \`${OWNER}\`, renamed as it is;
- the board's "${OLD_TASKS_SECTION}" section → \`${TASK_LIST}\`: each line as \`- [status] [name](tasks/name/) — what matters\`, and the \`continues:\` lines of each \`task.md\` under it as \`- continues: [name](archive/name/)\`;
- \`${KNOWLEDGE}/glossary*.md\` → \`${GLOSSARY}\`, one article per term;
- where knowledge goes, if \`${OWNER}\` spells it out by kind of knowledge → \`${SHIFT_FILE}\`, on the owner's word.

## Coming from the shift skill

A project kept with the \`shift\`/\`unshift\` skills has a \`${DIR}/\` of their making: \`sessions/\`, \`AGENTS.md\`, \`SHIFT.md\` (the skill's own text), a \`shift\` script, \`knowledge/\`, sometimes a \`.git\` of its own. The mod uses the same folder, and works on it only once it has a board. Move it in place, once, entry by entry — nothing is dropped:
- \`knowledge/owner.md\` → \`${OWNER}\`, rules as they are;
- \`knowledge/traps*.md\`, \`lessons*.md\`, \`runbook*.md\` stay in \`${KNOWLEDGE}/\` under the same names: keep \`kind\` and \`about\`, rename the entry fields (Причина → Cause, Делать → Do, Почему → Why, Когда не годится → Not when, Покажет → Shows), drop the date lines and the generated tables of contents;
- \`knowledge/glossary*.md\` → \`${GLOSSARY}\`, one article per term: the meaning into \`Means\`, other spellings into \`Variants\`; a meaning the files only guessed gets \`Unconfirmed\`;
- the \`knowledge\` setting of \`AGENTS.md\` (\`project\`, \`local\`, \`split\`) → \`knowledge\` in \`${SETTINGS}\`; its "Что где" rows → \`${SHIFT_FILE}\` on the owner's word;
- open items of the last snapshot's \`unfinished.md\` and its "С чего начать" → tasks in \`${TASK_LIST}\`; its owner decisions → \`${OWNER}\` or the task's; dead ends → the board or the task;
- the skill's \`SHIFT.md\`, \`shift\` script and \`AGENTS.md\` go once their content is moved: \`${SHIFT_FILE}\` is the project's own file now. A \`.git\` inside goes only on the owner's word;
- \`sessions/\` stays as it is: it is history.

The text of records may stay in its language, and the owner is quoted verbatim; section names and entry fields are the ones above.`
