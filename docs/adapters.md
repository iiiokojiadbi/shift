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

| Slot | Claude Code (mod) | pi (extension, 1.4.0) | opencode (plugin) |
|---|---|---|---|
| Measurement | `$.session.usage()`; the harness's own threshold from `usage({ breakdown: 'summary' })`, read once the window is half full **[run]** | `ctx.getContextUsage()`; the threshold is the window less `reserveTokens` from `SettingsManager` **[run]** | step tokens from events and `model.limit.context`; compute the available window yourself **[code]** |
| Tools | `$.tool.register` in `session.start`, a `tool.call` hook per row **[run]** | `pi.registerTool` at load, `setActiveTools` per session **[run]** | the plugin's `tool` **[code]** |
| Let-go with the Hold | `$.session.compact({ instructions })` after the turn; refused during one **[run]** | `ctx.compact({ customInstructions })` from `agent_settled`: it aborts whatever runs, so never from a tool **[run]** | `POST /session/:id/summarize`, the Hold added by the `experimental.session.compacting` hook **[code]** |
| `continue` | `$.prompt.submit({ text })` **[run]** | `pi.sendMessage({ customType, content }, { triggerTurn: true })`: a custom message, not the owner's **[run]** | `client.session.prompt`; turn off the synthetic "Continue…" with `experimental.compaction.autocontinue` **[code]** |
| `wait` | `prompt.context` of the owner's next message **[run]** | the message returned from `before_agent_start` of the owner's run; pi places it after the owner's prompt **[run]** | `prompt` with `noReply`; in 2.x `session.synthetic` with `resume: false` **[code]** |
| An unasked let-go | the `session.compact` hook on `trigger: 'auto'` adds the summarizer's instructions **[run]** | `session_compact` with a reason other than `manual` marks the stretch unassisted; `session_before_compact` can only replace the digest, not add instructions **[run]** | `experimental.session.compacting` fires on auto too **[code]** |
| State | plugin atoms — live in the harness's memory **[run]** | variables; the waiting letter also in `pi.appendEntry`, so it follows a reload and a `/tree` branch **[run]** | — |

## Claude Code

The adapter is a mod: a hooks module in TypeScript, `adapters/claude-code/hooks/`.

- The module imports only relative files inside the plugin folder and `claude-code`.
- Each file declares the state atoms it reads or writes: the engine's scan does not follow an atom through an import. The loop's atoms (`pending`, `autoStreak`, `waitNote`) live in `handover.ts`; other files reach them through `loopOf($)`.
- `$` may be passed across files only into a function declaration (`function f($) {…}`), never into an arrow bound to a name.
- `types/index.d.ts` must be self-contained: it mirrors `ShiftAfter`, `Gauge`, `PendingShift` and `WaitNote` from the core.
- Plugin state lives in the harness's memory: it survives a reload of the plugin's code, not a restart. What must outlive a restart is on disk or rebuilt from the history (the gauge's base from the last `about.md`). A pending shift kept from an older version may lack fields added since.
- A resume or a `/clear` inside a running Claude Code starts no `session.start`: the session's files are read again when `$.session.id()` differs from the one they were read for.
- A hint goes inside the last tool result as a `<system-reminder>`: a separate block in that row is shown to the owner as their own message.
- The `shift` tool argument is `after`, not `then`: an object with a `then` key looks like a promise.
- Rows go to the transcript by `$.ui.log`, which has no levels; the status line under the input is not used — it was noise.
- The owner is `prompt.submit` with `origin.kind` `composer`, `bridge` or `sdk`.

## pi

The adapter is an extension package, `adapters/pi/`, over pi 1.4.0's `ExtensionAPI`; pi and typebox are peers the host supplies.

- pi refuses to let go of a history smaller than `keepRecentTokens` (20K by default) and keeps that much of the latest history beside the digest; a test project can lower it in `.pi/settings.json`.
- `agent_settled` is awaited; a `sendMessage` with `triggerTurn` from it is deferred until the handler returns, so the continue still starts.
- The owner's input comes by the `input` event, idle or mid-run (`streamingBehavior`); only an idle one starts a run that takes the waiting letter.
- pi reads the session's files anew before every run, so its block is never stale.
- `--mode rpc` keeps the process alive for the let-go and the continue; print mode exits first. A headless `pi -p` in a fresh project waits silently unless run with `-a` and stdin closed.
- Try it: `pi -e ./adapters/pi` for one run, or `pi install ./adapters/pi` (loads in place).

## opencode

Not built yet. The slots above are from reading its sources; check each against a running opencode before relying on it.
