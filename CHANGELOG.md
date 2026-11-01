# Changelog

What changed in each release of the Claude Code plugin and the npm package `@iiiokojiadbi/shift`, which share one version. Newest first.

## 0.35.0

### Fixed

- A message the owner sent while a shift was letting the history go reached the agent before its letter: the harness ran the queued message first and the letter's prompt only after that turn, so the agent answered without its records. Now, while a shift waits for its turn to end or lets the history go, the owner's message is held and goes to the agent after the letter, in the same prompt and marked as written during the shift; its attachments go with it. A held message is never lost: if the next turn does not start it waits with the letter for the owner's next message, and if the shift is not made it goes with that news. Slash commands are not held.
  - Claude Code: the message is taken back from the queue, and the owner sees a row that it waits for the shift.
  - pi: input typed during the let-go is held the same way; the let-go no longer runs inside pi's settled handler, which made pi keep the owner's input until the shift was over.
  - opencode: the message waits before it enters the session, then carries the letter.
- The npm package's tests left a folder in the system's temporary directory for every test on every run; they now keep them under one folder and remove them.
