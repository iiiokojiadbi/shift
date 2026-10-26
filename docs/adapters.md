---
description: Each harness's slots for the shift — Claude Code, pi, opencode — and the facts about them not obvious from the code: what loads, what survives a restart, how text reaches the model. Before touching an adapter or starting a new one.
---

# shift: adapters

<!-- toc -->
- Slots
- Claude Code
- pi
- opencode
<!-- /toc -->

An adapter fills the core's ports (`docs/architecture.md`) with what its harness offers. Marks: **[run]** built and run in the harness, **[types]** checked against the harness's types, **[code]** read in its sources, not run.

## Slots

| Slot | Claude Code (mod) | pi (extension, 1.4.0) | opencode (plugin, 2.1.4) |
|---|---|---|---|
| Measurement | `$.session.usage()`; the harness's own threshold from `usage({ breakdown: 'summary' })`, read once per window at the first reading, so a restarted process steps as the one before it; none when its auto let-go is off (`isAutoCompactEnabled`), and the window stands for it **[run]** | `ctx.getContextUsage()`; the threshold is the window less `reserveTokens` from `SettingsManager` **[run]** | the last step's `input + cache.read + cache.write` from `session.step.ended`; the window from `ctx.model.list()` for the session's model; the threshold its default, the window less max(15%, 16K), or `buffer` in the plugin's options **[run]** |
| Tools | `$.tool.register` in `session.start`, a `tool.call` hook per row **[run]** | `pi.registerTool` at load, `setActiveTools` per session **[run]** | `ctx.tool.transform(t => t.add(…))` with `options.codemode: false`, else the tool hides behind the code-mode tool **[run]** |
| Let-go with the Hold | `$.session.compact({ instructions })` after the turn; refused during one **[run]** | `ctx.compact({ customInstructions })` from `agent_settled`: it aborts whatever runs, so never from a tool **[run]** | `ctx.session.compact({ delivery: 'queue' })` once the run is over; the Hold is a system part pushed by `session.hook('compaction')`; done at `session.compaction.ended` **[run]** |
| `continue` | `$.prompt.submit({ text })` **[run]** | `pi.sendMessage({ customType, content }, { triggerTurn: true })`: a custom message, not the owner's **[run]** | `ctx.session.synthetic({ text, description })`: it wakes the session; no automatic continue exists in 2.x **[run]** |
| `wait` | `prompt.context` of the owner's next message **[run]** | the message returned from `before_agent_start` of the owner's run; pi places it after the owner's prompt **[run]** | `session.hook('prompt')` of the owner's message parks `synthetic({ resume: false })`, which the runner takes with that message, before it **[run]** |
| An unasked let-go | the `session.compact` hook on `trigger: 'auto'` adds the summarizer's instructions **[run]** | `session_compact` with a reason other than `manual` marks the stretch unassisted; `session_before_compact` can only replace the digest, not add instructions **[run]** | the same `compaction` hook, no reason on it: what is not the mod's gets the summarizer's instructions **[code]** |
| Notes to the agent | a `tool.call` wrapper puts `delivery.ts`'s notes into the result's `context` (or its `deny`); `prompt.submit` `context` between turns **[run]** | `tool_call`/`tool_result` add text blocks to the result; `before_agent_start` returns them as a message **[run]** | `tool.hook('execute.after')` replaces `result` with text blocks added; between turns a parked synthetic with the owner's message **[run]** |
| State | plugin atoms — live in the harness's memory **[run]** | variables; the waiting letter also in `pi.appendEntry`, so it follows a reload and a `/tree` branch **[run]** | closures per project, one plugin for all its sessions, keyed by session; the waiting letter also in `ctx.storage` **[code]** |

## Claude Code

The adapter is a mod: a hooks module in TypeScript, `adapters/claude-code/hooks/`.

> [!IMPORTANT]
> Each hooks file declares the state atoms it reads or writes — the engine's scan does not follow an atom through an import;
> `$` crosses files only into a function declaration (`function f($) {…}`), never into an arrow bound to a name.

- The module imports only relative files inside the plugin folder and `claude-code`.
- The loop's atoms (`pending`, `autoStreak`, `waitNote`) live in `handover.ts`; other files reach them through `loopOf($)`.
- `types/index.d.ts` must be self-contained: it mirrors `ShiftAfter`, `Gauge`, `PendingShift`, `Looks` and `WaitNote` from the core.
- Plugin state lives in the harness's memory: it survives a reload of the plugin's code, not a restart. What must outlive a restart is on disk or rebuilt from the history (the gauge's base from the last `about.md`). A pending shift kept from an older version may lack fields added since.
- A resume or a `/clear` inside a running Claude Code starts no `session.start` and resets the state: the switch (`enabled`), the doctrine and the session's files are read again when `$.session.id()` or `$.session.root()` differs from the ones they were read for. After a let-go the doctrine is read again with the files: the settings may have moved a record.
- A context entry past 100,000 characters reaches the model as a head and a path: a long note goes as several entries cut between lines. A prompt's notes count as gone only when the prompt was not dropped and its result carries them, or names no context at all.
- The mod's own tools refuse when their run throws — the mod's catch of `tool.call` answers for every hook of it and passes the call on. A tool interrupted while it ran (`next.signal`) lets a shift it held be settled as not made, so it never shifts a later turn.
- Hooks on one event chain in the order registered: a later one runs inside an earlier one, and a hook that answers without calling `next` hides every later one. The mod's own tools answer so; the records' look is registered before them, or their writes come back as someone else's.
- One `tool.call` wrapper without a matcher delivers every note mid-turn: `beforeTool` before `next`, `afterTool` after it (`readOnly` from `isReadOnly`, never for Agent or Task — what a subagent writes is that call's —, `own` for `mcp__shift__*`, `written` for an Edit or Write that did not fail), and a tool that threw is only counted down. A text block of its own inside a tool result row would show to the owner as their own message, so nothing is put into the row. A subagent's calls carry `agentId`: no look — its changes fall inside the main agent's Agent call — only its written file remembered for the docs. `turn.complete` clears the count of tools running, which a restart mid-tool would leave stuck.
- `session.append` only counts the growth.
- A command's `{ text }` is a transcript row with the plugin's name before its first line only, and it enters the model's history as a local command's output: `/shift-tasks` starts no turn but the agent reads it with the next one.
- A headless session (`claude -p`, the SDK) has no `$.session.compact`: it throws "not available in a headless session", so a shift there is told to the owner as not made and nothing is let go. Measure or try the shift in an interactive session.
- The `shift` tool argument is `after`, not `then`: an object with a `then` key looks like a promise.
- Rows go to the transcript by `$.ui.log`, which has no levels; the status line under the input is not used — it was noise.
- The owner is `prompt.submit` with `origin.kind` `composer`, `bridge` or `sdk`. A hook beneath may answer `{ drop }`: the notes are marked told only when the message entered, and a continue after a shift that is dropped counts as not started — its letter waits for the owner's next message.

## pi

The adapter is `index.ts` of the npm package `adapters/npm/`, over pi 1.4.0's `ExtensionAPI`; pi and typebox are peers the host supplies.

- pi refuses to let go of a history smaller than `keepRecentTokens` (20K by default) — "Nothing to compact (session too small)" — and keeps that much of the latest history beside the digest; a test project can lower it in `.pi/settings.json`. The adapter's `cannotLetGo` finds the same cut with pi's own `findCutPoint` over the branch since the last let-go — the fill counts the system prompt too and passes a history pi still refuses — so the `shift` tool refuses before anything is written instead of a shift accepted and then not made.
- `agent_settled` is awaited; a `sendMessage` with `triggerTurn` from it is deferred until the handler returns, so the continue still starts. pi's own let-go at its threshold may come before it, after the `shift` tool returned: `session_before_compact` cancels a `threshold` one while a shift is pending, so the shift lets go with its Hold.
- The owner's input comes by the `input` event, idle or mid-run (`streamingBehavior`); only an idle one starts a run that takes the waiting letter. Another extension may take the input without a run: an extension's own message (`sendUserMessage` comes by `input` with `source: 'extension'`) clears what the owner's left.
- The waiting letter lives on the branch: each change of it is a custom entry, and both `session_start` and `session_tree` (a move in the session's tree) take the note from the last entry on the branch the session stands on, so a letter of a branch left behind never goes with another. The entry that clears a letter is written before the message that carries it; a clearing with no message of the mod after it on the branch — that message rewound away — does not count. A move in the tree also counts the gauge anew from the branch.
- pi reads the session's files anew before every run, after the notes — a session's first run refreshes the docs' tocs and map first, later ones leave that to the notes, so a toc a script left stale is written with its note —, and the doctrine at the settings' places, so its block is never stale, and the prompt's cache holds: pi diffs the prompt's sections against the last system message and appends only a changed section as a system message after the history. A run after any record changed carries the whole `project_context` section again — `AGENTS.md` and the session's files together.
- The notes: `tool_call` → `beforeTool`, kept by `toolCallId`; `tool_result` → `afterTool` (`read`, `grep`, `find`, `ls` are read-only); a nested call (`parentToolCallId`) only has its written file remembered for the docs. `before_agent_start` → `atPrompt` with `runStarts`, which resets the count of tools running. A call another extension blocks gets no `tool_result`, only `tool_execution_end`, which counts it down.
- `--mode rpc` keeps the process alive for the let-go and the continue; print mode exits first. A headless `pi -p` in a fresh project waits silently unless run with `-a` and stdin closed.
- pi labels an extension in its `[Extensions]` list by its source: an npm package by its name, plus `:<dir>` when the entry is `<dir>/index.ts` and `:<file>` for any other name — so pi's entry is the package's root `index.ts` and the list shows `@iiiokojiadbi/shift`; a local path by the folder of its `index.ts` — `npm` in development.
- Distribution is npm, pi's own way: `pi install npm:@iiiokojiadbi/shift`, one package with opencode's entry. Host packages (`@earendil-works/pi-coding-agent`, `typebox`) are peers with `*`, never bundled, and optional so that opencode's install does not fetch them — pi installs packages with peers off anyway (`--legacy-peer-deps`, bun's `--omit=peer`) and hands an extension its own modules by aliases; the package ships the TypeScript as is, pi loads it. A git install would take the whole repo, with no subfolder. How to publish — `docs/development.md`.
- Try it: `pi -e ./adapters/npm` for one run, or `pi install ./adapters/npm` (loads in place). With the npm package also installed the tools conflict and the second fails to load: `pi -ne -e <dir>` loads only the one given.

## opencode

The adapter is `server.ts` of the npm package `adapters/npm/`, a server plugin over opencode 2.1.4's `@opencode/plugin`. 2.x is a rewrite: nothing of the 1.x plugin API (`tool.execute.before`, `experimental.session.compacting`, `client.session.summarize`) is there. The full read of its sources is in the task's notes, not here.

- A plugin is a folder or file in `plugin/` or `plugins/` of a config dir (the project's `.opencode/`, the global config dir) or a `plugins` entry of the config; its default export is `{ id, setup(ctx) }`. It runs inside the server, a background service by default, under Bun, so TypeScript loads as is. Only `effect` and `@opencode/plugin` come from the host and a plugin's own copy of them is refused: the adapter imports the package for types only.
- One plugin serves every session of its project: the state is per session. An edited file or config reloads the plugin, and its memory goes with it.
- A subagent runs in a child session (`parentID`): no notes there, and its written file is remembered on the main session, whose next prompt settles the docs — the child's never comes.
- `session.hook('context')` runs before every request and its system parts come before the whole history. The doctrine and the session's files are read once per session and again after a let-go, as in the other harnesses: read anew each request, they showed records the history had not reached yet, and every write to them broke the prompt's cache.
- The run's end is `session.execution.succeeded`, `failed` or `interrupted`; `session.idle` is deprecated and never comes.
- A compaction is an inbox item: `steer` runs it at the next step of a running turn, `queue` only when idle. It takes no instructions; `session.hook('compaction')` adds a system part, or sets `result` to skip the model. opencode keeps the latest 15K tokens whole beside the digest; the fill after a let-go is estimated until the next step measures it. No history is too small: when everything fits it keeps only the latest exchange beside the digest, and "Nothing to compact yet" comes only for a session with no text at all — so the adapter has no `cannotLetGo`; two shifts in a row on a fresh session (20K → 15K, then 17K → 15K) both let go.
- A synthetic message is read by the model as the owner's; the owner sees its `description`. With `resume: false` it waits in the inbox for the next boundary — but one sent while the runner is still going (right after a compaction) is taken at once and starts a turn.
- A command's `execute` runs plugin code; `/shift` queues its synthetic so it waits for the run going on. The terminal sends `/name args` to `POST /api/session/:id/command`, and so can `opencode api`.
- The rows the owner sees are synthetic messages, so the agent reads them too; a parked one shows in the terminal at once, before it is delivered.
- opencode finds a package's server entry as `<name>/server` (the package's `exports`), else the package's root; a local folder by its `server.ts`, else `index.ts`. So the entry is `server.ts`: `index.ts` is pi's, and a folder would load it. Plugins install through `@npmcli/arborist`, which fetches peers unless they are optional. `opencode plugin add` takes the registry or git only.
- Try it: link `adapters/npm` into a project's `.opencode/plugins/` or the global `~/.config/opencode/plugins/`, then `opencode run -s <id> --auto -m <model> '…'` against the background service; the plugin keeps working after `run` exits, and `opencode api GET /api/session/<id>/context` shows what the model read.
