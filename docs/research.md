---
description: What the design stands on from outside: similar mechanisms in other harnesses and the lessons of billion-context — what confirms the shift, what to beware of, how to verify it. Before changing the hint, the doctrine or the words the model reads.
---

# shift: research

<!-- toc -->
- Similar things in other harnesses
- Lessons from billion-context
<!-- /toc -->

## Similar things in other harnesses

- **Codex** — the `new_context` tool: the model itself starts a new window; beside it `get_context_remaining` and a search over past windows. Behind the `token_budget` flag, in development, search only with the provider's own backend **[code]**. Out of scope here.
- **oh-my-pi** — `checkpoint(goal)` and `rewind(report)`: a point, work, then everything after the point folded into a report; the original branch stays in the session tree **[code]**. The tool texts are worth reading: `src/prompts/tools/checkpoint.md`, `rewind.md`.
- **billion-context** — the model folds ranges into summaries, early context is kept in layers. The hint and doctrine techniques come from here; targeted folding does not — it is out of scope. The analysis and figures are in `docs/archive/fold-mod-brief.md`.

## Lessons from billion-context

Read at `e518363`: the article, `CHANGELOG.md`, the core (`kernel/src/compress.ts`, `nudge-text.ts`, `compression-rules.ts`). Almost all of their conclusions come from incident analyses of one user; the controlled data is one 27B model, three runs.

**What confirms the shift:**
- The model itself rarely folds: without a hint there were 22% of compressions, and one session stood at 92% without one. A hint is needed.
- A frequent hint does harm: with a growth threshold of ~1.3K there were 3 execution errors instead of 1, and memory answers fell from 81.6% to 75.7% correct.
- They removed the percentage as a signal on purpose (#379): need is measured by growth.
- The doctrine in the system prompt alone, without a single fold, cut repeated reads by 62%.
- Without an explicit instruction the model never looks for what was folded; with one — 6 of 6. So the message after a shift says outright where the details are.

**What to beware of:**
- **A stale directive in the handoff.** An invented "verbatim" quote of the user landed in the summary as the current task and the session looped (#309). Our letter is a live directive by design, so the owner is quoted only with the words as said, and open work is in tasks with a status.
- **Some models write the summary as text.** Asked to compress, the model answers with `<analysis>`/`<summary>` instead of calling the tool, and the session stalls. So the model reads only "shift" — never "compression", "summary" or "compaction".
- **Loops on failed calls.** A model repeated 161 failed calls for 2 h 42 min. A refusal names its fix, and three `continue` shifts in a row without the owner force a wait.
- **Fake confirmations.** The model wrote 17 times that the fold was done when it was not. The mod checks state on disk, not the conversation.
- **Auto-compaction turned off without a net.** Bypassing their proxy left a session with no compression at all (#2290). The shift never turns off the harness's own let-go; it adds instructions to it.
- **Cancelling someone else's compaction** only on a direct sign that it is automatic (#1382).

**For verification:** a load made of stages — a plan given once, then only "continue", each step checked automatically; questions about early details from memory; a planted value to recall after a shift; a count of repeated file reads.

**An idea for later:** a mode where "fold now?" is a separate short request over a cached prefix, with no hint in the conversation (#2228, `src/nudge-decide.ts`); no results published.
