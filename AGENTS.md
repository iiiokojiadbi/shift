---
description: The project's map and the rules for every change: what shift is, where the documentation is and how it is kept, the tree of the repo, the rules of working on it. Read first.
---

# shift

<!-- toc -->
- Documentation
- Tree
- Rules for every change
<!-- /toc -->

An agent decides by itself when to **shift**: at a stage boundary it updates its board, writes a letter to itself, and asks the harness to let the stretch's history go with a direction of what to hold. Right after the shift it gets its letter and board back and continues from where it stopped. The agent does not change — only what is in front of it does.

Long work outlives the context window. Shift keeps project records, a letter with the next step and an independent archive of recent shifts. The optional Beads task graph serves work that needs its own status, dependencies or discussion.

Harnesses: Claude Code (first, done as a mod), pi (an extension) and opencode (a plugin), the last two from one npm package. Codex uses an installable marketplace plugin with session hooks and MCP tools over its local app server.

## Documentation

The documents live in `docs/` and this file; the mod keeps them — a toc in each, remarks after a run — and maps them, with their descriptions and sections, into the session block through `.shift/SHIFT.md`, so they are in front of you in every session. Open a document for the details; the map only points.

- `docs/concept.md` — the idea, the loop, how the model sees it, open questions;
- `docs/records.md` — what the agent keeps in `.shift/` and why;
- [Task storage and shift history roadmap](docs/beads-roadmap.md) — the project command, independent shift history and compatibility checks. Open before changing either storage path.
- `docs/hints.md` — when the mod hints a shift, the gauge;
- `docs/architecture.md` — the core's modules, the ports, where a change goes;
- `docs/adapters.md` — each harness's slots and the facts about it;
- `docs/development.md` — commands, tests, installing, the release;
- `docs/research.md` — what the design stands on from outside;
- `docs/archive/` — superseded design notes, kept for reasoning.

Keep it yourself, as part of the work, not on request: a change to how the mod works, its interfaces, a harness's behaviour or the release goes into its document in the same commit; choose the document by the behavior that changed, then use `docs_mentioning` to find further references by filename. Only the important parts — what a reader could not see from the code and would get wrong without: design, interfaces, reasons, traps, procedures. No dates, no history, no changelog — that is what git and `.shift/` are for; a fact lives in one place, and a document links to another instead of repeating it. A new document gets a `description:` that says what is in it and when to open it.

## Tree

```
core/                      shared logic, pure TypeScript, no harness imports — docs/architecture.md
  src/project.ts           loadProject: the store, the root and the parsed settings, once per hook or tool call
  src/working.ts, editing.ts   current Markdown records, revisions and editing tools
  src/store.ts             the storage port, current records and retained shifts
  src/layout.ts            record names and paths, sections, limits and atPlaces
  src/tools.ts             the tool table and what a session starts with
  src/loop.ts              the shift loop over a port: hold, let go, continue or wait, the owner's message
  src/hint.ts              when to hint, the gauge over a port, shift_status
  src/delivery.ts          every note to the agent: the two slots, a tool's result and the next prompt, and the owner's rows
  src/flows.ts             accepting a shift, archiving, history, resume, settling, the session's files, the records changed around a tool
  src/saved.ts             history and working-record operations over the bundled runtime
  src/about.ts             about.md: written and read back by one module
  src/markdown.ts          the one markdown reader: headings outside fences, sections, items, checks
  src/paths.ts             paths: dirname, basename, join, normalize, from and to the root, inside the project
  src/records.ts glossary.ts  checks of current project records
  src/settings.ts          settings.toml: a row per key
  src/docs.ts, map.ts      documentation maps, observations, tocs, remarks, outlines and mentions
  src/input.ts             tool arguments
  src/history.ts           shift_history entries and the saved digest
  src/types.ts             data shapes
  src/texts/               doctrine, guide, tools, prompts and rows; upgrade-guide.ts is generated from docs/records.md
  src/index.ts             re-exports everything
  test/                    bun test of all core logic over an in-memory store; data.ts and fixtures.ts
adapters/
  codex/                   marketplace plugin, native hooks and MCP server, source launcher and protocol tests — docs/adapters.md
  claude-code/             the Claude Code plugin (a mod) — docs/adapters.md
    .claude-plugin/        plugin.json; types/ is generated by Claude Code and not committed
    hooks/register.ts      wiring: the table's tools, the command and the hooks
    hooks/{state,disk,hint,handover}.ts   constants, the store, the gauge port, the loop port and the let-go
    hooks/core/            GENERATED copy of core/src — never edit
    types/index.d.ts       the plugin's state contract
    tests/                 claude plugin test of the wiring only; data.ts GENERATED from core/test/data.ts
  npm/                     the npm package @iiiokojiadbi/shift, one for pi and opencode — docs/adapters.md
    index.ts               pi's extension (pi 1.4.0 ExtensionAPI): the table's tools, the events, the ports
    server.ts              opencode's server plugin (opencode 2.1.4 @opencode/plugin, types only): the tools, the hooks, the commands, the events
    store.ts               the store over node, for both
    package.json README.md published by scripts/release-npm.ts
    core/                  GENERATED copy of core/src — never edit
    test/                  bun test of pi's entry over a stand-in of pi's API
runtime/beads/             Go launcher, isolated Beads workspace and the independent bbolt archive
.agents/plugins/marketplace.json   Codex marketplace
.claude-plugin/marketplace.json   local Claude Code marketplace for development
scripts/sync-core.ts       embeds the upgrade guide and copies the core and shared test fixtures
scripts/release-npm.ts     the npm package's release gate: checks and the tarball; --publish uploads, verifies and tags
docs/                      the documentation, above
README.md                  for people: what shift is, installing, commands, tools, settings
CHANGELOG.md               for people: what changed in each release, one entry per version
lefthook.yml  biome.json  package.json  LICENSE
```

This project keeps current Markdown records and saved shifts in `.shift/history.db`. Its optional task tracker has a separate workspace under `.shift/beads/`. The local `.shift/` directory is never committed.

## Rules for every change

- Include the `Co-authored-by: Codex <noreply@openai.com>` trailer in every commit in this repository.
- Edit shared logic only in `core/src/`, then `bun run sync-core`; run it again after `bun run fix` touched `core/src/`.
- Before a commit: `bun run check`, `bun run typecheck`, `bun run test`; `bun run validate` when the Claude Code plugin changed. Lint findings are fixed, never silenced.
- A behaviour two adapters would do the same way goes into the core over a port; an adapter keeps only wiring, where its state lives, measurement, the let-go call and delivery.
- A flow takes the loaded `Project`, never a store and a root: an adapter loads it once per hook or tool call (`projectOf($)`, `projectAt(cwd)`).
- A text the model reads interpolates the constant its check uses, and says only "shift" — never "compression", "summary" or "compaction" (`docs/concept.md`).
- Everything the agent reads — code, docs, prompts, tool descriptions, records — is in English.
- A release follows `docs/development.md`; users get only tagged releases.
- Temporary files of the work — scripts, logs, probe projects, a reviewer's checks — go under `/tmp/shift/`, never loose in `/tmp`; tests remove their own (`docs/development.md`, Tests).
