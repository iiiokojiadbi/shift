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

The rules as the model reads them live in one place, `core/src/texts/doctrine.ts`: the short doctrine in the system prompt and the full `shift_guide`. This document is why they are so.

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

- **TASKS.md** lists every open task, one line each with `in progress`, `deferred` or `waiting for owner`, and under a line its links: `needs` an open task it cannot finish without, `after` a done one it stands on, `continues` an archived one it picks up. From it alone the agent knows whether it does one task, several or none, and why something waits. On the board the tasks crowded out the decisions and the links had nowhere to go.
- **Notes.** A track item is one line; when an item or the task needs more — research, a decision worked out, evidence — it gets a note in the task's `notes/` folder: free-form beside a frontmatter `description`, linked from its item in `track.md` or from `task.md`. After a shift a task in progress shows its notes as a list with their descriptions, not whole, so the message stays short and the agent opens the one it needs. The mod refuses a note without a description, a note linked from nowhere — it would be forgotten — and a link to a note that is not there. Notes are snapshotted and archived with their task.
- **Statuses** are set by `task_track`, which finds an item by words of its name — never an id in the file: an id would be noise in every record and the agent would have to read it first.
- **Where a decision lives:** on the board only if it outlives any one task, otherwise in the task, and it goes to the archive with it. A decision may name what it turned down, `rejected: <option> — <why>`: a weighed option is not a dead end, which is something tried.
- **Archive:** `task_archive` moves the folder to `archive/<name>/`, adds its line to `archive/index.md`, takes it out of TASKS.md and points the links into the archive. Coming back to an archived topic is a new task with `continues`.

## OWNER.md, GLOSSARY.md, SHIFT.md

These come into every session whole, beside the system prompt, and again after each shift.

- **OWNER.md** — the owner's words in force for the whole project, as a code of rules: a newer word rewrites the older line, and a rule changes only on the owner's word. On the board they crowded out the work — the first migrated project had 31 such lines — and a line in AGENTS.md asking to read them was only text.
- **GLOSSARY.md** — one article per term: `## <term>`, then `Variants`, `Means` (what it is, not what it does), `Avoid` (words not to use for it, so one thing has one name), `Where`, and `Unconfirmed` while an inferred meaning is not checked with the owner. The format follows a glossary kept as a model prompt in another project, with `Avoid` from a domain-modeling practice.
- **SHIFT.md** — how the project keeps its knowledge, on the owner's word, and the map of its documents the mod writes between its markers. It comes from a project where a script wrote such a map into AGENTS.md; there the map grew to two thirds of a 72 KB AGENTS.md. The mod rebuilds the map at a session's start, at a shift and after a write of a document, keeps a toc in each when asked, and speaks after an Edit or Write only when something is wrong.

A `> [!IMPORTANT]` block in a mapped document is pinned: the map shows it under the document with its section in every session — for the few lines an agent must always have in front of it without opening the document. GitHub draws the same quote as a highlighted note, so a person reading the document sees the line as important too. Pins are optional, and nothing is pinned until the agent pins it; past `[docs] max_pinned` the map, the report after a shift and the note after a write say so, and never refuse.

## Knowledge and where it goes

`knowledge/<kind>[-<topic>].md` holds what the agent learned that stays true for months and is neither a decision, a dead end nor a task: kinds `traps`, `lessons`, `runbook`, `facts`, each entry with its kind's fields. Only its map comes back after a shift; files are read on demand.

Whether knowledge goes into the project's own docs or stays local is the owner's choice per project — `knowledge = "local" | "project" | "split"`, a split's boundary a rule in OWNER.md; until the owner said, it stays local: the agent does not write a project's shared files on its own guess.

## Settings

`settings.toml` is the owner's, optional, a flat subset of TOML. A missing file or key is the default; an unknown key or a bad value is named, leaves the mod on and refuses a shift until fixed — a typo must not switch the mod off silently. `shift_setup` lists every key with its value here, its default and the version it came in; the keys themselves are rows of `SETTING_KEYS`.

`.shift/` is the agent's own, with no git of its own. Whether the project's git takes it in is the owner's choice (`commit`); by default the mod adds it to the repository's local exclude file.

## Shift folders and about.md

Every accepted shift gets `shifts/<UTC stamp>/`: the letter, a snapshot of the records, `summary.md` (what the harness kept after the let-go) and `about.md` — the shift in brief with a strict structure: a frontmatter (`description`, `at`, `after`, `result`, `tokens`, `summary_chars`, `session`) and the sections "Done", "Dropped", "Archived", "Open", derived from the files against the previous snapshot. `about.ts` writes it and reads it back for `shift_history`, the recent shifts after a shift, and the base of the hint count after a restart.

## What the mod refuses

A shift is refused on: no letter or a letter section missing or empty; a missing section or a line limit passed in any record; a date anywhere; an unknown status; TASKS.md and the task folders out of step, a link to nothing, tasks needing each other in a circle; a knowledge file of no kind or without its entry fields; a broken `settings.toml`; `.shift/` not kept out of git when it should be; nothing changed since the last shift. A refusal names what to fix; the full list is in `shift_guide`.

The mod also looks at the records around every tool the agent runs, by each file's time and size from one listing per folder — no file is read unless it changed. A change made while the agent's tool ran is the agent's own: it is checked by the checks of that file alone and told once in that tool's result only when broken. A change made between its tools — the owner's hand, another session — is named in the next result, broken or not, so the agent reads it before writing over it. While another tool runs, a change is not attributed: it may be that tool's. The mod's own tools are only remembered. A record written by hand used to break silently and surface only at the shift, hundreds of K later. Checks across files stay the shift's alone — another record broken, nothing changed — so a record half written in two steps is told once, not refused.
