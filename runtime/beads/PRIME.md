# Working with the Shift task tracker

Use the tracker when work needs its own status, dependencies or discussion. Keep the next concrete step in the shift letter. Include the issue ID when continuing tracked work. Keep standing owner decisions and reusable knowledge in the project's Shift records.

Run the project command returned by shift_setup(section="tasks") from the project root. The commands below are its arguments.

- For a named issue, read `show <id>` and `comments <id>`. To choose work, use `ready` or `ready --parent <epic>`. Claim a specific issue with `update <id> --claim`. When multiple workers share the tracker, use a distinct, consistent `--actor <name>` for each worker.
- Create an issue with `create "<title>" --description "<outcome>"`. Group steps with `--parent <epic>`. Record a prerequisite with `dep add <dependent> <prerequisite>`.
- If the same work resumes after closure, use `reopen <id>`. If work on one issue uncovers a new one, create it and run `dep add <new> <source> --type discovered-from`. For independent issues connected by topic, use `dep relate <id> <other>`.
- Record evidence with `comments add <id> "<finding>"`. Close completed work with `close <id> --reason "<result>"`.
- When the owner asks for progress, use `epic status`, `ready --parent <epic>` and `blocked`, or `mol progress <id>` for a workflow created from a formula. Report what finished, what is active and what is waiting. Open the relevant cards for details.
