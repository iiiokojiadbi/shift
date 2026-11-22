---
description: How the project-local Beads command and shift history are separated. Open for the implementation order, compatibility checks and supported installation paths.
---

# Project-local tasks and independent shifts

<!-- toc -->
- Ownership
- Implementation and acceptance
<!-- /toc -->

## Ownership

Shift returns the letter, board, owner rules, glossary and documentation map. The board can name a project-wide focus. Next holds the concrete step to resume. Include an issue ID when continuing tracked work. Beads owns the issue, status, dependencies and discussion. The agent opens the issue when its work calls for it.

All four adapters use the tested Beads installation shipped with Shift and the same private workspace at `.shift/beads/`. The project-root command is `./.shift/bin/shift-task` (`shift-task.exe` on Windows). Beads examples that use `bd` refer to this command. The owner's shell configuration and existing tracker belong to the owner.

## Implementation and acceptance

1. **Deliver the command.** Prepare the project entry on session startup and refresh it on upgrade. Initialize the private workspace on first use. Verify native prime, create, show, update and close from different working directories with another bd and another workspace present. Exercise the packaged command on supported platforms.
2. **Separate the shift lifecycle.** Save, continue, wait, restore, compare and size shifts using shift records alone. Verify restoration with the task database unavailable. A retained conversation receives documentation changes through its normal delivery path. Task reads and comments belong to explicit Beads commands.
3. **Verify the storage boundary.** On a disposable copy, reopen a native issue and check its ID, metadata, links and comments with the project command. Restore a saved letter by ID with the task database unavailable. Place older task and snapshot files beside both stores and verify they stay untouched during setup, save and restore.

The archive retains 30 completed shifts by default, deduplicates identical record contents and protects pending letters. See [Records](records.md) for backup, transfer and recovery, and [Development](development.md) for the release gates.
