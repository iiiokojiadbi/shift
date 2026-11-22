# Working with the Shift task tracker

Use the tracker when work needs its own status, dependencies or discussion. Keep the next concrete step in the shift letter. Include the issue ID when continuing tracked work. Keep standing owner decisions and reusable knowledge in the project's Shift records.

Run the project command returned by shift_setup(section="tasks") from the project root. The commands below are its arguments.

## Find and organize work

- Read a named issue with `show <id>` and its discussion with `comments <id>`. Use `search "<words>"` to find existing work before opening a similar issue.
- Create a card with `create "<title>" --description "<outcome>"`. Add `--type bug`, `--priority 1` or `--acceptance "<observable result>"` when helpful. Priorities run from 0 (highest) to 4 (backlog), with 2 as the default. Use `update <id>` with the same priority or acceptance flags when these change.
- Reuse project labels from `label list-all`. For example, add `--labels docs,review` at creation, or use `label add <id> review` later. Inspect a card with `label list <id>` and remove a label with `label remove <id> review`. Use `list --label review` to browse matching cards or `ready --label review` to find matching work available now.

## Work on a card

- Choose work with `ready` or `ready --parent <epic>`. Claim a specific issue with `update <id> --claim`. When multiple workers share the tracker, use a distinct, consistent `--actor <name>` for each worker.
- Group steps with `create "<title>" --parent <epic>`. Record a prerequisite with `dep add <dependent> <prerequisite>`. Use `blocked` to see what is waiting. To set work aside until a date, use `defer <id> --until tomorrow`.
- Record evidence with `comments add <id> "<finding>"`. Close completed work with `close <id> --reason "<result>"`. If the same work resumes after closure, use `reopen <id>`.
- If work on one issue uncovers a new one, create it and run `dep add <new> <source> --type discovered-from`. For independent issues connected by topic, use `dep relate <id> <other>`.

## Report and look up details

When the owner asks for progress, use `epic status`, `ready --parent <epic>` and `blocked`, or `mol progress <id>` for a workflow created from a formula. Report what finished, what is active and what is waiting. Open the relevant cards for details.

Use `--help` to discover commands and `<command> --help` for exact arguments and examples, such as `label --help` or `dep add --help`.
