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
  - Codex marketplace
<!-- /toc -->

## Tooling

Bun runs everything; `bun install` also installs the git hooks (lefthook). Biome lints and formats; its findings are fixed, never silenced. TypeScript is checked per package: the core, the core's tests, the Claude Code plugin, the npm package for pi and opencode and its test, and the Codex adapter.

## Commands

| Command | What it does |
|---|---|
| `bun run sync-core` | copies `core/src/` into the two packaged adapters, and `core/test/data.ts` into the Claude Code plugin's `tests/`; run after every change in `core/src/`, and again after `bun run fix` touched it; `--check` fails on a stale copy on disk, `--staged` on one in git's index — what the commit takes — and a source folder that cannot be read, or a missing `core/test/data.ts`, stops it rather than empty the copies |
| `bun run shift:sizes [project]` | counts session and continuation text with o200k_base locally and lists the last three saved letters separately. Reports paths and token counts only |
| `bun run check` | fails on a stale core copy, then biome |
| `bun run fix` | biome with fixes |
| `bun run typecheck` | `tsc` over every package: `types:core`, `types:claude-code`, `types:npm`, `types:codex` |
| `bun run test` | every package's tests: `test:codex`, `test:core`, `test:npm` (`bun test`), `test:claude-code` (`claude plugin test`) |
| `bun run validate` | `claude plugin validate` of the Claude Code plugin: the hooks module and its state contract |

For the first [storage roadmap](beads-roadmap.md) check, download the target archive from the [Beads 1.3.4 release](https://github.com/gastownhall/beads/releases/tag/v1.3.4). On a POSIX build host, run `bun run beads:stage <release-archive> <output-root>`. It checks the pinned SHA-256, unpacks the full release with tar or unzip, and prints the executable path under `<output-root>/1.3.4/<platform_arch>/`. Repeating the command verifies and reuses the published contents. A different nonempty payload at that location fails the build.

Run `bun run beads:check <staged-bd>` on a compatible POSIX host. It starts independent writers against an embedded database in a disposable Git project, reopens it and checks that the neighboring tracker retains its original issue. For distribution, run `bun run beads:bundle <assets-directory>` inside the release checkout with Go installed. Supply the pinned archives for Linux and macOS (amd64 and arm64) and Windows amd64. Commit both marketplace vendor directories with the version bump. Their launchers carry the complete compressed upstream release. The generated `beads-packages/` directories supply the five npm optional packages. Pin each optional dependency to the main package version. The release gate checks their binaries against both marketplace copies, verifies existing registry integrity and uploads required platform packages before publishing the parent. An interrupted upload can be retried from the same checkout.

The installed launcher extracts into the user's cache and verifies the executable on first use and reuse. Task operations run with a private profile and embedded database below `.shift/beads/`; a redirected private workspace is refused. The Linux amd64 artifact requires glibc 2.34. On Windows the database needs a local filesystem that supports file locks. Check a POSIX npm install with `bun scripts/check-installed-beads.ts <installed-shift-package>`. This exercises actual task writes and reopening. `shift_setup(section="runtime")` checks only the installed executable version.

The pre-commit hook runs, by the files staged, the same scripts per package — a command is written once, in `package.json`: the copy check against the index (`sync-core --staged`: a source staged without its copies fails), biome (it stages its own fixes), the core's types and tests, the plugin's validation, types and tests, the npm package's types and tests. Each job prints one line when it passes and its whole output when it fails.

## Tests

- **Core** — `core/test/*.test.ts` over `memory.ts` (`memoryStore`, `memoryProject` — a project over an in-memory store with a git that answers `check-ignore` and `rev-parse`) and `fixtures.ts`: the records' data — the letter, the board, task.md, the track, OWNER.md, traps, one copy each — lives in `data.ts`, with no imports, so the plugin's tests take a generated copy of it; `fixtures.ts` adds what needs the core (`WORK`, `check`). Test a behaviour through the module's interface, not past it.
- **Claude Code** — `adapters/claude-code/tests/shift.test.ts`, the wiring only, over `tests/data.ts` — GENERATED from `core/test/data.ts`, never edit. `stubSession` fakes `$.fs`, `$.process`, the session and the UI over a map; `on('session.id')` may be registered once per test, so a test that changes the session passes it as the last argument.
- **pi** — `adapters/npm/test/pi.test.ts`: the extension loaded over a stand-in of `ExtensionAPI` in a temporary project. A test that needs real files takes its folder from `scratch()` in `adapters/npm/test/scratch.ts` — under `shift/tests/` in the system's temporary folder — and the file's `afterAll(cleanup)` removes them; a bare `mkdtemp` in `/tmp` was left behind by every run. The opencode hook test shares a scratch project across two session IDs, reloads the plugin over its saved storage and exercises a compaction. Both adapter tests check the stable system block alongside the appended changes.

- **Codex** — `bun run test:codex` starts an isolated installed CLI with a loopback fixture model. It checks the actual model inputs, the wait and continue transitions, owner input arriving during a shift and the stored digest. The resume test starts separate CLI processes and compares the saved input prefix, instructions, tools and cache key across both reattachments. The integration cases skip when the CLI is absent.

## Installing for development

- Codex from this checkout requires Bun and Codex CLI (tested with 0.170.0). In the project to work on, run `bun /path/to/shift/adapters/codex/index.ts`. Inside this repository, `bun run shift:codex` does the same. For a JSON-RPC client, pass `--stdio` as the first argument and negotiate the experimental API. For a marketplace installation from this checkout, use `codex plugin marketplace add .` followed by `codex plugin add shift@shift`. Build the installed runtime with `bun run build:codex` after changing its source. The ordinary `check` command verifies its contents.

- Claude Code from the catalog: `claude plugin marketplace add iiiokojiadbi/claude-plugins`, then `claude plugin install shift@iiiokojiadbi`.
- Claude Code in place: `claude plugin marketplace add <path to this repo>` and `claude plugin install shift@shift`; edits apply on `/reload-plugins`. Do not have both installed at once.
- pi from npm: `pi install npm:@iiiokojiadbi/shift`.
- pi in place: `pi -e ./adapters/npm` for one run, or `pi install ./adapters/npm`. Not beside the npm package: the tools conflict.
- opencode from npm: `opencode plugin add @iiiokojiadbi/shift` (it writes `plugins` in `~/.config/opencode/opencode.json`).
- opencode in place: link `adapters/npm` into `~/.config/opencode/plugins/` or a project's `.opencode/plugins/`; a folder loads its `server.ts`. Not beside the npm entry. A tarball from `npm pack` loads as `"file:<path>.tgz"` in `plugins`; `plugin add` takes only the registry or git.

## Release

Users get only tagged releases; `main` may be unfinished. The two plugin manifests and the npm package share one version. Bump all three together and run `bun run build:codex` before committing. The npm release gate checks all three manifests.

Every release has an entry in `CHANGELOG.md`, newest first: one entry per released version, covering every commit since the last release — fixes may land as several commits, the entry tells them together, for people, by what changed for them (Added, Changed, Fixed). It is written and committed with the version bump, before the tags; once all three distribution channels are verified, `gh release create shift--v<version> --title <version> --notes-file <the entry>` publishes it on GitHub.

### Claude Code

1. Commit the shared version bump and changelog, then push the release commit to `origin/main`.
2. `claude plugin tag adapters/claude-code --push` — the tag is `shift--v<version>`.
3. In the catalog repo `iiiokojiadbi/claude-plugins`, set the entry's `ref` in `.claude-plugin/marketplace.json` to that tag, commit, push.
4. `claude plugin marketplace update iiiokojiadbi`, then `claude plugin update shift@iiiokojiadbi`; a restart applies it.

A release that changes what the model or the owner sees is checked live after the restart.

### npm: pi and opencode

The package `@iiiokojiadbi/shift` is `adapters/npm`, one for both harnesses, published to npm from this machine with the owner's npm login; nothing publishes from CI. A published version cannot be reused, so the gate does everything but upload unless told to.

1. Release from the same clean commit on `origin/main` as the marketplace tags.
2. `bun run release:npm` — the dry run: the checks, the tarball file by file against what may ship (both entries, the store, every module of the core copy, the README, the license) and its size, and whether the version is free: it is not in the package's `versions`, or npm's `E404` says there is no package yet.
3. With the owner's word: `bun run release:npm --publish`, with `--otp <code>` when the account asks for one. It refuses an uncommitted tree or a HEAD not on `origin/main`, publishes with `--access public`, waits up to five minutes for `latest` to show the version — a 404 right after the upload is the registry catching up, never a reason to publish again — and pushes the tag `shift-npm--v<version>` (`shift-pi--v<version>` up to 0.30.0) on the commit it checked; a tree changed while it checked — another HEAD, uncommitted changes — stops it before the upload, since npm packs the folder as it is. A run that uploaded and stopped before its tag is finished by running it again: the version found in the registry without its tag on `origin`, it tags the commit npm recorded (`gitHead`), moving a local tag a failed push left, and stops.
4. `pi update npm:@iiiokojiadbi/shift` and `opencode plugin update`, or the first install; the owner restarts both. opencode asks its running server, which checks npm itself and may answer "No plugin updates available" for a few minutes after the upload — `opencode plugin check` shows when it sees the version. The update installs a new generation under opencode's npm cache; the server loads it only when it starts again, so `opencode plugin list` shows the old version until then.

### Codex marketplace

The repository itself is the marketplace. Its index in `.agents/plugins/marketplace.json` selects `adapters/codex/plugin/`. That directory ships the manifest, picker skills, hooks, MCP declaration, license and standalone Bun entry. Each marketplace version gets a matching manifest version, changelog entry and `shift-codex--v<version>` tag. Build the runtime, run the repository checks and verify the tagged Git source in a clean profile before announcing the release. Push the marketplace tag on the same release commit as the npm and catalog tags. Publish the shared GitHub release under `shift--v<version>`.

After verifying the tagged Git source, advance the stable marketplace branch to the verified release with `git push origin refs/tags/shift-codex--v<version>:refs/heads/codex-stable`. Use a fast-forward push. The branch tracks published releases and stays at the last release while work continues on main.

Update the local Codex installation between runs. A running client can retain hook paths into the previous plugin version, which Codex prunes during installation. Close clients using Shift before running `codex plugin marketplace upgrade shift` in a separate shell. The README covers the one-time migration from a pinned tag. Reopen the thread with `codex resume` and review any modified hooks in `/hooks`.
