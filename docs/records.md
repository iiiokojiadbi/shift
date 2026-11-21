---
description: The records the agent keeps in .shift/ and why each is shaped so: the board, tasks and the archive, OWNER.md, GLOSSARY.md, SHIFT.md, knowledge, settings, shift history and migration, and what the mod refuses. The rules as the model reads them are in shift_guide.
---

# shift: records

<!-- toc -->
- Layout
- Board, tasks, archive
- OWNER.md, GLOSSARY.md, SHIFT.md
- Knowledge and where it goes
- Settings
- Saved shifts
- Migrating an existing project
- What the mod refuses
<!-- /toc -->

A record is a state, not a diary. Agents write dates and append everywhere, and working files turn into long logs nobody cleans; so every record has fixed sections, a line limit and no dates, and the mod refuses a shift that breaks them. Earlier versions are retained in the shift archive, so removing a line is always safe.

The rules as the model reads them live in one place, `core/src/texts/doctrine.ts`: the short doctrine in the system prompt and the full `shift_guide`, read once per project: after a let-go the agent cannot tell its first shift from a later one, so the message after a shift says the guide is known. Its `records` section also explains how to choose and revise the document for a behavior change, with examples of what belongs on the board and in an owner rule.

## Layout

Current project records remain editable in their configured locations. Both databases belong to the project and work offline.

```
.shift/
├── board.md          current goal, cross-task decisions and dead ends
├── OWNER.md          the owner's standing decisions
├── GLOSSARY.md       project terminology
├── SHIFT.md          knowledge rules and documentation map
├── settings.toml     optional project settings
├── letter.md         the working letter
├── knowledge/        traps, lessons, runbook and facts
├── beads/            private task graph, history and runtime profile
└── history.db        shift manifests and shared record contents
```

The names are `NAMES` in `core/src/layout.ts`: reading the records, writing a snapshot and the setup's tree go by that one list. The settings may move OWNER.md, GLOSSARY.md and SHIFT.md; every text that names them passes through `atPlaces`.

## Board, tasks, archive

The private task runtime stores a new task as a Beads issue. `task_open` accepts labels, an optional epic parent, blockers and initial items. The supplied name becomes a stable `shift-<name>` ID. In-progress work is assigned to the calling chat. Use `status: open` for unclaimed work. `task_query` lists ready work, filters by label, shows the current card or reads comments and issue history. A card includes its open items, recent closures and comment count. Showing an epic lists its children by ID.

`task_manage` claims, releases, takes over or reopens a task, edits its card and labels, adjusts blockers, or adds a comment. Another chat can comment on claimed work. `task_track` applies a batch of item changes in one issue update. A private write lock covers the mutation and its checks on issue revisions, labels, dependencies and comment counts. A concurrent change asks the caller to reread. Dropping an epic or blocked task closes that issue while preserving its children and dependency links. Large trackers, comments, goals and design text travel through file input. The native CLI takes titles, acceptance criteria, evidence and labels inline, subject to the operating system command-line limit. Use a comment for longer evidence.

After a shift the chat receives the current cards for its claimed work, with every open item, a count of closed items, the ten most recent closures and the comment count. On reattachment the first prompt checks the current cards. A changed task or claim is delivered alongside the retained context. External comments on claimed work produce a short prompt notification. Each chat remembers the count it saw even after releasing the claim. When the embedded database manifest is unchanged, the prompt skips the native comment query. Read the conversation on demand with `task_query(view="comments")`. Use `continues` when opening distinct follow-on work. Reopen a closed task to revise it.

The board returns in full. Keep the goal to the current project outcome. A decision records a choice other tasks must follow and its reason. A dead end records what was tried, the observed failure and the condition under which it matters. Review affected lines when scope changes or a task closes. Keep decisions specific to one task on its card.

## OWNER.md, GLOSSARY.md, SHIFT.md

These come into every session whole, beside the system prompt, and again after each shift. Every session pays for them: `shift_setup` shows each file's size and the doctrine's, in characters and estimated tokens, so the owner sees what the mod costs before a file grows into a burden.

- **OWNER.md** — the owner's words in force for the whole project, as a code of rules: a newer word rewrites the older line, and a rule changes only on the owner's word. On the board they crowded out the work — the first migrated project had 31 such lines — and a line in AGENTS.md asking to read them was only text.
- **GLOSSARY.md** — one article per term: `## <term>`, then `Variants`, `Means` (what it is, not what it does), `Avoid` (words not to use for it, so one thing has one name), `Where`, and `Unconfirmed` while an inferred meaning is not checked with the owner. The format follows a glossary kept as a model prompt in another project, with `Avoid` from a domain-modeling practice.
- **SHIFT.md** — how the project keeps its knowledge, on the owner's word, and the map of its documents the mod writes between its markers. It comes from a project where a script wrote such a map into AGENTS.md; there the map grew to two thirds of a 72 KB AGENTS.md. The mod rebuilds the map at a session's start, at a shift and after a write of a document, and keeps a toc in each when asked. The tocs and the checks of the files written — by Edit or Write, or by a script, found by the documents' stamps — wait for the next message: an agent writing a set of documents linked to each other was told of every link to a sibling not written yet, and of every toc, one note per file.

Every active document keeps its description and sections in the map regardless of map size. Existing `[docs] max_chars` values are accepted for compatibility. Mark an archived reference with `archived: true` in its frontmatter and describe when to consult it. Its map entry shows its path, archive status, description and any explicit pins. Its full outline remains available through `doc_outline`.

A new stretch receives the full current map. While the history is retained, each session remembers the documents it has seen. A new document gets its map entry, a removed one its path. Body edits name the affected section, and changed descriptions and pins carry their updated text. Generated tocs are excluded. The writing session advances its observation silently for a known write. A shell tool with no file receipt can also hide a simultaneous external edit during the same command. An idle or detached session compares against its own checkpoint at the next observation.

A `> [!IMPORTANT]` block in a mapped document is pinned: the map shows it under the document with its section in every session — for the few lines an agent must always have in front of it without opening the document. GitHub draws the same quote as a highlighted note, so a person reading the document sees the line as important too. Pins are optional, and nothing is pinned until the agent pins it; past `[docs] max_pinned` the map, the report after a shift and the note after a run say so, and never refuse.

## Knowledge and where it goes

`knowledge/<kind>[-<topic>].md` holds what the agent learned that stays true for months and is neither a decision, a dead end nor a task: kinds `traps`, `lessons`, `runbook`, `facts`, each entry with its kind's fields. Only its map comes back after a shift; files are read on demand. It was rarely written — one trap in a long session — so a shift accepted after a stretch that changed nothing in `knowledge/` asks once, in its answer, while the stretch's history is still whole; it never refuses for it.

Whether knowledge goes into the project's own docs or stays local is the owner's choice per project — `knowledge = "local" | "project" | "split"`, a split's boundary a rule in OWNER.md; until the owner said, it stays local: the agent does not write a project's shared files on its own guess.

## Settings

`settings.toml` is the owner's, optional, a flat subset of TOML. A missing file or key is the default; an unknown key or table, a key set twice or a bad value is named, leaves the mod on and refuses a shift until fixed — a typo must not switch the mod off silently. Paths are from the project's root: `./OWNER.md` is `OWNER.md`, and the root itself is no docs folder. `shift_setup` lists every key with its value here, its default and the version it came in, and writes nothing — not even the docs' tocs and map; the keys themselves are rows of `SETTING_KEYS`.

`.shift/` is the agent's own, with no git of its own. Whether the project's git takes it in is the owner's choice (`commit`); by default the mod adds it to the repository's local exclude file.

## Saved shifts

The opening paragraph of “Where I am” supplies the history description. Put the essential work and result in two or three sentences (400 characters total). Following paragraphs and block elements stay in the full letter. Older clients can still supply an explicit description through `about`. A restore includes the current opening once in that letter and the retained shifts preceding that letter as brief entries. A waiting chat can therefore restore an older letter after another chat has shifted.

An explicit restore picks the letter waiting for that chat, even if another chat saved a newer shift. With no waiting letter it picks the latest saved shift in the project.

`shift_history` lists retained IDs. Use `action="read"` with an ID and record name, `compare` with two retained IDs in either order, `export` to retrieve a complete snapshot as JSON, or `search` with text to get local matches labeled by source. `delete` removes an eligible shift. Read task revisions with `task_query(view="history")`.

Acceptance saves the letter and records before the harness lets go. A single transaction records completion, protects waiting letters and rotates the oldest completed shifts. The default `history_limit` is 30. Pending, unsettled and undelivered letters remain recoverable. A completed continue stays protected from rotation until its host accepts the message or records it in replacement history. Identical record contents share a SHA-256 key. Every retained snapshot names all its contents, so deleting a shift leaves the others independently readable. Rotation reclaims unused database pages for future writes.

To transfer a project, stop writers and copy the whole `.shift/` directory along with any project files selected by settings. The next session reads the saved letter and the current tasks. Diverged copies have independent histories.

## Migrating an existing project

Until cleanup finishes, the first prompt on session start and after a shift identifies legacy records. Use `shift_migrate(action="start")` to create and verify a local backup. Recreate each current task, including deferred and waiting work, through the task tools. Check its items, status, links and evidence, then confirm its old name and stable ID. Old shifts and closed tasks stay in the backup. Projects with no open tasks can proceed straight to the new shift.

Make one new shift and restore its letter. Pass its ID and restoration receipt to `shift_migrate(action="cleanup")`. Cleanup checks the backup, destinations, settings, resolved paths of current records and mapped documents, and the durable shift before moving the old task list and directories out of use. It keeps the verified copy separate from the moved originals because an older process may still write through an open file handle. If a source changed, rerun start, verify the new generation and confirm the tasks again. After an interrupted cleanup, start restores missing roots and identifies any overlapping originals to reconcile. Repeating completed cleanup is safe. If an older client recreates legacy records after cleanup, the next migration notice identifies them. Starting again creates a separate backup for those records.

## What the mod refuses

The editable records are checked before a shift. The following task-folder checks apply while using the legacy layout. A shift is refused on: no letter or a letter section missing or empty; a missing section or a line limit passed in any record; a date (a real day of a real month, never a version) in the board, TASKS.md, a task, OWNER.md, the glossary or knowledge — the letter and SHIFT.md are not checked; an unknown status; TASKS.md and the task folders out of step, a link to nothing, tasks needing each other in a circle; a knowledge file of no kind or without its entry fields; a broken `settings.toml`; `.shift/` not kept out of git when it should be; nothing changed since the last shift that was not refused at its let-go (one `not shifted` left the history whole, so the same records may shift again). A refusal names what to fix; the full list is in `shift_guide`. `shift_setup` runs the same checks, all but "nothing changed", on the records as they are, so a rule added in a newer version or a record broken before the mod looked shows before the shift.

The mod also looks at the records around every tool the agent runs, by each file's time and size from one listing per folder — no file is read unless its stamp moved, and then its text's fingerprint decides, so a file rewritten with the same text, or edited and put back, is no change. A change made while the agent's tool ran is the agent's own: it is checked by the checks of that file alone and told once in that tool's result only when broken. A change made between its tools — the owner's hand, another session — is named in the next result, broken or not, so the agent reads it before writing over it. While another tool runs, a change is not attributed: it may be that tool's. The mod's own tools are only remembered. A record written by hand used to break silently and surface only at the shift, hundreds of K later. Checks across files stay the shift's alone — another record broken, nothing changed — so a record half written in two steps is told once, not refused.
