# infinity-shift: concept

The agent manages its own context. After finishing a stage of work, it decides it is time to compress, and it sets the direction of the compaction itself: what to keep and how broadly to fold. After the compaction the agent immediately receives a handoff from itself — where to continue from — and either continues working or waits for the owner.

The project is narrow: only this loop. Not a transport between sessions, not orchestration. It replaces the `shift`/`unshift` skills.

Marks in the text:

- **[types]** — checked against the Claude Code 2.1.302 mod API types;
- **[code]** — read in the harness sources, not run;
- **[concept]** — a proposal, not checked.

## The loop

**[done in the Claude Code mod]**

1. **Work.** The agent keeps its records as it goes: the board, the task folders, decisions where they belong (see "Records"). The mod watches the context and hints when a shift is worth it (see "Hint").
2. **Decision.** The agent chooses the moment itself — at a stage boundary, not in the middle of a step. The hint can be ignored, and it is possible to shift without it.
3. **Shift.** The agent writes its letter to itself (`.infinity-shift/letter.md`: "Where I am", "Next", "Unverified", "Hold") and calls the `shift` tool with three fields:
   - `letter` — the path to the letter;
   - `after` — `continue` or `wait`;
   - `about` — one line up to 400 characters for the shift history.

   The mod checks the letter, the board and the tasks, snapshots them into `.infinity-shift/shifts/<UTC>/` and answers "shift accepted, end the turn with one line". Work done after the call would land in the history that is about to be let go.
4. **Let-go.** After the turn ends, the mod starts the harness's native compaction with the letter's "Hold" as the instructions, plus "the board, the tasks and the letter come back whole, do not repeat them". In no harness can a model compress itself in the middle of a turn: it is done by something that outlives the turn.
5. **Next stretch.** With `continue` the letter, the board and the tasks in progress go as a message that starts a turn. With `wait` they ride along with the owner's next message. Three `continue` in a row without the owner force a `wait`. The owner sees transcript rows: shift done, waiting or continuing, what went with the message (the letter, the board, the owner's decisions, the tasks in progress, the map of knowledge — by name), or why a shift was not made or a letter did not go. No status line under the input: it hung there as noise.

**How the model sees it.** The words "compression", "summary", "compaction" are absent from the doctrine, the tool description and the hints: some models respond to them with the familiar `<analysis>`/`<summary>` text instead of a tool call (see "Lessons"). The model sees shifts: it works in stretches and shifts itself, it does not change, only what is in front of it does.

**What came from the mod.** Everything the mod puts before the model is in a tag that names it: the doctrine in the system prompt is `<infinity-shift note="…">`, what a shift hands back is `<infinity-shift shift="<folder>/">`, with the letter in `<letter path="…">`, each record in `<file path="…">` and the map in `<knowledge path="…">`. Records carry headings and code blocks of their own, so neither a heading level nor a fence can mark where one file ends; a tag can, and the agent tells the mod's text from the owner's instructions at once.

**In what order.** A model reads the start of a context as a frame, the middle weakest and the end as what to do now. So a shift hands back the records first as reference (the board, the owner's decisions, the tasks in progress, the map of knowledge), then in the middle the descriptions of the last 10 shifts oldest first, as memory of what was done before, with a line that `shift_history` reads the earlier ones when there are more, and the letter last, right before the turn. A recent-shift line is the folder and the description only: a column of past `wait` would pull the agent towards waiting when it could go on.

Division of roles: the digest is responsible for "what was", the letter — for "what next", the board and the tasks — for the state of the work. All of it stays on disk in the shift folder.

## Records

**[done in the Claude Code mod]**

```
.infinity-shift/
├── board.md          which tasks are open and which are in progress; project-wide decisions and dead ends
├── owner.md          the owner's decisions in force for the whole project
├── letter.md         the letter to itself, written anew before every shift
├── knowledge/        traps, lessons, runbook, glossary — read on demand
├── tasks/<name>/     task.md — what the task is, its decisions and dead ends; track.md — its tracker
├── archive/          finished and dropped tasks; index.md — one line each
└── shifts/<UTC>/     about.md, letter.md, board.md, owner.md, index.md, tasks/, knowledge/, summary.md
```

The problem it solves: sooner or later the topic of work changes, and a single board loses what was done. So each line of work is a task, split by meaning, with its own description and tracker. The board is the focus: every open task, one line each, with `in progress`, `deferred` or `waiting for owner`. From the board alone the agent knows whether it does one task, several, or none, and why something waits.

- **Task.** `task.md` has a title, optional `continues: archive/<name>/` links, and sections "Goal", "Done when", "Owner decisions", "Decisions", "Dead ends". `track.md` has items `- [in progress|open|done|dropped] item — note`; closed items stay until the task is archived — the track is the task's history.
- **Where a decision lives.** On the board only if it outlives any one task; otherwise in the task, and it goes to the archive with it. When a task is archived, decisions that still bind are lifted to the board.
- **Owner's decisions.** `owner.md`, beside the board and with its own 150-line limit: the owner's words in force for the whole project, as a code of rules, not a log. A newer word rewrites the older line; a rule changes only on the owner's word. It comes back whole after every shift. On the board they crowded out the work: the first migrated project had 31 such lines.
- **Knowledge.** What the agent learned about doing the work that stays true for months and is neither a decision, a dead end nor a task: `knowledge/<kind>[-<topic>].md`, kinds `traps`, `lessons`, `runbook`, `facts`, `glossary`, each entry with its kind's fields, 400 lines per file. Only its map comes back after a shift; files are read on demand. It lives in the project, not in a harness's memory, so any agent reads it.
- **What goes where** is a table in `shift_guide`; one fact, one place. Whether knowledge goes into the project's own docs or stays local in `knowledge/` is the owner's choice per project (all, none, or split by a named boundary), kept in `owner.md`; until the owner said, it stays local — the agent does not write a project's shared files on its own guess.
- **No dates.** Which of two rules is newer is never a question: the newer one replaced the older line. When something was decided, the snapshots tell.
- **The directory** is the agent's own: ignored by the project's git, no git of its own — every shift snapshots the board, the owner's decisions, the tasks and the knowledge.
- **Archive.** The `task_archive` tool moves the folder to `archive/<name>/` and adds `- [done|dropped] [<title>](<name>/) — <about>; continues …` to `archive/index.md`. To come back to an archived topic the agent opens a new task linked with `continues:`.
- **Strictness.** The mod refuses a shift on a date anywhere in the records, a missing section, an unknown status, a board or `owner.md` longer than 150 lines, a knowledge file of no kind or without its entry fields, board and task folders out of step, records not ignored by git, or nothing changed since the last shift.
- **Shift history.** `about.md` lists per task what the stretch did and dropped (track items closed since the previous snapshot), which tasks were archived (new index lines), and what is open.
- **A project tracker** (Plane or another) is a different thing: the mod's tasks are the agent's working memory and are not linked to it.

Records and everything the agent reads are in English: the readers are agents.

## Hint

**[done in the Claude Code mod]** — soft, final, a safety net, the "what it grew from" breakdown and `shift_status`.

How it is done: the start of a stretch is the first fill after any shift or harness compaction. Every threshold is a share of the limit L — the harness's auto-compaction threshold, or the window when it is unknown; Claude Code's threshold is read once, when the window is half full. Windows differ several times over (1M, 272K, 128K), and fixed steps made hints frequent on small windows and rare on large ones; shares keep the rhythm the same.

- **Soft** — every `max(100K, 25% of L)` of growth since the start of the stretch or the previous hint. A shorter stretch does not pay for its own letter and records (10–20K). No soft hint when the final one is less than half a step away.
- **Final** — at 80% of L, with room left to finish a stage; again every 5% of L after it.
- **Benefit threshold** — no hint at all until the stretch has grown by 5% of L, so a shift that leaves the window full does not loop.
- **Safety net** — after the harness has compressed by itself, the agent is told that there is no letter and the board must be read.

| window | soft | final |
|---|---|---|
| 1M | ~250K, ~500K | ~800K |
| 272K | ~100K | ~218K |
| 200K | — | ~160K |
| 128K | — | ~102K |

The hint goes inside the last tool result, wrapped in `<system-reminder>` — a text block of its own in that row was shown to the owner as their own message; between turns it goes into the context of the next message. It stays in the history: the harness gives no temporary channel to the model; loops are restrained by the rule "one hint per new growth".

What it grew from: the harness gives no token count per row, so the mod counts the characters of every row of the main history by source — a tool by its name, the agent's own responses, the owner's messages, attachments and reminders — and names shares: "Mostly from: Read 67%, Bash 30%". Up to three sources of at least 5%; the count starts over with the stretch. The count lives in the harness's memory, so a fresh process (a restart, a resumed session) takes it back once: the base from the last shift's `about.md` if that shift was this session's, the growth from the history as it is. A large share of tool output that is no longer needed is the strongest reason to shift.

A bare fill percentage is a bad signal. In billion-context, a model that sees "20%" anchors on it and refuses to fold. The percentage also says nothing about what to fold: windows come in 200K and 1M, and 30% of a window can be one useful file read or a dozen test logs.

I propose two signals with different meanings:

- **growth since the last compaction** in absolute tokens — "there is something to fold";
- **fill of the available window** — "it is time, otherwise the harness will compress by itself".

And three levels:

1. **Soft.** Growth above a threshold (billion-context used about 50K; here it is a share of the limit, see above). One line: how much it grew and from what — for example, "+62K since the last compaction, of which 40K are tool outputs". No percentage. The agent may decline; the next soft hint comes only after new growth.
2. **Final.** The fill is close to the harness's auto-compaction threshold. A request to fold at the nearest stage boundary.
3. **Safety net.** The harness's auto-compaction fired before the agent did. The adapter adds the doctrine to its instructions, and after the compaction tells the agent that it was compressed without its participation and there is no handoff.

The hint comes at boundaries, not on every turn: a plan item is closed, a commit is made, a turn has ended. Thresholds are computed from the available window of the specific model and tuned by measurement.

Limiters taken from billion-context:

- **Benefit threshold.** After a compaction the context may stay large. If too little has been added since the last fold (here 5% of the limit), there is no hint even at high fill, otherwise a "folded — hint again" loop appears (their #198).
- **An ignored hint is not repeated on every turn.** The next one comes only after new growth.
- **The soft hint says outright that it is not an alarm** and that a real shortage will get a separate warning. This is how their `efficiencyNote` is worded.
- **The hint does not settle in the history, if the harness allows it.** Instructions saved as messages pushed the model toward loops again in their case (`UNIFIED_LOOP_SPEC.md`).

Besides the hint — the `shift_status` tool on the agent's request: the fill against the window, where the harness lets the history go by itself, the growth since the last shift, when the next hints come, and what it grew from.

## Core and adapters

The core knows nothing about the harness:

- the `shift` fields and their validation;
- the doctrine text for the system prompt: when to shift, how to write `keep` and `note`;
- the hint rule — a pure function of the measurement history, tested without a harness;
- writing the handoff to disk;
- loop protection (shifted, came up and immediately shifted again).

For each harness the adapter fills the slots:

| Slot | Claude Code (mod) | pi (extension) | opencode (plugin) |
|---|---|---|---|
| Measurement | `session.measure`, `$.session.usage()` **[types]** | `ctx.getContextUsage()` **[code]** | step tokens from events and `model.limit.context`; compute the available window yourself **[code]** |
| `shift` tool | `$.tool.register` in `session.start` **[types]** | `pi.registerTool` **[code]** | the plugin's `tool` **[code]** |
| Compaction with `keep` | `$.session.compact({ instructions })` between turns; rejected during a turn **[types]** | compaction with `customInstructions` after `agent_end`; not possible from a tool, `ctx.compact()` aborts the turn **[code]** | `POST /session/:id/summarize`, `keep` is added by the `experimental.session.compacting` hook **[code]** |
| Shift, `continue` | `$.prompt.submit({ text })` **[types]** | `pi.sendUserMessage` after `agent_settled` via `setTimeout(0)` — this is how billion-context wakes the agent **[code]** | `client.session.prompt`; turn off the synthetic "Continue…" with the `experimental.compaction.autocontinue` hook **[code]** |
| Shift, `wait` | `prompt.context` — blocks of the first message, re-read after compaction **[types]** | `pi.sendMessage` without starting a turn; an addition to the `context` event is not saved (their #2546) **[code]** | `prompt` with `noReply`; in 2.x — `session.synthetic` with `resume: false` **[code]** |
| Safety net | the `session.compact` hook with `trigger: "auto"` **[types]** | `session_before_compact` with `reason: "threshold"` **[code]** | `experimental.session.compacting` fires on auto too **[code]** |

## Similar things in other harnesses

- **Codex** — the `new_context` tool: the model itself starts a new window; alongside it are `get_context_remaining` and a search over past windows. Behind the `token_budget` flag, in development, search only with the provider's own backend **[code]**.
- **oh-my-pi** — `checkpoint(goal)` and `rewind(report)`: a point, work, folding everything after the point into a report. The original branch stays in the session tree **[code]**. The tool texts are worth reading: `src/prompts/tools/checkpoint.md`, `rewind.md`.
- **billion-context** — the model folds ranges into summaries, early context is kept in layers. Analysis and figures — `archive/fold-mod-brief.md`. The hint and doctrine techniques come from here, but not targeted folding: it is out of scope for the project.

## Lessons from billion-context

Sources: `~/code/reference/billion-context` at `e518363` — the article, `CHANGELOG.md`, the core (`kernel/src/compress.ts`, `nudge-text.ts`, `compression-rules.ts`). Almost all of their conclusions come from incident analyses of a single user; the controlled data is one 27B model, three runs.

**What confirms the concept:**

- The model itself rarely folds: without a hint there were 22% of compressions, and one session stood at 92% without a single compression when there was no hint. The hint is mandatory.
- A frequent hint does harm: with a growth threshold of ~1.3K there were 3 execution errors instead of 1, and the accuracy of memory answers fell from 81.6% to 75.7%.
- They removed the percentage as a signal deliberately (#379): need is measured by growth.
- A single doctrine in the system prompt, without a single compression, cut repeated reads by 62%. The doctrine has value on its own and should be enabled first.
- Without an explicit instruction the model never restores what was compressed; with one — 6 out of 6. Hence: the note must say outright where the details lie, and not hope that the agent goes looking by itself.

**What to beware of:**

- **A stale directive in the handoff.** An invented "verbatim" quote of the user landed in the summary as the current task, and the session went into a loop (#309). Their rule: an owner's quote — only with a reference to the source, otherwise a retelling with a mark; open goals — on a separate line with a status (#442). Our note is a live directive by design, so our risk is higher.
- **Some models write the summary as text.** Seeing a request for compression, the model answers with `<analysis>`/`<summary>` instead of calling the tool, the turn ends, the session stalls. Hence the vocabulary of shifts instead of the vocabulary of compression (see "The loop").
- **Loops on failed calls.** A model repeated 161 different failed calls for 2 h 42 min. Their remedy is a hard stop after three failures in a row, and keeping failed attempts visible (if hidden, the model starts "from the first attempt" every time).
- **Fake confirmations.** 17 times the model wrote that the compression was done when it was not. Check the state through the adapter, not by the conversation text.
- **Auto-compaction turned off without a safety net.** When their proxy was bypassed (Desktop, #2290), `DISABLE_AUTO_COMPACT=1` left the session with no compression at all. Our plan — not to turn off the native compaction but to append the doctrine to it — is protected from this.
- **Cancelling someone else's compaction.** Cancel the native compaction only on a direct sign that it is automatic (#1382).

**What to take into the verification methodology:** a load made of stages — a six-step plan is given once, afterwards only "continue", each step is checked automatically; questions about early details from memory; a planted value that must be recalled correctly after compression; a count of repeated file reads.

**An idea for later:** they have a mode where the decision "whether to compress now" is put to the model as a separate short request over a cached prefix, without inserting a hint into the conversation (#2228, `src/nudge-decide.ts`). No results are published. Whether the Claude Code mod API has such a side request with history is not established.

## Out of scope

- folding an arbitrary range, `restore`, a hierarchy of blocks;
- Codex;
- transport and communication between sessions;
- automatic writing into `knowledge/` and `owner.md`: the agent writes them, the mod only checks.

## Open forks

1. **Hint.** Whether two signals and three levels are acceptable; where the stage boundary is in each harness.
2. **Verbatim tail.** Whether a parameter "how many last turns to leave uncompressed" is needed. pi can (`firstKeptEntryId`), opencode — only through a setting (`tail_turns`), Claude Code — through substituting `messages`, not checked.
3. **Where handoffs live** — settled: `.infinity-shift/`, ignored by the project's git; it replaces the `shift`/`unshift` skills, and `shift_guide` describes the move from `.shift/`.
4. **The owner writes while the compaction is running.** What to do with their message in the queue.
5. **The hint channel in Claude Code.** One is needed that does not settle in the history. `$.session.append` writes into the conversation forever; the system prompt cannot be changed — it would break the cache. To be found by experiment.
6. **Limit of autonomy.** `continue`, work, `shift`, `continue` can spin without the owner indefinitely. A limit is needed on consecutive shifts without their message, after which the mode is forced to `wait`, and a criterion "work is finished" in the note itself.

## Experiments for Claude Code

Before the core code, check on 2.1.302, each with a minimal mod:

1. A mod tool places a request; after the turn ends `$.session.compact({ instructions })` compresses the conversation, and the summary follows the instructions.
2. After the compaction `$.prompt.submit` delivers the note and starts a turn.
3. In `wait` mode the note gets into the context through `prompt.context`, no turn starts; the model sees it in its first reply to the owner.
4. Safety net: the `session.compact` hook on `trigger: "auto"` appends the doctrine to the instructions.
5. Hint: measurement in `session.measure`, delivery at a stage boundary, what the model does with it.

Then the same five on pi and opencode.
