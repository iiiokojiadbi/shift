# Changelog

The adapters share the project's version number. Newest first.

## Unreleased

- Edit internal Markdown through `shift_record`, with version-checked replacements, drafts and a working letter per chat. Use `shift_guide(section="migration")` to adopt existing internal Markdown and retire older files safely.
- Use the optional project command `./.shift/bin/shift-task`. Its `prime` shows Shift's conventions and the bundled Beads workflow. Tasks live in a private workspace separate from shift records.
- Configure how much history to receive. By default Shift retains ten completed shifts. The agent receives one full letter and nine earlier descriptions, with complete snapshots readable by ID. Pending and undelivered shifts remain recoverable.
- Project settings are created and upgraded at session start. Explicit supported choices and comments carry forward, and retired keys are removed.

## 0.40.0

### Changed

- Each chat receives the full documentation map when it starts or shifts. During retained history, including resume, external edits report only the affected documents, sections, descriptions and pins. Known edits by the same agent advance its checkpoint silently.
- The single final reminder for a reported window of 258,400 tokens in Codex moves from 184,800 to 205,632. A chat that already received its final reminder keeps it across the upgrade.

## 0.39.0

### Added

- Mark a document with `archived: true` in its frontmatter to show a short reference in the documentation map. Its path, description and pins stay visible, and `doc_outline` provides its full outline.
- The records section of `shift_guide` explains how to maintain documentation during work, reconcile owner decisions in place and keep the board useful after a shift.

### Changed

- Active documents keep their descriptions and sections at every map size. Existing `[docs] max_chars` values remain valid and no longer truncate the map.
- Codex users can follow the `codex-stable` marketplace branch and upgrade between sessions with `codex plugin marketplace upgrade shift`.

## 0.38.2

### Changed

- Size reports now show the combined token count first, followed by aligned counts for the session and continuation. The documentation map is marked as part of its parent file. Up to three saved letters appear separately.
- The Codex update instructions cover upgrading between sessions so active hooks can finish using their installed version.

## 0.38.1

### Fixed

- Type `$shift` in the Codex terminal to choose from four actions. Select `unshift` to restore the latest letter with your request, or `shift` to start a shift. The `sizes` and `tasks` entries display their reports without a model call. The typed double-slash aliases still work.

## 0.38.0

### Added

- In the Codex terminal, `//unshift review the project` restores the latest letter alongside your request. `//shift` asks the agent to prepare and perform a shift. `//shift_sizes` and `//shift-tasks` print reports without calling the model.
- The `shift_sizes` tool estimates the context cost of each entity, including up to three saved letters. From a checkout, `bun run shift:sizes [project]` counts the rendered text with the o200k_base tokenizer.

### Changed

- Shift reminders follow the window Codex reports. A 475,000-token window gets a soft hint at 300,000 and a final reminder at 410,000. A 258,400-token window gets one final reminder at 184,800.
- The standing instructions keep the documentation map and direct the agent to update records and documentation during the work. Record formats are available on demand in `shift_guide`.
- Restored trackers include every open item, the closed count and up to ten recent closures. The full tracker stays on disk. New items record creation and closure times. Older entries retain their file order.

### Fixed

- Codex restores the session files once after a shift and checks saved history before resending them on resume. Changed documentation entries and record warnings are delivered separately. Concurrent hooks deliver a threshold reminder once.
- The waiting letter is parked before the adapter announces that the shift is waiting. Completed patch evidence distinguishes the agent's own edits from external edits, including mixed edits to one file. Links between task notes and trackers are checked after the writing turn.

## 0.37.0

### Added

- Codex joins the shared release. Install `shift@shift` from the tagged marketplace and start the usual CLI. The plugin loads SHIFT.md with its documentation map, and the agent can shift and continue from its letter or wait for the owner.

### Fixed

- Shift history shows an unknown token count when the harness has no reading for the transition. A missing reading previously appeared as zero.

## Codex plugin 0.1.0

- Install `shift@shift` from the tagged Git marketplace and launch the standard CLI with `codex`.
- Load SHIFT.md and the documentation map at session start, refresh changed documents, and use the shared work record tools.
- Request a shift in the current thread, continue from the letter or wait for the owner using the local app server.

## 0.36.1

### Fixed

- In Claude Code, an `Edit` or `Write` that the harness held for the machine's owner to review wrote nothing, yet the mod counted it as a written file: it wrote the toc of a document nobody touched and told the agent that the file had changed. Such a call is no write now, so nothing follows it.

## 0.36.0

### Fixed

- In Claude Code, a prompt let in while a shift was letting the history go — a task notification, another plugin's message — started a turn before the shift's message: the agent worked without its letter for minutes, and the harness drew the queued shift prompt twice. The message after a `continue` shift now goes into the history the compaction leaves, so everything let in after the compaction reads the letter first, and the turn starts from one line. A compaction the mod did not ask for never takes the message or stands for the shift's let-go; a refused command or a skipped compaction falls back to the whole message as the prompt.
- The session block — `SHIFT.md`, `OWNER.md`, `GLOSSARY.md`, `TASKS.md` and the doctrine — is read again before the shift's message enters the history, so a turn let in right after the compaction never reads stale files under a letter that says they were read.

### Changed

- In Claude Code the transcript shows the `/compact` the shift runs and its "Compacted" row, and the letter arrives as a plain history message, without the "The shift plugin sent a message" frame. The shift is the agent's decision; those rows are not typed by the person. pi and opencode are unchanged.

## 0.35.0

### Fixed

- A message the owner sent while a shift was letting the history go reached the agent before its letter: the harness ran the queued message first and the letter's prompt only after that turn, so the agent answered without its records. Now, while a shift waits for its turn to end or lets the history go, the owner's message is held and goes to the agent after the letter, in the same prompt and marked as written during the shift; its attachments go with it. A held message is never lost: if the next turn does not start it waits with the letter for the owner's next message, and if the shift is not made it goes with that news. Slash commands are not held.
  - Claude Code: the message is taken back from the queue, and the owner sees a row that it waits for the shift.
  - pi: input typed during the let-go is held the same way; the let-go no longer runs inside pi's settled handler, which made pi keep the owner's input until the shift was over.
  - opencode: the message waits before it enters the session, then carries the letter; several messages sent during one shift keep their order, and only the first carries the letter.
- The npm package's tests left a folder in the system's temporary directory for every test on every run; they now keep them under one folder and remove them.
