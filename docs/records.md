---
description: How Shift stores records and tasks, upgrades an existing project, and checks records before a shift. Use shift_guide for the agent's instructions.
---

# shift: records

<!-- toc -->
- Layout
- Upgrading an existing project
  - What startup upgrades
  - What the agent does
- Board and project tasks
- OWNER.md, GLOSSARY.md, SHIFT.md
- Knowledge and where it goes
- Settings
- Saved shifts
- What the mod refuses
<!-- /toc -->

A record describes current state. Its sections, line limit and date check keep it usable between shifts. Earlier versions remain readable in retained snapshots.

The short doctrine comes in the system prompt. Read `shift_guide` once per project before the first shift. Its `records` section explains where knowledge goes and how to revise project records. Its `migration` section contains the upgrade instructions below.

## Layout

Internal records are Markdown stored in `.shift/history.db`. Logical names such as `board.md` and `knowledge/traps.md` identify the current text. The board, owner rules, glossary, knowledge and documentation map are shared. Each chat edits its own working letter; pi distinguishes branches. Completed snapshots retain the text accepted at that shift.

```
.shift/
├── settings.toml     versioned project settings
├── drafts/           temporary Markdown from active checkouts
├── bin/              project-local shift-task launcher
├── beads/            optional private task workspace
└── history.db        current record revisions and saved shifts
```

Use `shift_record(action="read", name="board.md")` to get the revision and text. Pass that revision, a unique literal `find` and its `replacement` to `replace`. An optional section title limits the match to that heading's body. For a long edit or the first version of a record, use `checkout`, edit the returned file, then `apply` with its base revision. `drafts` finds interrupted edits for that name in this chat. A conflict or validation failure keeps the draft. Read the current revision, reconcile in a new checkout, then discard the superseded draft. Successful application removes the applied draft. If an editor replaces it during cleanup, the replacement stays at its path. An interrupted cleanup can also leave a recovery file listed by drafts. Compare its text with the current record and remove it after reconciliation. The shift tool still accepts the logical letter path `.shift/letter.md`.

Project documentation, settings and explicit file sources stay on disk. With `commit = true` working records stay file-backed for version control. Before switching an existing database-backed project to file sources, copy its current records to the desired paths and verify their contents. The archive preserves earlier versions.

## Upgrading an existing project

### What startup upgrades

At session start, Shift creates or upgrades `settings.toml`. It fills defaults and help comments, preserves supported values including `enabled = false`, and drops retired keys. With private records, it checks that Git ignores `.shift/` before migrating. An unreadable or invalid settings file, a newer schema or a Git exclusion conflict needs attention before proceeding. A directory with `.shift/sessions/` and no board belongs to the separate shift skill. Check the project root and leave that workspace alone.

When the old settings pointed to an external map with `[files] shift`, startup copies it into the project's internal map if one does not already exist. It rebuilds the generated section, excludes the former path from automatic documentation updates and keeps the original. If the source is inaccessible, startup keeps the old setting and retries at a later start. An existing internal map takes precedence. For an ordinary loose `SHIFT.md` inside `.shift/`, use the record import below.

### What the agent does

1. Inventory `.shift/`, configured file sources and any pending work. Stop other writers and make a verified private backup outside `.shift/` before the upgrade where possible, and always before editing or retiring originals. Check the effective settings and diagnostics with `shift_setup`.
2. Run `shift_record(action="import")` for existing internal `board.md`, `letter.md`, `OWNER.md`, `GLOSSARY.md`, `SHIFT.md` and top-level `knowledge/*.md`. The tool validates the missing records as a batch. If it refuses, fix the named source or explicitly archive an obsolete record, then retry. Existing database revisions and loose sources are preserved. A loose letter imported this way seeds chats until they write their own. With `commit = true`, edit the configured files directly. In every project, explicit file sources stay in use at their configured paths.
3. Review the content before cleanup. Keep the board's current goals and focus. Move lasting decisions and lessons to the appropriate records. If a legacy `knowledge/glossary.md` blocks import, merge its terms into the configured glossary and move the old file out of `.shift/`. If it already exists in the database, retire its loose source first, then use `shift_record(action="delete", name="knowledge/glossary.md", revision=...)` with its current revision. Preserve unresolved owner rules and update the record to the current format when editing it. If the board, owner record or letter is missing, use the guide's `records` and `flow` sections to rebuild it from the project's current evidence.
4. Read records back with `shift_record(action="read", name=...)` and compare with the loose sources, including sources the import skipped because the database already had a record. Reconcile differences before retiring either version. For `SHIFT.md`, compare the project-authored rules because Shift regenerates the map. Run `shift_setup` again. Move verified loose duplicates into the private archive. Check references to an external map before retiring that copy. Keep `settings.toml`, `history.db`, recoverable drafts, configured files and the optional `bin/` and `beads/` directories.
5. Archive the old `shifts/`, `briefs/` and `archive/` after checking their contents. `shift_history` starts with new shifts. Even the most recent loose snapshots remain available only through the private archive. Review `TASKS.md` and `tasks/` separately. If using Beads, prepare it with `shift_setup(section="tasks")`, migrate useful tasks with their status, links and notes, and check them by ID before retiring the old task files. Projects that do not need a tracker can archive the old tasks after reviewing any outstanding work. Keep other files until you know their purpose.

## Board and project tasks

Write the next concrete step in the letter. Use the built-in tracker when work needs its own status, dependencies or discussion. On first use, request the launcher with `shift_setup(section="tasks")` or `/shift-tasks`. Run `./.shift/bin/shift-task prime` from the project root for the shared Shift task workflow. Each adapter prints the project preface followed by the bundled Beads command's original workflow, generated on each call. The preface explains how the optional tracker fits Shift; use the Beads section for its commands. On the first `prime`, the launcher supplies the preface at `.shift/beads/.beads/PRIME.md`. Later versions refresh an untouched default and preserve a project-authored preface. Use `prime --export` for the upstream text alone. Beads handles memory selection once for the entire response. Task data and any Beads memories stay local to that tracker. `shift-task ready` finds available work, `shift-task show <id>` reads an issue and `shift-task comments <id>` reads its discussion. Tasks, claims, dependencies, labels and comments belong to Beads. Put the issue ID and the next concrete step in the working letter when a chat needs to resume a particular issue.

The shared board returns in full. Read it when starting work in an existing project. Under `## Goal`, use an unordered list by default, one stage outcome per bullet. A single goal in prose is also valid. Under `## Current focus`, describe what is underway toward those goals, including temporary conditions that affect other chats. Review the focus when circumstances change. The letter carries the individual next step. Durable design belongs in its document, owner policy in the owner record, and reusable lessons with project knowledge.

Existing boards with Goal, Decisions and Dead ends can still be used for a shift. When revising one, carry forward any constraints that still affect current work and move lasting knowledge to its destination. Saved snapshots retain their original board text.

## OWNER.md, GLOSSARY.md, SHIFT.md

These come into every session whole, beside the system prompt, and again after each shift. Every session pays for them: `shift_setup` shows each file's size and the doctrine's, in characters and estimated tokens, so the owner sees what the mod costs before a file grows into a burden.

- **OWNER.md** — the owner's project-wide decisions. Each bullet takes a second line, `Permanent` or `Until <observable event>`, optionally prefixed with `[tasks ID, ID] · `. When closing a linked issue or changing the relevant workflow, the agent reviews the condition and removes a fulfilled rule. A task link provides context and never triggers an automatic deletion or a Beads query during a shift. Replace superseded rules and remove exact duplicates when revising the record. An existing free-form record may cross its first shift and subsequent shifts while it matches the most recent snapshot. Both setup and shift check this condition. Convert the whole record on edit. On the board they crowded out the work — the first migrated project had 31 such lines — and a line in AGENTS.md asking to read them was only text.
- **GLOSSARY.md** — one article per term: `## <term>`, then `Variants`, `Means` (what it is, not what it does), `Avoid` (words not to use for it, so one thing has one name), `Where`, and `Unconfirmed` while an inferred meaning is not checked with the owner. The format follows a glossary kept as a model prompt in another project, with `Avoid` from a domain-modeling practice.
- **SHIFT.md** — how the project keeps its knowledge, on the owner's word, and the map of its documents the mod writes between its markers. It comes from a project where a script wrote such a map into AGENTS.md; there the map grew to two thirds of a 72 KB AGENTS.md. The mod rebuilds the map at a session's start, at a shift and after a write of a document, and keeps a toc in each when asked. The tocs and the checks of the files written — by Edit or Write, or by a script, found by the documents' stamps — wait for the next message: an agent writing a set of documents linked to each other was told of every link to a sibling not written yet, and of every toc, one note per file.

Directory scans stop at a link back to an ancestor. Explicitly listed files and separate directory aliases keep their configured paths. Every active document keeps its description and sections in the map regardless of map size. Mark an archived reference with `archived: true` in its frontmatter and describe when to consult it. Its map entry shows its path, archive status, description and any explicit pins. Its full outline remains available through `doc_outline`.

A new stretch receives the full current map. While the history is retained, each session remembers the documents it has seen. A new document gets its map entry, a removed one its path. Body edits name the affected section, and changed descriptions and pins carry their updated text. Generated tocs are excluded. The writing session advances its observation silently for a known write. A shell tool with no file receipt can also hide a simultaneous external edit during the same command. An idle or detached session compares against its own checkpoint at the next observation.

A `> [!IMPORTANT]` block in a mapped document is pinned: the map shows it under the document with its section in every session — for the few lines an agent must always have in front of it without opening the document. GitHub draws the same quote as a highlighted note, so a person reading the document sees the line as important too. Pins are optional, and nothing is pinned until the agent pins it; past `[docs] max_pinned` the map, the report after a shift and the note after a run say so, and never refuse.

## Knowledge and where it goes

`knowledge/<kind>[-<topic>].md` holds what the agent learned that stays true for months and is neither a decision, a dead end nor a task: kinds `traps`, `lessons`, `runbook`, `facts`, each entry with its kind's fields. The generated map in `SHIFT.md` shows each file's title, description and level-two topics at session start and after a shift. Read a mapped document or a knowledge file with `shift_read(path, section?)`. An exact heading returns its subtree, including nested entries. Omit the heading for the whole file. Duplicate headings require reading their unique parent or the full file. Knowledge remains readable when project documentation is disabled.

Whether knowledge goes into the project's own docs or stays local is the owner's choice per project — `knowledge = "local" | "project" | "split"`, a split's boundary a rule in OWNER.md; until the owner said, it stays local: the agent does not write a project's shared files on its own guess.

The map stays inside `.shift` in every project. Its logical name is `.shift/SHIFT.md`, stored in the working database by default. The placement decision applies to the documents and knowledge it points to. During an [upgrade](#upgrading-an-existing-project), a temporary marker identifies map rules staged for migration until the settings write succeeds. A retry preserves independent edits to the internal map. While an import is pending, session context and snapshots omit uncommitted rules.

## Settings

At session start Shift creates `.shift/settings.toml` with project defaults. The top-level integer `schema_version` describes the file format independently of the plugin release. An unversioned file and an explicit version 0 use the same migration to schema 1. It retains supported values, fills missing defaults, transfers a former external map as described above and drops unsupported keys and tables, including the obsolete `[docs] max_chars`. Existing choices such as `enabled = false`, an explicit owner path and `knowledge = "split"` keep their meaning. Optional examples in the generated file are comments: uncommenting an owner or glossary path selects a physical file, and choosing a knowledge placement records the owner's decision.

Schema 2 replaces `history_limit` with `[history] full` and `brief`. The old effective limit N (1 through 10) becomes one full letter and N minus one descriptions. New projects start at 1 + 9. An unversioned project runs both migrations. Shift places an English help comment immediately above each setting and commented example. Existing values and owner comments are retained.

An already current file may omit defaults. At the next session start unknown settings are removed and missing help comments are supplied. Repeated starts preserve the resulting file byte for byte. A newer schema, an unreadable file, a malformed line or an invalid supported value leaves the file in place and reports the problem. Ordinary tool calls read settings without upgrading them. Paths are project-relative. The syntax supports flat tables, booleans, numbers, quoted strings and single-line string arrays. The default `shift_setup` report shows effective values and which settings are explicit.

A future schema change with a rename or a change in meaning must translate the previous schema before removing retired keys. Apply each missing version in order, validate the resulting document and write its final version only after its storage changes succeed. Never infer a file version from the installed release.

`.shift/` is the agent's own, with no git of its own. Whether the project's git takes it in is the owner's choice (`commit`); by default the mod adds it to the repository's local exclude file. This also covers migrations in disabled projects.

## Saved shifts

The opening paragraph of “Where I am” supplies the history description. Put the essential work and result in two or three sentences (up to 400 characters). Following paragraphs and block elements stay in the full letter. Older clients can still supply an explicit description through `about`. A restore includes the current opening once in that letter and preceding history according to the project settings.

An explicit restore picks the letter waiting for that chat, even if another chat saved a newer shift. With no waiting letter it picks the latest saved shift in the project.

`shift_history` lists retained IDs, including unsuccessful attempts. Each page reads up to 50 entries. Pass its oldest ID as `before` for the preceding page. Use `action="read"` with an ID and record name, `compare` with two retained IDs in either order, `export` to retrieve a complete snapshot as JSON, or `search` with text to find saved shift records. `delete` removes an eligible shift. Use `shift-task history <id>` for issue revisions.

Acceptance saves the letter and records before the harness lets go. A single transaction records completion, protects waiting letters and rotates the oldest completed shifts. The history window holds ten completed shifts by default. When shift 11 completes, the window contains shifts 2 through 11. The agent receives letter 11 in full and short descriptions of shifts 2 through 10, oldest first. Their full records can be opened by ID. Set `[history] full = 2` and `brief = 18` to retain twenty shifts. After shift 21, descriptions 2 through 19 appear first, followed by the full text of letter 20 as historical context, then the current letter 21. Only the current board and session records are delivered. Only completed shifts fill earlier full and brief slots. With a short history the most recent available letters fill the full slots first. Pending, unsettled and undelivered letters remain recoverable. A completed continue stays protected from rotation until its host accepts the message or records it in replacement history. Identical record contents share a SHA-256 key. Every retained snapshot names all its contents, so deleting a shift leaves the others independently readable. If settings cannot be read, including when a parent directory denies access, settlement and delivery receipts still succeed with rotation deferred. Rotation resumes at the next completion or receipt with valid settings. Freed database pages are reused for future writes.

To transfer a project, stop writers and copy the whole `.shift/` directory along with any project files selected by settings. The next session restores the saved letter. Use the project launcher to open issues in the transferred task database. Diverged copies have independent histories.

## What the mod refuses

Before saving a letter, Shift checks its four sections, the board, owner rules, glossary, knowledge files, settings and git exclusion. A refusal identifies the affected record. The archive compares the snapshot with the same chat's last completed shift to detect unchanged work. A failed attempt can be retried. `shift_setup` checks the current project records on demand.

The mod also looks at the records around every tool the agent runs, using revisions from the current database view and modification stamps for files on disk. When a stamp moves the text's fingerprint decides, so a file rewritten with the same text, or edited and put back, is no change. A change made while the agent's tool ran is the agent's own: it is checked by the checks of that file alone and told once in that tool's result only when broken. A change made between its tools — the owner's hand, another session — is named in the next result, broken or not, so the agent reads it before writing over it. While another tool runs, a change is not attributed: it may be that tool's. The mod's own tools are only remembered. A record written by hand used to break silently and surface only at the shift, hundreds of K later. Checks across files stay the shift's alone — another record broken, nothing changed — so a record half written in two steps is told once, not refused.
