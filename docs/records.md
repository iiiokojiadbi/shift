---
description: The records the agent keeps in .shift/ and why each is shaped so: the board, tasks and the archive, OWNER.md, GLOSSARY.md, SHIFT.md, knowledge, settings, shift folders and about.md, and what the mod refuses. The rules as the model reads them are in shift_guide.
---

# shift: records

<!-- toc -->
- Layout
- Board, tasks, archive
- OWNER.md, GLOSSARY.md, SHIFT.md
- Knowledge and where it goes
- Settings
- Shift folders and about.md
- What the mod refuses
<!-- /toc -->

A record is a state, not a diary. Agents write dates and append everywhere, and working files turn into long logs nobody cleans; so every record has fixed sections, a line limit and no dates, and the mod refuses a shift that breaks them. The past is kept by the shift folders, so removing a line is always safe.

The rules as the model reads them live in one place, `core/src/texts/doctrine.ts`: the short doctrine in the system prompt and the full `shift_guide`, read once per project: after a let-go the agent cannot tell its first shift from a later one, so the message after a shift says the guide is known. This document is why they are so.

## Layout

```
.shift/
├── board.md          the goal, project-wide decisions and dead ends
├── TASKS.md          the open tasks, which are in progress, and their links — every session
├── OWNER.md          the owner's decisions in force for the whole project — every session
├── GLOSSARY.md       the project's own words, an article each — every session
├── SHIFT.md          how the project keeps its knowledge, and the map of its docs — every session
├── settings.toml     the owner's settings, optional
├── letter.md         the letter to itself, written anew before every shift
├── knowledge/        traps, lessons, runbook, facts — read on demand
├── tasks/<name>/     task.md — what the task is, its decisions and dead ends; track.md — its tracker; notes/ — notes on its items
├── archive/          finished and dropped tasks; index.md — one line each
└── shifts/<UTC>/     about.md, letter.md, summary.md and a snapshot of the records
```

The names are `NAMES` in `core/src/layout.ts`: reading the records, writing a snapshot and the setup's tree go by that one list. The settings may move OWNER.md, GLOSSARY.md and SHIFT.md; every text that names them passes through `atPlaces`.

## Board, tasks, archive

The topic of work changes, and a single board lost what was done. So each line of work is a task, split by meaning, with its own `task.md` (a title and "Goal", "Done when", "Owner decisions", "Decisions", "Dead ends") and `track.md` (items `- [status] name — note`).

- **TASKS.md** lists every open task, one line each with `in progress`, `deferred` or `waiting for owner`, and under a line its links: `needs` an open task it cannot finish without, `after` an archived one it stands on, `continues` an archived one it picks up. From it alone the agent knows whether it does one task, several or none, and why something waits. On the board the tasks crowded out the decisions and the links had nowhere to go.
- **Notes.** A track item is one line; when an item or the task needs more — research, a decision worked out, evidence — it gets a note in the task's `notes/` folder: free-form beside a frontmatter `description`, linked from its item in `track.md` or from `task.md`. After a shift a task in progress shows its notes as a list with their descriptions, not whole, so the message stays short and the agent opens the one it needs. The mod refuses a note without a description, a note linked from nowhere — it would be forgotten — and a link to a note that is not there. Notes are snapshotted and archived with their task.
- **Opening** is `task_open`: the folder, `task.md` by its sections, `track.md` with the first items and the line with its links in TASKS.md, checked together before anything is written. By hand it was four edits, and a broken one surfaced only at the shift.
- **Statuses** are set by `task_track`, which finds an item by its id: `- [status] #<id> item — what matters`. The mod gives the id — `task_open` numbers the first items, `task_track` the next — and never reuses one in the track; a call names an item in a few characters instead of the words of its name, which cost tokens and could match several. An item without an id, or with one an earlier item took — written by hand, or before ids — is numbered on from the highest whenever `task_track` writes its track and at every shift, so the tracks a shift hands back carry an id on every item and an old project needs no step. Several items go in one call (`items`), all or none: every tool call re-reads the whole history, and a stage's end — one item closed, the next opened — at a 150K history cost a call each.
- **Where a decision lives:** on the board only if it outlives any one task, otherwise in the task, and it goes to the archive with it. A decision may name what it turned down, `rejected: <option> — <why>`: a weighed option is not a dead end, which is something tried.
- **Archive:** `task_archive` moves the folder to `archive/<name>/`, adds its line to `archive/index.md`, takes it out of TASKS.md and points the links into the archive. Coming back to an archived topic is a new task with `continues`.

## OWNER.md, GLOSSARY.md, SHIFT.md

These come into every session whole, beside the system prompt, and again after each shift. Every session pays for them: `shift_setup` shows each file's size and the doctrine's, in characters and estimated tokens, so the owner sees what the mod costs before a file grows into a burden.

- **OWNER.md** — the owner's words in force for the whole project, as a code of rules: a newer word rewrites the older line, and a rule changes only on the owner's word. On the board they crowded out the work — the first migrated project had 31 such lines — and a line in AGENTS.md asking to read them was only text.
- **GLOSSARY.md** — one article per term: `## <term>`, then `Variants`, `Means` (what it is, not what it does), `Avoid` (words not to use for it, so one thing has one name), `Where`, and `Unconfirmed` while an inferred meaning is not checked with the owner. The format follows a glossary kept as a model prompt in another project, with `Avoid` from a domain-modeling practice.
- **SHIFT.md** — how the project keeps its knowledge, on the owner's word, and the map of its documents the mod writes between its markers. It comes from a project where a script wrote such a map into AGENTS.md; there the map grew to two thirds of a 72 KB AGENTS.md. The mod rebuilds the map at a session's start, at a shift and after a write of a document, keeps a toc in each when asked, and speaks only when something is wrong. The tocs and the checks of the files written wait for the next message: an agent writing a set of documents linked to each other was told of every link to a sibling not written yet, and of every toc, one note per file.

A `> [!IMPORTANT]` block in a mapped document is pinned: the map shows it under the document with its section in every session — for the few lines an agent must always have in front of it without opening the document. GitHub draws the same quote as a highlighted note, so a person reading the document sees the line as important too. Pins are optional, and nothing is pinned until the agent pins it; past `[docs] max_pinned` the map, the report after a shift and the note after a run say so, and never refuse.

## Knowledge and where it goes

`knowledge/<kind>[-<topic>].md` holds what the agent learned that stays true for months and is neither a decision, a dead end nor a task: kinds `traps`, `lessons`, `runbook`, `facts`, each entry with its kind's fields. Only its map comes back after a shift; files are read on demand. It was rarely written — one trap in a long session — so a shift accepted after a stretch that changed nothing in `knowledge/` asks once, in its answer, while the stretch's history is still whole; it never refuses for it.

Whether knowledge goes into the project's own docs or stays local is the owner's choice per project — `knowledge = "local" | "project" | "split"`, a split's boundary a rule in OWNER.md; until the owner said, it stays local: the agent does not write a project's shared files on its own guess.

## Settings

`settings.toml` is the owner's, optional, a flat subset of TOML. A missing file or key is the default; an unknown key or table, a key set twice or a bad value is named, leaves the mod on and refuses a shift until fixed — a typo must not switch the mod off silently. Paths are from the project's root: `./OWNER.md` is `OWNER.md`, and the root itself is no docs folder. `shift_setup` lists every key with its value here, its default and the version it came in, and writes nothing — not even the docs' tocs and map; the keys themselves are rows of `SETTING_KEYS`.

`.shift/` is the agent's own, with no git of its own. Whether the project's git takes it in is the owner's choice (`commit`); by default the mod adds it to the repository's local exclude file.

## Shift folders and about.md

Every accepted shift gets `shifts/<UTC stamp>/` — `-2`, `-3` after it when another session took that second —: the letter, a snapshot of the records, `summary.md` (what the harness kept after the let-go) and `about.md` — the shift in brief with a strict structure: a frontmatter (`description`, `at`, `after`, `result`, `tokens`, `summary_chars`, `session`) and the sections "Done", "Dropped", "Archived", "Open", derived from the files against the previous snapshot — an item known by its `#<id>`, an archived task by its folder, so a rename or a reworded line is no new work. `about.ts` writes it and reads it back for `shift_history`, the recent shifts after a shift, and the base of the hint count after a restart — taken from the newest shift that let the history go, passing over one not made or still pending. `/unshift` picks the newest folder with a letter, whatever its outcome — its letter is the freshest state — and tells the agent the outcome when that shift did not finish. The snapshots also tell a stuck task without a date anywhere: a task whose `task.md` and `track.md` are the same through the last `STUCK_SHIFTS` snapshots is named after the shift with its status and the count — a wait for the owner that nobody answered looked the same as one just begun.

## What the mod refuses

A shift is refused on: no letter or a letter section missing or empty; a missing section or a line limit passed in any record; a date (a real day of a real month, never a version) in the board, TASKS.md, a task, OWNER.md, the glossary or knowledge — the letter and SHIFT.md are not checked; an unknown status; TASKS.md and the task folders out of step, a link to nothing, tasks needing each other in a circle; a knowledge file of no kind or without its entry fields; a broken `settings.toml`; `.shift/` not kept out of git when it should be; nothing changed since the last shift that was not refused at its let-go (one `not shifted` left the history whole, so the same records may shift again). A refusal names what to fix; the full list is in `shift_guide`. `shift_setup` runs the same checks, all but "nothing changed", on the records as they are, so a rule added in a newer version or a record broken before the mod looked shows before the shift.

The mod also looks at the records around every tool the agent runs, by each file's time and size from one listing per folder — no file is read unless its stamp moved, and then its text's fingerprint decides, so a file rewritten with the same text, or edited and put back, is no change. A change made while the agent's tool ran is the agent's own: it is checked by the checks of that file alone and told once in that tool's result only when broken. A change made between its tools — the owner's hand, another session — is named in the next result, broken or not, so the agent reads it before writing over it. While another tool runs, a change is not attributed: it may be that tool's. The mod's own tools are only remembered. A record written by hand used to break silently and surface only at the shift, hundreds of K later. Checks across files stay the shift's alone — another record broken, nothing changed — so a record half written in two steps is told once, not refused.
