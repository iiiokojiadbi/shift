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
  - Claude Code
  - npm: pi and opencode
<!-- /toc -->

## Tooling

Bun runs everything; `bun install` also installs the git hooks (lefthook). Biome lints and formats; its findings are fixed, never silenced. TypeScript is checked per package: the core, the core's tests, the Claude Code plugin, the npm package for pi and opencode and its test.

## Commands

| Command | What it does |
|---|---|
| `bun run sync-core` | copies `core/src/` into each adapter's `core/`, and `core/test/data.ts` into the Claude Code plugin's `tests/`; run after every change in `core/src/`, and again after `bun run fix` touched it; `--check` fails on a stale copy on disk, `--staged` on one in git's index — what the commit takes — and a source folder that cannot be read, or a missing `core/test/data.ts`, stops it rather than empty the copies |
| `bun run check` | fails on a stale core copy, then biome |
| `bun run fix` | biome with fixes |
| `bun run typecheck` | `tsc` over every package: `types:core`, `types:claude-code`, `types:npm` |
| `bun run test` | every package's tests: `test:core`, `test:npm` (`bun test`), `test:claude-code` (`claude plugin test`) |
| `bun run validate` | `claude plugin validate` of the Claude Code plugin: the hooks module and its state contract |

The pre-commit hook runs, by the files staged, the same scripts per package — a command is written once, in `package.json`: the copy check against the index (`sync-core --staged`: a source staged without its copies fails), biome (it stages its own fixes), the core's types and tests, the plugin's validation, types and tests, the npm package's types and tests. Each job prints one line when it passes and its whole output when it fails.

## Tests

- **Core** — `core/test/*.test.ts` over `memory.ts` (`memoryStore`, `memoryProject` — a project over an in-memory store with a git that answers `check-ignore` and `rev-parse`) and `fixtures.ts`: the records' data — the letter, the board, task.md, the track, OWNER.md, traps, one copy each — lives in `data.ts`, with no imports, so the plugin's tests take a generated copy of it; `fixtures.ts` adds what needs the core (`WORK`, `check`). Test a behaviour through the module's interface, not past it.
- **Claude Code** — `adapters/claude-code/tests/shift.test.ts`, the wiring only, over `tests/data.ts` — GENERATED from `core/test/data.ts`, never edit. `stubSession` fakes `$.fs`, `$.process`, the session and the UI over a map; `on('session.id')` may be registered once per test, so a test that changes the session passes it as the last argument.
- **pi** — `adapters/npm/test/pi.test.ts`: the extension loaded over a stand-in of `ExtensionAPI` in a temporary project. opencode's entry has no test of its own yet: it is checked live.

## Installing for development

- Claude Code from the catalog: `claude plugin marketplace add iiiokojiadbi/claude-plugins`, then `claude plugin install shift@iiiokojiadbi`.
- Claude Code in place: `claude plugin marketplace add <path to this repo>` and `claude plugin install shift@shift`; edits apply on `/reload-plugins`. Do not have both installed at once.
- pi from npm: `pi install npm:@iiiokojiadbi/shift`.
- pi in place: `pi -e ./adapters/npm` for one run, or `pi install ./adapters/npm`. Not beside the npm package: the tools conflict.
- opencode from npm: `opencode plugin add @iiiokojiadbi/shift` (it writes `plugins` in `~/.config/opencode/opencode.json`).
- opencode in place: link `adapters/npm` into `~/.config/opencode/plugins/` or a project's `.opencode/plugins/`; a folder loads its `server.ts`. Not beside the npm entry. A tarball from `npm pack` loads as `"file:<path>.tgz"` in `plugins`; `plugin add` takes only the registry or git.

## Release

Users get only tagged releases; `main` may be unfinished. The Claude Code plugin and the npm package share one version: the package is released with the number of the Claude Code release whose core it carries, and its gate refuses another.

### Claude Code

1. Bump `version` in `adapters/claude-code/.claude-plugin/plugin.json`, commit, `git push`.
2. `claude plugin tag adapters/claude-code --push` — the tag is `shift--v<version>`.
3. In the catalog repo `iiiokojiadbi/claude-plugins`, set the entry's `ref` in `.claude-plugin/marketplace.json` to that tag, commit, push.
4. `claude plugin marketplace update iiiokojiadbi`, then `claude plugin update shift@iiiokojiadbi`; a restart applies it.

A release that changes what the model or the owner sees is checked live after the restart.

### npm: pi and opencode

The package `@iiiokojiadbi/shift` is `adapters/npm`, one for both harnesses, published to npm from this machine with the owner's npm login; nothing publishes from CI. A published version cannot be reused, so the gate does everything but upload unless told to.

1. After a Claude Code release, when the package or the core changed since its last release: set `version` in `adapters/npm/package.json` to the plugin's, commit, `git push`.
2. `bun run release:npm` — the dry run: the checks, the tarball file by file against what may ship (both entries, the store, every module of the core copy, the README, the license) and its size, and whether the version is free: it is not in the package's `versions`, or npm's `E404` says there is no package yet.
3. With the owner's word: `bun run release:npm --publish`, with `--otp <code>` when the account asks for one. It refuses an uncommitted tree or a HEAD not on `origin/main`, publishes with `--access public`, waits up to five minutes for `latest` to show the version — a 404 right after the upload is the registry catching up, never a reason to publish again — and pushes the tag `shift-npm--v<version>` (`shift-pi--v<version>` up to 0.30.0) on the commit it checked; a tree changed while it checked — another HEAD, uncommitted changes — stops it before the upload, since npm packs the folder as it is. A run that uploaded and stopped before its tag is finished by running it again: the version found in the registry without its tag on `origin`, it tags the commit npm recorded (`gitHead`), moving a local tag a failed push left, and stops.
4. `pi update npm:@iiiokojiadbi/shift` and `opencode plugin update`, or the first install; the owner restarts both. opencode asks its running server, which checks npm itself and may answer "No plugin updates available" for a few minutes after the upload — `opencode plugin check` shows when it sees the version. The update installs a new generation under opencode's npm cache; the server loads it only when it starts again, so `opencode plugin list` shows the old version until then.
