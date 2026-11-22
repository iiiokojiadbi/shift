import { type TaskCommandPath, taskInstructions } from '../beads'
import { TOC_END, TOC_START } from '../docs'
import {
  ABOUT_MAX,
  BOARD,
  BOARD_MAX_LINES,
  BOARD_SECTIONS,
  GLOSSARY,
  GUIDE_TOOL,
  KINDS,
  KNOWLEDGE,
  KNOWLEDGE_MAX_LINES,
  LETTER,
  MENTIONS_TOOL,
  MOD,
  OUTLINE_TOOL,
  OWNER,
  OWNER_MAX_LINES,
  READ_TOOL,
  SHIFT_FILE,
  STATUS_TOOL,
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
  Goal: 'the outcomes this stage should achieve. Default to an unordered list, one outcome per bullet, even for a single goal',
  'Current focus':
    'what the project is doing now to reach those goals. Mention concurrent directions and temporary conditions when another chat would act differently. Remove a condition when it expires',
})}

Example board:
## Goal
- Let warehouse staff record counts offline.
- Sync their counts when connectivity returns.

## Current focus
We are checking what happens when a device retries a sync. Keep the original count IDs during the trial so the receiving system can recognize a retry.

When revising an older board, read its Decisions and Dead ends. Keep an active constraint in Current focus. Preserve durable design in the appropriate document and reusable lessons according to the project's knowledge rules. Keep owner policy in the owner record. Earlier boards remain available in saved shifts.`

const OWNER_RULES = `\`${OWNER}\` holds decisions in force across the project, grouped under ## headings, up to ${OWNER_MAX_LINES} lines. Write "none" when empty. Quote wording that determines the rule. Each decision takes two lines:
- Keep the preview private.
  [tasks preview-3] · Until the owner approves public access
- Use the project launcher.
  Permanent

The second line is Permanent or Until followed by an observable event. The optional prefix [tasks ID] · or [tasks ID, ID] · points to related issues. Tasks keep their own decisions and evidence. When closing a linked issue, changing the relevant workflow, or finishing an experiment, revisit the affected rule. Remove it when its stated condition is fulfilled. A closed issue alone settles only a condition explicitly tied to its closure. Keep a rule with uncertain status until the owner clarifies it. Replace superseded rules in place and remove exact duplicates of standing instructions. Keep one-off requests in the letter or the issue. An existing free-form record can cross its first shift and later shifts while it matches the latest saved OWNER. Convert the whole record on edit.`

const KNOWLEDGE_KINDS = `- \`traps\` — what behaves not as expected: \`### <symptom>\`, then ${KINDS.traps.join(' and ')};
- \`lessons\` — an approach that worked or failed: \`### <approach>\`, then ${KINDS.lessons.join(' and ')};
- \`runbook\` — what is run and with what: \`### <task>\`, a command block, then ${KINDS.runbook.join(' and ')};
- \`facts\` — how the project, its tools or its harness behave: \`### <fact>\`, then ${KINDS.facts.join(' and ')} (how it was established).

Terms are not a kind: they live in \`${GLOSSARY}\`.`

const KNOWLEDGE_RULES = `\`${KNOWLEDGE}/\` is what you learned that stays true for months: traps, lessons, commands, facts. One file per kind — \`<kind>.md\`, or \`<kind>-<topic>.md\` once split by topic; a frontmatter with \`kind\` and \`about\` (what is in the file and where the neighbouring files are); entries grouped under \`##\` headings by topic. Kinds and the fields every entry carries:
${KNOWLEDGE_KINDS}

No dates, no more than ${KNOWLEDGE_MAX_LINES} lines per file. Freshness is checked when an entry is used, not by age: an entry that lied is fixed or removed right away; a trap met a third time is rewritten as a rule. Writing into a section, clear out what is dead there: a trap about code that is gone, an entry a later one covers, a one-off case with no conclusion, a copy of the project's docs. The session map in \`${SHIFT_FILE}\` lists the files and their ## topics. When a symptom looks familiar, use \`${READ_TOOL}\` to open the topic or a single ### entry before investigating it again.`

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

const SHIFT_RULES = `\`${SHIFT_FILE}\` is how this project keeps its knowledge: rules written on the owner's word — where each kind of knowledge goes, how the documents are kept — and a map of the documents the mod writes between its markers. The map lists each document the settings name — a folder of them, or one such as \`AGENTS.md\` — with its \`description:\` (frontmatter: what is in the file and when to open it) and its \`##\` sections. With \`archived: true\` in its frontmatter, the entry shows its path, archive status, description and pins. Use \`${OUTLINE_TOOL}\` for its sections. The map only points: numbers, commands and names come from the document itself. A document without a description shows as such — give it one. A folder or a document of the settings with nothing to list is named in the map as \`no such folder\`, \`no documents\` or \`no such file\`: the project has no docs there, do not go searching. With \`[docs] dirs = []\` project documentation is off. Local knowledge topics remain in the map and can be read with \`${READ_TOOL}\`.

A \`> [!IMPORTANT]\` block in one of those documents is pinned: the map shows it under its document with its section, so it is in front of you in every session without opening the document. Pin only what you would get wrong in any task without it, in a line or two; change it in the document, never in the map. Nothing is pinned until you pin it. Past \`[docs] max_pinned\` the map says so and still shows every block — unpin what is not needed in every task.

Those documents the mod keeps as you write them. After an Edit or a Write the map follows at once; with \`[docs] toc = true\` each document carries a toc between \`${TOC_START}\` and \`${TOC_END}\` under its \`# \` title, written by the mod from its \`##\` and \`###\` and the \`> \` line under a heading — never edit it by hand. The rest waits until the run is over, so a set of documents can be written in any order: with the next message the mod writes the tocs of the files you wrote — by any tool, a script's change is found by its file's stamp — and checks them, in one note — the tocs it wrote, so read such a file again before editing it, and the remarks: no description, a description or a file over the limits the settings set, a link to a document that is not there. Silence means all is well. The documents with remarks also come after a shift.`

// The section's text without its tag, for a harness that wraps a prompt section in a tag of its own; the tools are the
// ones shown in this project, in the order given.
const LETTER_OPENING = `Open "Where I am" with one paragraph of 2–3 short sentences (up to ${ABOUT_MAX} characters). Say what you worked on, what you found or verified, and where that leaves the work. This paragraph becomes the description in later shift history.`

export function doctrineBody(tools: readonly string[], command?: TaskCommandPath | null): string {
  return `# Shift

You work in stretches and decide yourself when to shift: the stretch's history is let go, and you continue from where you stopped. You do not change — only what is in front of you does. So everything you need next must be in your records, and a thought you have not written down yet goes into a letter to yourself.

## Board and letter

\`${BOARD}\` holds stage goals and the current shared focus. Read the board when starting work in an existing project. Write the next step in the letter. Use the built-in tracker when work needs its own status, dependencies or discussion. ${taskInstructions(command)} Update a task, owner rule, board or glossary term when it changes. No board — create it. Before starting the next item, record the outcome of this one. When a change affects a documented interface, workflow or design decision, choose its document by the behavior that changed and update it alongside the change. ${tools.includes(MENTIONS_TOOL) ? `Use \`${MENTIONS_TOOL}\` to find additional filename references. ` : ''}Follow the project's knowledge rules in \`${SHIFT_FILE}\`. For internal records use shift_record (file-backed projects use their paths): read and replace a unique passage, or checkout Markdown, edit the returned path, then apply its revision. Import validates all candidate records before saving them together. To retire a current knowledge record, move any loose original first, then use delete with its revision. At shift time, check the records and write the letter. ${LETTER_OPENING}

\`${SHIFT_FILE}\`, \`${OWNER}\`, \`${GLOSSARY}\` come into the session. The board and letter return after a shift. The settings may move the first three elsewhere in the project.

When continuing a tracked issue, include its ID in the letter. Under Goal, use an unordered list of stage outcomes by default. Under Current focus, describe the work underway and any temporary condition other chats need. Update the board when that shared picture changes. On return, check whether the letter's Next still fits the current board. For tracked work, keep issue-specific decisions and evidence on the issue. Dates belong to the mod's snapshots.

\`${OWNER}\` is the owner's standing decisions. On the owner's word, find the rule on that subject, check its scope and revise it in place. Write each decision as a bullet followed by Permanent or Until <observable event>, optionally prefixed with "[tasks ID] · ". Revisit affected conditions when related work ends. Quote wording that determines its meaning. Keep project terms in \`${GLOSSARY}\`. Read \`${SHIFT_FILE}\` for the project's knowledge rules, documentation, knowledge topics and pinned advice. Use \`${READ_TOOL}\` to read the relevant section. Keep knowledge local in \`${KNOWLEDGE}/\` until the owner chooses its placement.

Read \`${GUIDE_TOOL}\` before your first shift in this project. For writing project documentation or keeping records, ask for section "records"; for the letter, a refusal or how to continue, use "flow".

## When to shift

Keep working until the first hint unless the owner asks for an earlier shift. Each shift rebuilds the history cache and rereads the records. A finished task alone is too early. \`${STATUS_TOOL}\` shows when the next hint comes.

A soft hint is optional. Shift at a stage boundary when you can continue from your records. At the final hint, shift now. Check the records, write the letter and call \`${TOOL}\` before starting more work. Use \`continue\` when work remains and you can proceed on your own.

## Tools

${tools.map(name => `- \`${name}\` — ${TOOL_TEXTS[name]?.brief ?? ''}`).join('\n')}`
}

// In a tag that names the mod: the agent tells this section from the owner's own instructions.
export function doctrine(tools: readonly string[], command?: TaskCommandPath | null): string {
  return `<${MOD} note="how the ${MOD} mod works: its tools, its records and when to shift">
${doctrineBody(tools, command)}
</${MOD}>`
}

const DOC_WRITING = `When you change what someone using or maintaining the project needs to know, update the relevant document in the same change, before taking the next item. Do this on your own initiative within the knowledge rules in \`${SHIFT_FILE}\`. A refactor that leaves the documented behavior accurate needs no new entry.

1. Name the reader's question. If a message can arrive during a shift, for example, the reader needs to know whether the agent receives its letter before answering. Use the map to find the document that explains that behavior. Where enabled, use \`${MENTIONS_TOOL}\` to catch other documents naming a changed file. A document can explain the behavior without naming the file.
2. Rewrite the affected passage in place. Say what happens, under which conditions, and why the distinction matters. Put exact commands and limits with the interface they belong to. For example, attach a character limit to the specific field and file. Link other mentions to that passage. Create a document when a distinct topic has no home. Give it a short \`description:\` saying what question it answers and when to open it. For example: "Which message reaches the agent first. Read before changing delivery during a shift." Use \`##\` headings a reader can choose from the map, such as "Messages received during a shift". Verify any command, field name or limit you publish against its source.
3. Keep durable behavior in its document. Update Current focus when the change affects what other chats should do during this stage. For example, while two adapters still deliver messages in different orders, say which adapter needs the ordering check. Retire the line once both pass.
4. When the owner gives a decision, find earlier wording on the same subject. Name the scope (project, harness, task or field), fold refinements into the existing rule, and keep a quote where its wording matters. Recover an ambiguous reference from its source when possible. Ask if the evidence leaves two meanings that would lead to different actions.
5. When a design is superseded and its rationale is still useful, mark the reference \`archived: true\` and describe when to consult it. Keep current instructions in the active document. Read the resulting map entry as a new agent would: can you find the right document and tell when its instructions apply? Edit its frontmatter or headings to improve the entry.`

export const GRAPH_LAYOUT = `Default internal Markdown records live in .shift/history.db. Each chat writes its own letter. Record paths in the guide identify their logical names. An explicit project file source, or commit = true, stays file-backed. .shift/beads/ holds this project's private active and closed tasks. .shift/history.db stores letters and versioned project records for retained shifts. Copy the whole project with all writers stopped to transfer both stores and configured files.`

export const GUIDE_RECORDS = [
  '## What goes where',
  GRAPH_LAYOUT,
  'Write the next step in the letter. Use Beads when work needs its own status, dependencies or discussion.',
  BOARD_RULES,
  OWNER_RULES,
  GLOSSARY_RULES,
  KNOWLEDGE_RULES,
  SHIFT_RULES,
  DOC_WRITING,
].join('\n\n')

export const GUIDE_FLOW = `## How to shift

Use shift_record(action="checkout", name="letter.md"), edit its returned path and apply the revision before calling shift. Use drafts to recover an interrupted edit. A conflict keeps the file for reconciliation. In file-backed projects edit the configured paths directly. Check the board and current project records. At the final hint, prepare the letter at ${LETTER} with four nonempty sections under level-two Markdown headings. Write "none" for a section with nothing to record:
- Where I am: ${LETTER_OPENING}
- Next: the concrete work to resume and how to check it. Include the issue ID when continuing tracked work.
- Unverified: what still needs evidence.
- Hold: reasoning and details to carry through the shift.

Call shift with the letter path and after. Choose continue for autonomous work and wait for the owner's input. After acceptance end the turn with one line for continue, or your complete answer to the owner for wait. If refused, correct the named record and call again. Shift checks the board, owner rules, glossary, knowledge, settings, letter and recorded progress. The guide’s records section describes their formats. Read the restored letter with the board and current project records. When using the tracker, use the project command confirmed in your session instructions or by shift_setup(section="tasks"). Run its prime subcommand.

List saved shifts with shift_history. Use its stable IDs to read a record, compare any pair, export or delete a completed entry. Search saved records locally with action="search" and query. history_limit controls both retention and the maximum number of earlier descriptions in the restored preamble, default 30. Pending letters stay protected. To resume from a fresh chat use the unshift action.`

export const GUIDE = `${GUIDE_FLOW.trimEnd()}\n\n${GUIDE_RECORDS}`
