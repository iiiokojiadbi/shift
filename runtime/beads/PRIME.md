# Shift task conventions

The Beads workflow below is a command reference. In Shift, tracking is optional: use a card when work needs its own status, dependencies or discussion. Keep the next step and any issue ID in the shift letter. Keep owner decisions and reusable knowledge in the project's Shift records. Project and owner instructions govern Git operations and delegation.

Run the project-local `shift-task` returned by `shift_setup(section="tasks")` wherever the reference says `bd`.

- For one outcome with independently finishable parts, use `create "<outcome>" --type epic`. Use `children <epic>` for its full scope and `ready --parent <epic>` for available work. Child membership alone does not set execution order.
- Reuse existing tags with `label list-all`, apply one with `label add <id> <label>`, and filter available work with `ready --label <label>`.
- Reopen the same issue to resume it. For a new finding use `dep add <new> <source> --type discovered-from`; for a topical link use `dep relate <id> <other>`.
