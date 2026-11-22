---
description: When and how the mod hints a shift: the soft and final hints as shares of the harness's limit, the gauge and what the history grew from, how a hint reaches the model, the restore after a restart, shift_status, and why it is so.
---

# shift: hints

<!-- toc -->
- The rule
- The gauge
- Delivery
- Why not a percentage
<!-- /toc -->

A model rarely shifts by itself: without a hint it does not, and a frequent hint does harm (see `docs/research.md`). So the mod hints at growth, not at a percentage, and not on every turn.

## The rule

Use the harness's own let-go threshold as the effective limit L, falling back to its reported window. The base is the first reading after a shift. An adapter can supply reminder targets calibrated for its reported window; the Codex targets are in `docs/adapters.md`.

- **Soft.** Set `[hints] soft = false` to skip this reminder, including calibrated host targets. By default, offer an optional shift from 60% of L after at least 200K tokens of growth. The reading must still leave 10% of L before the final target.
- **Final.** The default target is 84% of L. A stretch that starts at or above it waits for 5% of L in new growth, capped at half the remaining room with a minimum of one token. A large jump can deliver the final directly. Each stretch gets at most one final reminder.
- **Unassisted.** After the harness lets the history go by itself, the agent is told at its next look to read the board.
- **Rebase.** A fill below the base or the last hint starts a new count there.

| Effective limit | Soft (low starting fill) | Final | Room left at final |
|---|---|---|---|
| 1M | 600K | 840K | 160K |
| 500K | 300K | 420K | 80K |
| 258K | — | 216,720 | 41,280 |
| 128K | — | 107,520 | 20,480 |

The agent may shift before the first hint on the owner's request. Otherwise it keeps working and maintaining its records.

## The gauge

The gauge is the stretch's count: the fill it started from, the fill at the last hint, whether the last let-go was unasked, and the growth per source. The harness gives no token count per row, so every row of the main history is counted in characters by source — a tool by its name, the agent's own responses, the owner's messages, attachments and reminders — and a hint names the largest shares: "Mostly from: Bash 51%, your responses 30%". A large share of tool output no longer needed is the strongest reason to shift.

The core keeps the gauge over a `GaugeKeeper` port; the adapter only stores it and reads its history. The gauge lives in the harness's memory, so a fresh process (a restart, a resumed session) restores it once, at the first look with a reading of the fill: the base from the last shift's `about.md` if that shift was this session's, the growth from the history as it is, plus whatever it counted meanwhile, and the last milestone inferred from the base and the current fill if the gauge has no saved hint.

A hint at the next prompt is marked given only once that prompt went with it; a prompt that failed or was dropped gets it again with the next one.

## Delivery

A hint is one of the notes `delivery.ts` hands out (`docs/architecture.md`): it goes with a tool's result — in Claude Code as the result's `context`, in pi as a text block — and between turns with the next message, in a `<shift note="a hint from the mod, …">` tag. It stays in the history: no harness offers a channel that does not, so each milestone is delivered once per stretch. Every hint is also a dim row for the owner, so the owner sees what the agent is told. No hint while a shift is pending.

`shift_status` answers on request: the fill against the window, where the harness lets the history go by itself, the growth since the last shift, when the next hints come and what the history grew from.

## Why not a percentage

A bare fill percentage is a bad signal: a model that sees "20%" anchors on it and refuses to fold, and the percentage says nothing about what to fold — 30% of a window can be one useful file or a dozen test logs. Two signals with different meanings instead: growth since the last shift ("there is something to let go") and the fill against the harness's own limit ("it is time, or the harness does it without your letter").
