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

The stretch starts at the first fill after any let-go — the agent's shift or the harness's own. Every threshold is a share of the limit L: the harness's own let-go threshold, or the window when it is unknown. Windows differ several times over (1M, 272K, 128K), and fixed steps made hints frequent on small windows and rare on large ones; shares keep the rhythm the same.

- **Soft** — every `max(100K, 25% of L)` of growth since the start of the stretch or the last hint. A shorter stretch does not pay for its letter and records. No soft hint when the final one is less than half a step away. It says it is not an alarm.
- **Final** — at 80% of L, with room left to finish a stage, then every 5% of L.
- **Nothing** before the stretch has grown by 5% of L, so a shift that leaves the window full does not loop.
- **Unassisted** — after the harness let the history go by itself, the agent is told at its next look that there is no letter and it must read the board.
- **Rebase** — a fill below the base or the last hint means the history was let go unseen (a cleared session); the count starts again there.

| window | soft | final |
|---|---|---|
| 1M | ~250K, ~500K | ~800K |
| 272K | ~100K | ~218K |
| 200K | — | ~160K |
| 128K | — | ~102K |

`shiftHint` in `core/src/hint.ts` is a pure function of the gauge and a reading; the numbers are `softStep`, `finalAt` and `finalStep` there. The doctrine says not to shift before the first soft hint unless the owner asks: agents shifted at 120K right after finishing a task.

## The gauge

The gauge is the stretch's count: the fill it started from, the fill at the last hint, whether the last let-go was unasked, and the growth per source. The harness gives no token count per row, so every row of the main history is counted in characters by source — a tool by its name, the agent's own responses, the owner's messages, attachments and reminders — and a hint names the largest shares: "Mostly from: Bash 51%, your responses 30%". A large share of tool output no longer needed is the strongest reason to shift.

The core keeps the gauge over a `GaugeKeeper` port; the adapter only stores it and reads its history. The gauge lives in the harness's memory, so a fresh process (a restart, a resumed session) restores it once: the base from the last shift's `about.md` if that shift was this session's, the growth from the history as it is, plus whatever it counted meanwhile.

## Delivery

A hint goes inside the last tool result — in Claude Code as a `<system-reminder>`, since a text block of its own in that row is shown to the owner as their own message; in pi as a text block. Between turns it goes with the next message. It stays in the history: no harness offers a channel that does not, so loops are held back by "one hint per new growth". Every hint is also a dim row for the owner, so the owner sees what the agent is told. No hint while a shift is pending.

`shift_status` answers on request: the fill against the window, where the harness lets the history go by itself, the growth since the last shift, when the next hints come and what the history grew from.

## Why not a percentage

A bare fill percentage is a bad signal: a model that sees "20%" anchors on it and refuses to fold, and the percentage says nothing about what to fold — 30% of a window can be one useful file or a dozen test logs. Two signals with different meanings instead: growth since the last shift ("there is something to let go") and the fill against the harness's own limit ("it is time, or the harness does it without your letter").
