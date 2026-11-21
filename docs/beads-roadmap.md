---
description: How the project-local Beads command and shift history are separated. Open for the implementation order, compatibility checks and supported installation paths.
---

# Project-local tasks and independent shifts

<!-- toc -->
- Ownership
- Implementation and acceptance
<!-- /toc -->

## Ownership

Shift returns the letter, board, owner rules, glossary and documentation map. The board can name a project-wide focus. The letter can name a task ID in Next. Beads owns the issue, status, dependencies and discussion. The agent opens the issue when its work calls for it.

All four adapters use the tested Beads installation shipped with Shift and the same private workspace at `.shift/beads/`. The project-root command is `./.shift/bin/sbd` (`sbd.exe` on Windows). Beads examples that use `bd` refer to this command. The owner's shell configuration and existing tracker belong to the owner.

## Implementation and acceptance

1. **Deliver the command.** Prepare the project entry on session startup and refresh it on upgrade. Initialize the private workspace on first use. Verify native prime, create, show, update and close from different working directories with another bd and another workspace present. Exercise the packaged command on supported platforms.
2. **Separate the shift lifecycle.** Save, continue, wait, restore, compare and size shifts using shift records alone. Verify restoration with the task database unavailable. A retained conversation receives documentation changes through its normal delivery path. Task reads and comments belong to explicit Beads commands.
3. **Preserve existing work.** On a disposable copy, read an existing issue, its numbered items, links and evidence, update it with native commands, and reopen a closed issue. Verify the legacy transfer, restoration receipt and protected backup. Remove the task tool registrations and update the agent instructions. Exercise the public interfaces and repeat review before release.

The archive retains 30 completed shifts by default, deduplicates identical record contents and protects pending letters. See [Records](records.md) for backup, transfer and recovery, and [Development](development.md) for the release gates.
