---
description: Implementation order and acceptance checks for private Beads tasks, independent shift history and migration. Open before changing task storage, packaging or recovery.
---

# Roadmap for task storage and shift history

<!-- toc -->
- Ownership of records
- Implementation order
  - 1. Prove the installation and storage boundaries
  - 2. Replace writable task files with Shift tools over Beads
  - 3. Save and rotate independent shift history
  - 4. Connect live tasks and archived letters to all four adapters
  - 5. Guide an existing project through migration
  - 6. Verify distribution and recovery
<!-- /toc -->

The goal is for an agent to resume with its letter and the work its chat owns **now**. If another chat resolved a blocker while the agent was away, its next task view should show that immediately. The stages below define the acceptance scenarios. The storage layout and migration procedure are documented in [Records](records.md).

## Ownership of records

| Record | Where it belongs | What a returning agent sees |
|---|---|---|
| Active and closed tasks, items, links, claims, labels and comments | A private Beads workspace under `.shift/`, shared by the four adapters in this project | The chat's current tasks. Task history is available on demand. |
| Completed shifts | An independent local archive with stable shift IDs | Its letter and shift records. Comparing two shifts compares only those records. |
| Board, owner decisions, glossary, knowledge and documentation | Editable files in their configured locations | Current records and the documentation map through the existing delivery rules. |

Keep task IDs, task revisions and task lists out of the archive schema. An agent can still mention its work in a letter. Moving or deleting a shift must leave the task graph intact.

## Implementation order

The feature branch implements all six stages. Installed adapters on Linux have read the same task graph and recovered the same saved letter. The installed npm workflow covers migration, restart with a waiting letter, and transfer of both stores. Go race tests exercise retention and interrupted cleanup. Windows amd64 on a local volume passed guarded task writes and archive reads. Linux arm64 ran under emulation. Both macOS packages build; native install and recovery on macOS remain to be verified.

Start with step 1. The task tools in step 2 and the archive in step 3 can then proceed independently. Join them in step 4. Use a disposable legacy project for steps 5 and 6 before migrating a real one.

### 1. Prove the installation and storage boundaries

Package a pinned, complete Beads installation with Shift and resolve its executable from the installed plugin. Exercise each supported package and platform with an empty profile, a conflicting `bd` on PATH, and an unrelated project `.beads/`. Check global configuration and redirects as well as the default data path. Run the checks through each adapter's actual execution port.

**Done when** an ordinary install can create and reopen the private workspace without manual service setup. Two independent processes can operate on it safely, and the unrelated tracker stays untouched. Record the executable layout, required dependencies, supported platforms and observed locking behavior before depending on them. Select the shift archive backend separately using the recovery checks in step 3.

### 2. Replace writable task files with Shift tools over Beads

Start at the tool table in `core/src/tools.ts` and the task flows in `core/src/flows.ts`. Keep shared semantics in the core and put process execution behind a port. Preserve stable task IDs and short item IDs. Cover open, track, archive, reopen, ready/list and show. Reopen a closed task to edit it. A distinct follow-on task can link back with `continues`.

- Apply a batch of item changes atomically and return a short receipt with IDs. Preserve the goal, acceptance criteria, decisions, reasons for waiting and linked evidence when replacing task cards.
- Support project-defined labels, filtering, optional epics with independently claimable children, explicit blockers and task comments. Being in the same epic creates no execution order.
- Claim work per chat. Preserve the claim on resume and after a shift. Allow explicit takeover by ID. Show who holds a contested task.

**Done when** two simultaneous claims produce one holder, an invalid item rolls back the entire batch, and the next ready query reflects a resolved blocker. Read and write through the public tools using the packaged runtime. Check a closed task's history after reopening it.

### 3. Save and rotate independent shift history

Replace the folder assumptions in `store.ts`, `history.ts`, `about.ts` and the history flows under `core/src/`. Define the saved shift fields, outcome and letter retrieval first. Store identical record contents once and let each snapshot refer to them. Display a diff between any two retained snapshots, including nonadjacent ones. Start with exact deduplication. Evaluate delta storage later if measurements justify it.

**Done when** a failed save leaves the letter and previous shifts readable and a retry produces one completed shift. With the default limit of 30, a successful 31st completion rotates the oldest completed shift. A pending letter survives rotation. Deleting a shift reclaims only versions no remaining snapshot needs. Verify a configurable limit, history listing, comparison, export and restoration on a second project copy.

### 4. Connect live tasks and archived letters to all four adapters

Use the current task view for the session block, continuation, owner task listing and size report. Read the appropriate letter from shift history for continue, wait and manual restore. Audit every consumer of old snapshots, including the unchanged-records check, stuck-task hints, outcome rendering and gauge restoration. Any signal about task progress must come from current work or Beads history.

**Done when** a resumed chat sees all its open items, a closed count, up to ten recent closures and a comment count. Another chat's new comment produces one short notification for the working chat and the writer gets no echo. Verify letter ordering, single delivery, the retained prompt prefix and the full map after a shift. Exercise both a fresh chat and a returning one through each adapter.

### 5. Guide an existing project through migration

1. At every session start and after every shift, show the migration instructions while legacy cleanup is pending. List the still-open legacy tasks, including deferred tasks and those waiting for the owner.
2. The agent manually transfers current work through the task tools, checking items, blockers and evidence. Account for each open task so an interrupted transfer can resume without duplicates. Leave old shifts and closed tasks in the legacy backup.
3. Make one new shift, verify it is durable and resume from it. The retention window starts with this new history.
4. Finish with an explicit, repeatable cleanup command. Verify a recoverable local backup and the completed transfer before removing obsolete records. Preserve current files, configured documentation paths, the new stores and the backup.

**Done when** interrupting each step allows a safe retry. A failed backup check prevents deletion. A project with zero open tasks can migrate. The reminder disappears after successful cleanup and a second cleanup removes nothing.

### 6. Verify distribution and recovery

Run the repository gates and clean-profile installation checks from [Development](development.md). Exercise one shared project from all four installed adapters. Back up and transfer it, then resume, list ready work, read a closed task and compare retained shifts. Record which checks exercised real installs and which used simulated host events.

Update the guide, tools, user commands, settings, size reporting and release notes alongside the behavior they describe. Provide local search across task and shift records with results identified by source. Optional vector search can follow independently. Saving and restoring must work offline, and sending text to an external embedding service requires the owner's explicit choice. Merging diverged project copies is outside this release.

**Done when** the packaged upgrade passes both clean-install and legacy migration scenarios, and a transferred backup restores both independent histories.
