---
description: Where to find Shift's design and release procedures, where code belongs, and which checks to run for every change.
---

# Shift repository guide

<!-- toc -->
- Documentation
- Where changes go
- Checks and releases
<!-- /toc -->

Shift lets the main project agent continue from its own records and letter after starting a fresh stretch. The optional Beads tracker has its own workspace. Start with the [work loop](docs/concept.md) for product behavior and the [README](README.md) for installation.

## Documentation

Update the document that owns a changed interface, workflow, design decision or release procedure in the same commit. Read the implementation when guidance is stale, and use `docs_mentioning` to find other references by filename. Keep durable facts, reasons and traps in one place and link to them. Use Git and retained shifts for work history. Give each mapped document a frontmatter `description` that says when to open it. Shift refreshes the map in `.shift/SHIFT.md` so it can direct the next stretch to the right section.

| Working on | Read |
|---|---|
| The shift loop and agent-facing language | [Concept](docs/concept.md) |
| Records, settings, file placement and upgrades | [Records](docs/records.md) |
| Task and shift storage boundaries and acceptance cases | [Storage checks](docs/beads-roadmap.md) |
| Context measurement, thresholds and reminders | [Hints](docs/hints.md) |
| Shared modules, interfaces and ownership | [Architecture](docs/architecture.md) |
| Host-specific wiring, delivery and restart behavior | [Adapters](docs/adapters.md) |
| Build, tests, installation and distribution | [Development](docs/development.md) |
| Design evidence and superseded proposals | [Research](docs/research.md) and [archive](docs/archive/) |

This project keeps internal Markdown and saved shifts in `.shift/history.db`, task issues in `.shift/beads/` and reusable agent lessons in local knowledge. Keep `.shift/` out of Git.

## Where changes go

| Path | Responsibility |
|---|---|
| `core/src/` | Shared TypeScript behavior, storage ports and all agent-facing text in `texts/` |
| `core/test/` | Shared tests and the fixtures used by adapter tests |
| `adapters/codex/` | Marketplace plugin, hooks, MCP server and protocol tests |
| `adapters/claude-code/` | Plugin wiring, state contract and adapter tests |
| `adapters/npm/` | Shared npm package for pi and opencode, their wiring and file store |
| `runtime/beads/` | Native launcher, isolated task workspace and transactional record archive |
| `scripts/` | Core sync, runtime builds, packaging and release checks |

- Put behavior shared by adapters in the core over a port. Keep host wiring, state placement, measurement, the host call and delivery in the adapter.
- A flow takes the loaded `Project`. Load it once per hook or tool call using the adapter's project helper.
- Edit shared logic in `core/src/`, then run `bun run sync-core`. Regenerate after `bun run fix` touches the core. The [upgrade chapter](docs/records.md#upgrading-an-existing-project) generates the bundled guide.
- Write code, docs, prompts, tools and project records in English. Use “shift” in model-facing instructions and interpolate limits from the constants the validation uses.

## Checks and releases

- Run `bun run check`, `bun run typecheck` and `bun run test` before committing. Run `bun run validate` when `adapters/claude-code/` changes. Fix lint findings at their source.
- Put temporary files and reviewer probes under `/tmp/shift/`. Tests clean up their own files.
- Include the `Co-authored-by: Codex <noreply@openai.com>` trailer in commits.
- Follow the [release procedure](docs/development.md#release). The marketplace plugins and npm package share a version and a release commit. Users install tagged releases.
