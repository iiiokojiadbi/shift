---
description: Working on the repo: tooling, the commands and what each checks, the generated core copies, tests, installing for development, and the release procedure step by step. Before a commit or a release.
---

# shift: development

<!-- toc -->
- Tooling
- Commands
- Tests
- Installing for development
- Release
<!-- /toc -->

## Tooling

Bun runs everything; `bun install` also installs the git hooks (lefthook). Biome lints and formats; its findings are fixed, never silenced. TypeScript is checked per package: the core, the core's tests, the Claude Code plugin, the pi extension and its test.

## Commands

| Command | What it does |
|---|---|
| `bun run sync-core` | copies `core/src/` into each adapter's `core/`, and `core/test/data.ts` into the Claude Code plugin's `tests/`; run after every change in `core/src/`, and again after `bun run fix` touched it |
| `bun run check` | fails on a stale core copy, then biome |
| `bun run fix` | biome with fixes |
| `bun run typecheck` | `tsc` over every package: `types:core`, `types:claude-code`, `types:pi` |
| `bun run test` | every package's tests: `test:core`, `test:pi` (`bun test`), `test:claude-code` (`claude plugin test`) |
| `bun run validate` | `claude plugin validate` of the Claude Code plugin: the hooks module and its state contract |

The pre-commit hook runs, by the files staged, the same scripts per package — a command is written once, in `package.json`: the copy check, biome (it stages its own fixes), the core's types and tests, the plugin's validation, types and tests, pi's types and tests. Each job prints one line when it passes and its whole output when it fails.

## Tests

- **Core** — `core/test/*.test.ts` over `memory.ts` (`memoryStore`, `memoryProject` — a project over an in-memory store with a git that answers `check-ignore` and `rev-parse`) and `fixtures.ts`: the records' data — the letter, the board, task.md, the track, OWNER.md, traps, one copy each — lives in `data.ts`, with no imports, so the plugin's tests take a generated copy of it; `fixtures.ts` adds what needs the core (`WORK`, `check`). Test a behaviour through the module's interface, not past it.
- **Claude Code** — `adapters/claude-code/tests/shift.test.ts`, the wiring only, over `tests/data.ts` — GENERATED from `core/test/data.ts`, never edit. `stubSession` fakes `$.fs`, `$.process`, the session and the UI over a map; `on('session.id')` may be registered once per test, so a test that changes the session passes it as the last argument.
- **pi** — `adapters/pi/test/extension.test.ts`: the extension loaded over a stand-in of `ExtensionAPI` in a temporary project.

## Installing for development

- Claude Code from the catalog: `claude plugin marketplace add iiiokojiadbi/claude-plugins`, then `claude plugin install shift@iiiokojiadbi`.
- Claude Code in place: `claude plugin marketplace add <path to this repo>` and `claude plugin install shift@shift`; edits apply on `/reload-plugins`. Do not have both installed at once.
- pi: `pi -e ./adapters/pi` for one run, or `pi install ./adapters/pi`.

## Release

Users get only tagged releases; `main` may be unfinished.

1. Bump `version` in `adapters/claude-code/.claude-plugin/plugin.json`, commit, `git push`.
2. `claude plugin tag adapters/claude-code --push` — the tag is `shift--v<version>`.
3. In the catalog repo `iiiokojiadbi/claude-plugins`, set the entry's `ref` in `.claude-plugin/marketplace.json` to that tag, commit, push.
4. `claude plugin marketplace update iiiokojiadbi`, then `claude plugin update shift@iiiokojiadbi`; a restart applies it.

A release that changes what the model or the owner sees is checked live after the restart.
