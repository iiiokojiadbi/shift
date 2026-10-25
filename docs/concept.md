---
description: The idea and the loop: why the agent shifts itself, the five steps of a shift, how the model sees it and in what order a shift hands its work back, what is out of scope, the open questions. Before changing how the mod works.
---

# shift: concept

<!-- toc -->
- The loop
- How the model sees it
- Out of scope
- Open questions
<!-- /toc -->

Long work outlives the context window, and a harness's own compaction keeps a generic summary, not the agent's thread of thought. With the shift the agent manages its own context: at a stage boundary it decides to shift, prepares its records, writes a letter to itself and says what to hold; the harness lets the stretch's history go, and right after it the agent gets its letter, board and tasks back and continues from where it stopped — or waits for the owner. The agent does not change; only what is in front of it does.

The project is narrow: only this loop. Not a transport between sessions, not orchestration. It replaced the `shift`/`unshift` skills, which did the same by hand and left the agent hard to resume when the records were loose. The rest of the design is in `docs/records.md` (what the agent keeps), `docs/hints.md` (when it is told to shift), `docs/architecture.md` (the code) and `docs/adapters.md` (each harness).

## The loop

1. **Work.** The agent keeps its records as it goes: the board, the task folders, decisions where they belong. The mod watches the history and hints when a shift is worth it.
2. **Decision.** The agent picks the moment — at a stage boundary, not in the middle of a step, and not before the first soft hint unless the owner asks: a short stretch does not pay for its letter and records.
3. **Shift.** The agent writes its letter (`.shift/letter.md`: "Where I am", "Next", "Unverified", "Hold") and calls `shift` with the letter's path, `after` (`continue` or `wait`) and `about` (one line for the history). The mod checks the letter and the records, snapshots them into `.shift/shifts/<UTC>/` and answers how to end the turn: work done after the call would land in the history about to be let go. With `continue` the turn ends with one line; with `wait` it ends with the agent's whole answer to the owner — what it did and found, what it asks — since the owner reads the turn's last message, not the letter or the records, and a short "shifted, waiting" left them nothing to read.
4. **Let-go.** After the turn ends the mod asks the harness to let the history go, with the letter's "Hold" as what to keep, the tasks in progress and their items in progress named so the reasoning around them is kept fuller, and "the board, the tasks and the letter come back whole, do not repeat them". No harness lets a model let its own history go in the middle of a turn: it is done by something that outlives the turn.
5. **Next stretch.** With `continue` the letter and the records start the next turn; with `wait` they ride with the owner's next message. There is no cap on `continue` in a row: the agent goes on through as many stretches as the work takes, each in a history that is not overfull. The owner sees a row for each: done and continuing, waiting, what went with their message, or why a shift was not made.

Roles: the harness's digest answers "what was", the letter "what next", the board and the tasks "where the work stands". All of it stays on disk in the shift's folder.

## How the model sees it

- **Only "shift".** The words "compression", "summary", "compaction" are absent from everything the model reads: some models answer them with an `<analysis>`/`<summary>` text instead of a tool call.
- **What came from the mod is tagged.** The doctrine is `<shift note="…">`, what a shift hands back is `<shift folder="…">` with the letter in `<letter path="…">`, each record in `<file path="…">`, the map in `<knowledge path="…">`. Records carry headings and code blocks of their own, so only a tag marks where a file ends, and the agent tells the mod's text from the owner's instructions at once.
- **In what order.** A model reads the start of a context as a frame, the middle weakest, the end as what to do now. So a shift hands back the records first, then the descriptions of the last shifts oldest first, then the letter last, right before the turn. A recent shift's line is its folder and description only: a column of past `wait` pulled the agent towards waiting. Tasks unchanged through many shifts are named after the recent shifts, before the letter.
- **In English.** Everything the agent reads — code, docs, prompts, tool descriptions, records — is in English; the readers are agents.

## Out of scope

- folding an arbitrary range, restoring a folded part, a hierarchy of folds;
- Codex;
- transport and communication between sessions;
- writing knowledge or the owner's decisions automatically: the agent writes them, the mod only checks.

## Open questions

1. **A verbatim tail.** Whether to keep the last turns unfolded. pi keeps `keepRecentTokens` anyway; opencode only through a setting (`tail_turns`); Claude Code would need its `messages` replaced — not checked.
2. **The owner writes during the let-go.** In pi such a message waits until the continue has started; in Claude Code it may arrive in between — the count of continues is read late for that reason, but what the agent does with the message is not settled.
3. **A hint that does not settle in the history.** Each hint stays in it; no harness has shown a channel that does not.
