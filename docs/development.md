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
| `bun run sync-core` | embeds the upgrade guide, copies `core/src/` into the Claude Code and npm packages, and copies `data.ts` and `archive-fixture.ts` into the Claude Code tests. `--check` reads the working tree. `--staged` checks the Git index |
| `bun run shift:sizes [project]` | counts session and continuation text with o200k_base locally and lists the last three saved letters separately. Reports paths and token counts only |
| `bun run check` | checks generated core copies, the bundled Codex runtime and Biome |
| `bun run build:codex` | builds `adapters/codex/plugin/runtime.js` from the Codex adapter, shared store and core |
| `bun run fix` | biome with fixes |
| `bun run typecheck` | `tsc` over every package: `types:core`, `types:claude-code`, `types:npm`, `types:codex` |
| `bun run test` | native runtime race tests (`test:beads`), core tests (`test:core`), and the npm, Claude Code and Codex adapter suites (`test:npm`, `test:claude-code`, `test:codex`) |
| `bun run validate` | `claude plugin validate` of the Claude Code plugin: the hooks module and its state contract |

For the [storage acceptance checks](beads-roadmap.md#acceptance-checks), download the target archive from the [Beads 1.3.4 release](https://github.com/gastownhall/beads/releases/tag/v1.3.4). On a POSIX build host, run `bun run beads:stage <release-archive> <output-root>`. It checks the pinned SHA-256, unpacks the full release with tar or unzip, and prints the executable path under `<output-root>/1.3.4/<platform_arch>/`. A retry verifies and reuses matching contents.

Run `bun run beads:check <staged-bd>` on a compatible POSIX host. It starts independent writers against an embedded database in a disposable Git project, reopens it and checks that the neighboring tracker retains its original issue. For distribution, run `bun run beads:bundle <assets-directory>` inside the release checkout with Go installed. Supply the pinned archives for Linux and macOS (amd64 and arm64) and Windows amd64. Commit both marketplace vendor directories with the version bump when the binaries change. Their launchers carry the complete compressed upstream release. `beads-packages/<target>/` holds an npm variant with the same executable. Each variant uses the name `@iiiokojiadbi/shift` and a version such as `0.41.1-linux-x64`.

The installed launcher extracts into the user's cache and verifies the executable on first use and reuse. Task operations run with a private profile and embedded database below `.shift/beads/`; a redirected private workspace is refused. The Linux amd64 artifact requires glibc 2.34. On Windows the database needs a local filesystem that supports file locks. Check a POSIX npm install with `bun scripts/check-installed-beads.ts <installed-shift-package>`. This exercises real task writes, transfer of both databases, retained letters, wait recovery, and isolation from unrelated project files. For native storage changes, `bun run test:beads` runs the Go race tests in a disposable build directory. `shift_setup(section="runtime")` checks only the installed executable version.

`bun run sync-core` also embeds the [project upgrade instructions](records.md#upgrading-an-existing-project) in `shift_guide(section="migration")`. Update that chapter with changes to upgrade behavior, sync it and rebuild the Codex runtime. The copy checks cover the Markdown source and the generated text.

The pre-commit hook runs, by the files staged, the same scripts per package — a command is written once, in `package.json`: the copy check against the index (`sync-core --staged`: a source staged without its copies fails), biome (it stages its own fixes), the core's types and tests, the plugin's validation, types and tests, the npm package's types and tests. Each job prints one line when it passes and its whole output when it fails.

## Tests

- **Core** — `core/test/*.test.ts` uses the in-memory store in `memory.ts` and records from `data.ts` and `fixtures.ts`. `archive-fixture.ts` stands in for the native archive. Test behavior through the module's interface.
- **Claude Code** — `adapters/claude-code/tests/shift.test.ts`, the wiring only, over `tests/data.ts` — GENERATED from `core/test/data.ts`, never edit. `stubSession` fakes `$.fs`, `$.process`, the session and the UI over a map; `on('session.id')` may be registered once per test, so a test that changes the session passes it as the last argument.
- **pi and opencode** — `adapters/npm/test/` covers both adapters, the shared file store and native working records. For real files use `scratch()` and `afterAll(cleanup)` from `adapters/npm/test/scratch.ts`.

- **Codex** — `bun run test:codex` starts an isolated installed CLI with a loopback fixture model. It checks the actual model inputs, the wait and continue transitions, owner input arriving during a shift and the stored digest. The resume test starts separate CLI processes and compares the saved input prefix, instructions, tools and cache key across both reattachments. The integration cases skip when the CLI is absent.

## Installing for development

- Codex from this checkout requires Bun and Codex CLI. In the project to work on, run `bun /path/to/shift/adapters/codex/index.ts`. Inside this repository, `bun run shift:codex` does the same. For a JSON-RPC client, pass `--stdio` as the first argument and negotiate the experimental API. To install the marketplace plugin from this checkout, first build the native bundle for the current platform and run `bun run build:codex`. Then use `codex plugin marketplace add .` and `codex plugin add shift@shift`.

For the source launcher, build the current platform in this checkout and link its runtime under the matching alias before using database-backed records, shift history or the project-local task command. All three use the native executable. Only task commands open the Beads workspace. For example, on Linux x64:

```sh
bun run beads:bundle /path/to/release-assets linux_amd64
mkdir -p adapters/npm/node_modules/@iiiokojiadbi
ln -s "$(pwd)/beads-packages/linux_amd64" adapters/npm/node_modules/@iiiokojiadbi/shift-runtime-linux-x64
```

The link can stay in place across rebuilds. Use the corresponding bundle and npm platform name on other systems. Published npm installs resolve this dependency automatically.

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
2. Run `bun run release:npm` for a dry run. The gate checks the tarballs, verifies the binaries match the marketplace copies, reports the sizes and checks whether the main version is free. Its optional dependencies use npm aliases to pin one version per platform of the same public package. npm uses each variant's `os` and `cpu` fields to choose the build.
3. With the owner's word, run `bun run release:npm --publish`. Pass `--otp <code>` when the account asks for one. The gate requires a clean commit on `origin/main`. It uploads missing variants under the platform tags, such as `linux-x64`, and verifies their registry integrity before publishing the stable version under `latest`. It waits up to ten minutes for each stage. If npm accepted an upload and the wait expired, check availability before retrying. The gate pushes `shift-npm--v<version>` for the checked commit. On a retry after the main version appears, it recovers the tag from the published `gitHead`.
4. `pi update npm:@iiiokojiadbi/shift` and `opencode plugin update`, or the first install; the owner restarts both. opencode asks its running server, which checks npm itself and may answer "No plugin updates available" for a few minutes after the upload — `opencode plugin check` shows when it sees the version. The update installs a new generation under opencode's npm cache; the server loads it only when it starts again, so `opencode plugin list` shows the old version until then.

### Codex marketplace

The repository itself is the marketplace. Its index in `.agents/plugins/marketplace.json` selects `adapters/codex/plugin/`. That directory ships the manifest, picker skills, hooks, MCP declaration, license and standalone Bun entry. Each marketplace version gets a matching manifest version, changelog entry and `shift-codex--v<version>` tag. Build the runtime, run the repository checks and verify the tagged Git source in a clean profile before announcing the release. Push the marketplace tag on the same release commit as the npm and catalog tags. Publish the shared GitHub release under `shift--v<version>`.

After verifying the tagged Git source, advance the stable marketplace branch to the verified release with `git push origin refs/tags/shift-codex--v<version>:refs/heads/codex-stable`. Use a fast-forward push. The branch tracks published releases and stays at the last release while work continues on main.

Update the local Codex installation between runs. A running client can retain hook paths into the previous plugin version, which Codex prunes during installation. Close clients using Shift before running `codex plugin marketplace upgrade shift` in a separate shell. The README covers the one-time migration from a pinned tag. Reopen the thread with `codex resume` and review any modified hooks in `/hooks`.
