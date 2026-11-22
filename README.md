# shift

[![npm](https://img.shields.io/npm/v/@iiiokojiadbi/shift)](https://www.npmjs.com/package/@iiiokojiadbi/shift)
[![downloads](https://img.shields.io/npm/dm/@iiiokojiadbi/shift)](https://www.npmjs.com/package/@iiiokojiadbi/shift)
[![license](https://img.shields.io/npm/l/@iiiokojiadbi/shift)](https://github.com/iiiokojiadbi/shift/blob/main/LICENSE)

An agent decides by itself when to **shift**. At a stage boundary it updates its board, writes a letter to itself and asks the harness to let the stretch's history go, saying what to hold. Right after the shift its letter and board come back, and it continues from where it stopped. The agent does not change: only what is in front of it does.

Long work outlives the context window. A harness's own compaction keeps a generic summary of the history, not the agent's line of thought: decisions get lost, and knowledge that was written down is not looked up again. shift keeps the thread on disk, in records strict enough to resume from: a state, not a diary.

Works in [Claude Code](#claude-code) (as a mod), [pi](#pi) (as an extension) and [opencode](#opencode) (as a plugin). A marketplace plugin is available for [Codex](#codex).

## How it works

1. **Records as you go.** The agent keeps `.shift/` in the project: a board (stage goals and the current shared focus), the owner's decisions, a glossary, and knowledge by kind.
2. **When to shift.** A soft hint invites the agent to shift at a stage boundary. A final hint tells it to check the records, write its letter and shift immediately. Small windows receive only the final hint.
3. **The letter.** Before a shift the agent edits its working `letter.md` with `shift_record`: where it is, what is next, what is unverified, and what the harness must hold.
4. **The shift.** The agent calls the `shift` tool with `continue` or `wait`. The mod checks the records and refuses on a date, a missing section, a board over 150 lines, invalid records or no recorded progress. Then it saves the letter and project records in `.shift/history.db` and has the harness let the history go, steered by the letter's Hold.
5. **Back to work.** The next message carries the project records, earlier shifts according to the history settings, and the current letter last. With `continue` the agent goes on by itself. With `wait` it stops, and the letter arrives with the owner's next message.

An enabled project gives the agent its available session records. `SHIFT.md` maps project docs and local knowledge. `OWNER.md` and `GLOSSARY.md` carry standing decisions and project terms. The agent keeps the docs current during the work so it can find the right details after a shift.

### Project tasks

Write the next step in the shift letter. Use the built-in tracker when work needs its own status, dependencies or discussion. To continue a tracked issue, include its ID in the letter. Prepare the optional tracker with `shift_setup(section="tasks")` or `/shift-tasks`. From the project root, run `./.shift/bin/shift-task prime` (Windows: `./.shift/bin/shift-task.exe prime`). This shows the Shift task conventions followed by the original Beads workflow. Use `ready` to find work and `show <id>` to read an issue. The first task command initializes the private workspace. The system PATH and any unrelated Beads installation stay independent.

## Install

### Codex

Requires Bun on PATH and Codex CLI (tested with 0.171.0). Subscribe to stable releases from the repository's marketplace:

```sh
codex plugin marketplace add iiiokojiadbi/shift --ref codex-stable
codex plugin add shift@shift
```

Start Codex with `codex` as usual. In `/hooks`, review and trust the hooks supplied by `shift@shift`, then open a new thread. The first turn receives SHIFT.md with its documentation map. To let the agent initiate a shift, the TUI needs the local app server. If its daemon is stopped, run `codex app-server daemon start` once and reopen Codex. See [Commands](#commands) for the terminal inputs.

For an existing installation pinned to a version tag, change the `ref` line under `[marketplaces.shift]` in your Codex `config.toml` to `ref = "codex-stable"` once. For updates, exit Codex and run:

```sh
codex plugin marketplace upgrade shift
```

Reopen your thread with `codex resume` and review modified hooks in `/hooks`.

### Claude Code

```sh
claude plugin marketplace add iiiokojiadbi/claude-plugins
claude plugin install shift@iiiokojiadbi
```

Restart the session after installing or updating.

### pi

```sh
pi install npm:@iiiokojiadbi/shift
```

### opencode

```sh
opencode plugin add @iiiokojiadbi/shift
```

The same npm package as pi's; opencode 2.x.

## Commands

**Codex terminal.** In the message box, type `$shift` and choose an action with the arrow keys and Tab. Add your request if needed, then press Enter. The plugin hooks must be trusted in `/hooks`.

| Selected action | Result |
|---|---|
| `$shift:unshift review the project` | Restore a pending letter for this chat or the latest saved shift, with the board and your request in the same turn. Omit the request to continue from the letter. |
| `$shift:shift` | Asks the agent to prepare its records and letter and perform a shift. You can add instructions such as `continue`. |
| `$shift:sizes` | Prints estimated token counts by entity and for up to three saved letters. |
| `$shift:tasks` | Shows the project command for listing tasks. |

Both reports appear under **Hook stopped**, before any model call. The typed aliases `//unshift`, `//shift`, `//shift_sizes` and `//shift-tasks` also work.

**Claude Code, pi and opencode**

- `/shift [words]` — ask the agent to shift now, hint or not. The words go to it with the ask.
- `/unshift [words]` — in a fresh session, pick up the last shift: the letter and the board go to the agent. The words become your message after the letter.
- `/shift-tasks` — show the project command for listing tasks. The agent is not asked.

## Tools the agent gets

| Tool | What it does |
|---|---|
| `shift` | make a shift: `letter`, `after` (`continue` or `wait`); history uses the opening paragraph of the letter |
| `shift_guide` | full guide or one section, `flow`, `records` or `migration` |
| `shift_sizes` | estimated token table by entity, plus the last three saved letters. For o200k_base counts run `bun run shift:sizes [project]` from the checkout |
| `shift_status` | how full the history is and when the next hint comes |
| `shift_record` | read or edit current Markdown, check out a temporary file, import existing internal records, or retire a knowledge record at its revision. [Working records](docs/records.md) |
| `shift_history` | list, read, compare, export or delete retained shifts, or search saved shift records locally |
| `shift_setup` | settings, record checks and session files. Section `tasks` prepares the task command. Section `runtime` checks the bundled Beads executable |
| `shift_read` | read a mapped document or knowledge file, optionally by exact heading |
| `doc_outline` / `docs_mentioning` | a document's sections with line numbers; which documents mention a file |

## Settings

`.shift/settings.toml` is created with project defaults at session start. Each setting has a comment explaining its accepted values. The top-level `schema_version` identifies the file format. The read-only `shift_setup` report lists the effective values. To move an older project to the current layout, use `shift_guide(section="migration")` or follow [the upgrade guide](docs/records.md#upgrading-an-existing-project).

| Key | Meaning |
|---|---|
| `enabled` | `false` turns the mod off in this project |
| `[history]` `full`, `brief` | full letters including the current one (default 1), then the number of older descriptions (default 9). The archive keeps their sum. Undelivered letters are protected |
| `[tasks]` `prepare` | `"on_demand"` (default) prepares the optional project command on explicit request. `"on_start"` prepares it at session start |
| `[hints]` `soft` | `true` (default) allows the early reminder when the host has room. `false` keeps only the final reminder |
| `knowledge` | where knowledge goes: `local`, `project` or `split`. Local records use logical names under `knowledge/` |
| `commit` | `true` keeps working records file-backed and lets the project track them in Git. With private records Shift checks the local Git exclusion |
| `[files]` `owner`, `glossary` | explicit file paths for the owner record and glossary. The documentation map has a fixed logical path inside `.shift` |
| `[files]` `always` | the project's own files loaded whole into every session |
| `[docs]` `dirs` | the folders and individual files mapped into `SHIFT.md`; `[]` disables project documentation and keeps local knowledge topics in the map |
| `[docs]` `max_depth` | levels below each listed directory, default 8. Set 0 for direct children only. Explicit file paths work at any depth |
| `[docs]` `exclude` | individual document paths to leave out of the map, automatic tocs and checks |
| `[docs]` `toc`, `max_pinned`, `max_description`, `max_lines` | document tocs and checks for pins, descriptions and file length |

## Documentation

Shift includes the pinned task runtime for its supported platforms. It uses a private workspace inside `.shift/`. Existing Beads issues and saved shift IDs are read directly from their respective databases. [Project records](docs/records.md)

- [docs/concept.md](docs/concept.md): the idea, the loop, how the model sees it.
- [docs/records.md](docs/records.md): what the agent keeps in `.shift/` and why.
- [docs/hints.md](docs/hints.md): when the mod hints a shift.
- [docs/architecture.md](docs/architecture.md): the core, the ports, where a change goes.
- [docs/adapters.md](docs/adapters.md): each harness's slots and facts.
- [docs/development.md](docs/development.md): commands, tests, installing for development, the release.
- [docs/research.md](docs/research.md): what the design stands on from outside.

`AGENTS.md` holds the map of the repo and the rules for every change.

## License

MIT
