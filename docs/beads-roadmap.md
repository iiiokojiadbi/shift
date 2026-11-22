---
description: Storage boundaries and acceptance scenarios for the optional project task command and independent shift history. Read before changing either store.
---

# Project-local tasks and independent shifts

<!-- toc -->
- Ownership
- Acceptance checks
<!-- /toc -->

## Ownership

Shift stores its internal records and retained shifts in `history.db`. Beads uses its own embedded database and profile for issues, statuses, dependencies and discussion. The archive and record operations run through the same bundled executable and use only the Shift storage path. An unavailable Beads workspace does not prevent a shift or restore.

All four adapters prepare the same [project command and guide](records.md#board-and-project-tasks) for the private `.shift/beads/` workspace. The launcher uses a separate profile and keeps the owner's other Beads workspaces independent.

## Acceptance checks

1. **Deliver the command.** Prepare or refresh the project entry when the tracker is requested, or on startup when configured. Initialize the private workspace on first use. Verify native prime, create, show, update and close from different working directories with another bd and another workspace present. Exercise the packaged command on supported platforms.
2. **Separate the shift lifecycle.** Save, continue, wait, restore, compare and size shifts using shift records alone. Verify restoration with the task database unavailable. A retained conversation receives documentation changes through its normal delivery path. Task reads and comments belong to explicit Beads commands.
3. **Verify the storage boundary.** On a disposable copy, reopen a native issue and check its ID, metadata, links and comments with the project command. Restore a saved letter by ID with the task database unavailable. Place older task and snapshot files beside both stores and verify they stay untouched during setup, save and restore.

See [records](records.md) for migration, retention and transfer, and [development](development.md) for the commands that exercise these checks.
