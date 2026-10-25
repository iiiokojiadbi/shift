# shift for pi

The agent decides by itself when to **shift**. At a stage boundary it updates its work board and task folders, writes a letter to itself, and has pi let the stretch's history go, with a direction of what to hold. Right after the shift it gets its letter, board and tasks in progress back whole and continues from where it stopped.

```sh
pi install npm:@iiiokojiadbi/shift
```

The extension adds a "Shift" section to the system prompt, the `shift` tool with its companions (`shift_guide`, `shift_status`, `shift_history`, `shift_setup`, `task_open`, `task_track`, `task_archive`, `doc_outline`, `docs_mentioning`), and two commands: `/shift-tasks` lists the open tasks, `/unshift` picks up the last shift in a fresh session. It hints a shift as the history grows.

The records live in the project's `.shift/` folder and stay out of its git unless `commit = true` in `.shift/settings.toml`.

How it works and why: [github.com/iiiokojiadbi/shift](https://github.com/iiiokojiadbi/shift).
