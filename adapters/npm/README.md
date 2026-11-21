# shift for pi and opencode

[![npm](https://img.shields.io/npm/v/@iiiokojiadbi/shift)](https://www.npmjs.com/package/@iiiokojiadbi/shift)
[![downloads](https://img.shields.io/npm/dm/@iiiokojiadbi/shift)](https://www.npmjs.com/package/@iiiokojiadbi/shift)
[![license](https://img.shields.io/npm/l/@iiiokojiadbi/shift)](https://github.com/iiiokojiadbi/shift/blob/main/LICENSE)

The agent decides by itself when to **shift**. At a stage boundary it updates its board and current tasks, writes a letter to itself, and has the harness let the stretch's history go, with a direction of what to hold. Right after the shift it gets its letter and board back and continues from where it stopped.

One package for both harnesses: pi loads `index.ts`, opencode loads `server.ts`.

```sh
pi install npm:@iiiokojiadbi/shift
opencode plugin add @iiiokojiadbi/shift
```

It adds a "Shift" section to the system prompt, the `shift` tool with its companions (`shift_guide`, `shift_status`, `shift_history`, `shift_setup`, `shift_sizes`, `doc_outline`, `docs_mentioning`), and three commands: `/shift` asks the agent to shift now, `/shift-tasks` shows the project task command, `/unshift` picks up the last shift in a fresh session. It hints a shift as the history grows.

The platform package supplies the private task runtime. Tasks and comments live in `.shift/beads/`; letters and snapshots live in `.shift/history.db`.

The records live in the project's `.shift/` folder and stay out of its git unless `commit = true` in `.shift/settings.toml`.

How it works and why: [github.com/iiiokojiadbi/shift](https://github.com/iiiokojiadbi/shift).

Use `./.shift/bin/sbd prime` from the project root for the bundled Beads CLI. Use `./.shift/bin/sbd.exe` on Windows.
