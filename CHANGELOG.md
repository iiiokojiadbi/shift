# Changelog

What changed in each release of the Claude Code plugin and the npm package `@iiiokojiadbi/shift`, which share one version. Newest first.

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
