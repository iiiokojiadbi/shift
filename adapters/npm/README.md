# Shift for pi and opencode

Shift lets a coding agent continue long work across context resets. The agent maintains a shared board, writes itself a letter and starts a fresh stretch with the current project records. By default it also receives nine earlier descriptions and can open retained shifts by ID.

## Install

For pi:

```sh
pi install npm:@iiiokojiadbi/shift
```

For opencode:

```sh
opencode plugin add @iiiokojiadbi/shift
```

Keep optional dependencies enabled so npm can install the platform build of Shift. Open a session in a project and give the agent work. Use `/shift` to ask it to shift now, `/unshift` to pick up a saved shift in a new session, or `/shift-tasks` to find the optional task command.

## Project files

Shift creates commented settings in `.shift/settings.toml` and keeps current Markdown records and recent shifts in `.shift/history.db` by default. Project docs stay in their own files and appear by topic in the documentation map. For an older project, ask the agent to read `shift_guide(section="migration")`. [Records and upgrade guide](https://github.com/iiiokojiadbi/shift/blob/main/docs/records.md)

The optional Beads tracker stores tasks separately in `.shift/beads/`. After preparing it with `/shift-tasks`, run `./.shift/bin/shift-task prime` from the project root, or `./.shift/bin/shift-task.exe prime` on Windows. It shows Shift's task conventions and the full bundled Beads workflow.

[Project documentation](https://github.com/iiiokojiadbi/shift) · [Changelog](https://github.com/iiiokojiadbi/shift/blob/main/CHANGELOG.md)
