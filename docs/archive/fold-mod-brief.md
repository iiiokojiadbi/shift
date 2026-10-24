---
description: The superseded first brief: a pointwise fold of the history, its research and risks. Only for why the shift replaced it.
---

# fold-mod: brief for the agent who will build the MVP

A file for the agent who will come to the project later and work with the owner on the MVP. Written from the results of a research session. It collects what is not visible in the repositories: why this is needed, what has already been found out, what has been checked, and what is only an assumption.

## How to read the marks

- **[repo]** — read in the code or documents of `billion-context`.
- **[API]** — checked against the Claude Code 2.1.302 mod API types (`claude-code.d.ts`, read by myself).
- **[agent]** — my thought or conclusion: not taken from a source, not checked by running. Believe with a correction.
- **[unchecked]** — a hypothesis that must be checked before building on it.

The owner explicitly asked to separate my thoughts from facts. Continue this practice in your own notes.

## 1. What we want

To make a **Claude Code mod** (not a skill, not an MCP, not an external proxy) that joins two things:

1. The idea from `billion-context` (`bili`): the model itself decides when and what to fold into a summary. Only the consumed increment is folded, the sources are restorable, early context is not erased by repeated compressions.
2. What we need from our `shift` skill: so that what the session learned survives both compression and the end of the session. This is the snapshot letter, the accumulated material (traps, lessons, owner's instructions) and the acceptance of a shift in a new session.

The idea in one phrase: **compression inside a session and handoff between sessions are done by one mechanism**. A block summary is written to the letter skeleton, and what is valuable lands in the durable `.shift/` files, and not only in a block that will die together with the session.

The owner reads the documents himself and decides on the layout himself. Do not expand the scope silently.

## 2. Environment and constraints (what is not visible from the code)

- Work machine: an x86 tablet, Windows 11, all development in WSL2 (Ubuntu 24.04), 16 GB for WSL. Docker is local. Project code: `~/code/self/...` (personal). This brief lies in `~/general/claude-space/fold-mod/` — this is a sandbox; when the project is set up, move it to `~/code/self/`.
- The network goes through a proxy gateway with domain-based routing. `ping` is useless, check TCP. **Do not turn the proxy off for diagnostics without the owner's permission.**
- The original `billion-context` is cloned to `~/code/reference/billion-context`, commit `e518363` of 2026-10-24 (change nothing in this clone, it is for reference). A slightly older version was read, line numbers may drift. Repository: `ranxianglei/billion-context`, MIT license; `kernel/PROVENANCE.md` marks some modules as rewritten from DCP. Before copying code, read what belongs to whom. Ideas may be copied, code only deliberately.
- Claude Code version: **2.1.302**. Mods are early access, the API changes even in patch releases. First `claude --version`; if newer, check against `references/changelog.md` of the `mods` skill.
- **Before work, load the skills `mods` and `plugin-authoring`** (via Skill) and read their traps. Especially important: guard fail-open, the 10-second hook budget, `$` is only a call in place, module variables are reset on reload, no Node/DOM/`import()`.
- In a session the mod is written to `~/.claude/dev-mods/<session>/<name>/`; this folder is deleted together with the old session. Copy valuable things into the project. To run without the hot reload question: `claude --plugin-dir <folder>`.
- Tests: `claude plugin validate <folder>`, `tsc -p <folder>`, `claude plugin test <folder>`.
- The owner's rules for code and git: do not commit the `.claude/` and `.codex/` directories. In `~/code/self` the agent's `Co-Authored-By` is allowed. Do not name identifiers with the word `type` (use `kind`, `variant`, etc.). Commits and descriptions — in ordinary human language.
- The projects' `.shift/` files are a separate git inside the project. A mod that writes there must respect the rules of the `shift` skill: `owner.md` changes only on the owner's words, secrets do not go into a handoff. Read the `shift` and `unshift` skills in full, not from a retelling.

## 3. Research: how `billion-context` works

**[repo]** — everything in this section, unless marked otherwise. Key files: `README.md`, `kernel/DESIGN.md`, `kernel/DESIGN-prompts.md`, `paper/model-driven-incremental-hierarchical-compression-*.md`, `kernel/src/` (`pipeline.ts`, `prune.ts`, `compress.ts`, `nudge-text.ts`, `handoff.ts`, `persist/`).

### 3.1 Principle

The `bili` proxy stands between the agent and the API. The `acp-kernel` core does not call the model and does no I/O: the summary text arrives as a string from the model through the `compress` tool, and the core keeps the accounting and rebuilds the history. State is explicitly passed into the call and returned.

4 tools are added to the request: `compress` (fold a range), `decompress` (bring it back), `search_context` (search over summaries and visible messages), `acp_status` (the composition of the context and what can still be compressed).

### 3.2 Pipeline per turn

`assign-refs` (stable ids `m00123` on messages, visible to the model) → `sync-blocks` → `merge-blocks` → `prune` (messages covered by a block disappear, the summary takes the place of the first) → `filter` and `hide-compress-calls` → `nudge-inject` → `emergency-truncate` → `render-refs`.

### 3.3 Blocks and generations

A block = a range summary: `tier` 1–3, `directMessageIds`, `effectiveMessageIds` (the whole lineage), `directBlockIds`, `active`. Tier‑2 folds tier‑1 blocks, tier‑3 folds tier‑2 ("an LSM tree over text"). Sources are not deleted, the block is deactivated; `decompress` brings it back. `decompress-to-file` puts the full source into a file, not into the context.

### 3.4 When to compress

The nudge fires when the context is larger than ≈45% of the window and has grown by more than ≈50K tokens since the last compression (if there is little to compress, the threshold drops to ≈22.5K). The rule: compress between task steps, not in the middle. After compression the growth counter is reset. Techniques in the nudge text:

- the model is **not told the fill percentage** (otherwise it anchors on "20%, all is well" and refuses);
- a list of candidates with real range sizes is given;
- the model has the right to decline;
- the hint lives only for the moment of the call and is hidden afterwards.

The model can also compress by itself: in their logs this made up 22% of compressions.

### 3.5 Protection

The core, not the prompt, does not let these be compressed: the compress calls themselves, the last ~5 messages (~5K tokens), the last user message, the **first** user message (always stays verbatim: the API does not accept a dialogue without a user message).

### 3.6 Summary doctrine

A single criterion: "does the current task step need this content?". KEEP verbatim: paths with line numbers, signatures, exact error texts, decisions together with the rationale, values, the evolution of the goal, `mNNNNN` references. DROP: long logs after the result is extracted, repeated reads, dead ends (but keep the lesson). Priority when space is short: goal → decisions with rationale → artifacts → conclusions → lessons. The full text is `kernel/DESIGN-prompts.md`.

### 3.7 The authors' figures

Median summary 185 tokens, folding ~8× (tool output 24×), sessions of hundreds of thousands of calls with a 200K window, cache hit 95–97%. These are **their own logs**, there is no independent verification. Not applicable to tasks that need verbatim history (audit, forensics). Medium-sized models rarely call `decompress` by themselves — it works when told explicitly.

## 4. Cache: what is certain and what is not

The owner's question was exactly about this, and I first answered imprecisely. The result:

- **[repo]** The provider's prefix cache requires an exact prefix match. Folding the range `[A..B]` into a summary changes the request starting from `A`: everything before `A` stays in the cache, the summary and everything after it is a cache miss once (in the README this is called `compress re-pay`). The paper's claim "the window is append-only, the prefix is not invalidated" holds only for ordinary turns between compressions.
- **[repo]** Folding is cheap because it is rare (once per ~50K of growth), takes the old consumed material and not the fresh one, and pays for itself: every following request reads a smaller context. The claimed 95–97% hit rate is a session average.
- **[agent]** In a mod the picture will be close: the compaction of a Claude Code transcript also breaks the prefix from the first changed message. But we have **not checked** how exactly Claude Code places `cache_control` after messages are replaced. Measure at once (see section 8, experiment 3).
- The cache lives for a limited time (by default on the order of 5 minutes). A pause longer than that is a full miss regardless of us.

## 5. What we need from `shift`

Read the `shift` and `unshift` skills. What matters for the link:

- **The letter** `letter.md` — a snapshot at the moment of leaving: what the session is about, where to start, the owner's decisions verbatim, "do not infer", "tried and dropped", "uneasy". Written anew, not inherited.
- **The accumulated** in `knowledge/` (`traps`, `lessons`, `runbook`, `glossary`, `owner`) — appended to, lives for months.
- **`unfinished.md`** — what was dropped half-way, carried over until closed.
- **Accepting a shift** at the start of a new session — per `unshift`.
- **Limits of automation:** `owner.md` changes only on the owner's words; cleaning the accumulated material and checking for secrets are judgment, not mechanics. This must not be handed to a module silently.
- The principle: **durable things do not live in a snapshot**. Something written only in a summary block dies with the fold the same way it used to die in the letter.

## 6. What the mod API can do (checked against types)

**[API]** All items below were found in `claude-code.d.ts` 2.1.302 (`/tmp/claude-1000/bundled-skills/<version>/.../plugin-authoring/types/claude-code.d.ts`, lines as of the reading; look for the current file next to the loaded mod in `.claude-plugin/types/`).

| Need | What exists |
|---|---|
| Intercept compression | the `session.compact` event: triggers `manual`, `auto`, `plugin`, `precompute`. The hook can rewrite `instructions` and `messages`, **answer with its own `{ messages }`** or return `{ skip: reason }`. "A summary is a message", there is no separate summary line. |
| Start compression itself | `$.session.compact({ instructions })` — like `/compact`, between turns; **rejected while a turn is running**. |
| Count context growth | the `session.measure` event (after every turn of the main thread) and `$.session.usage()` — window percentage, cost, `breakdown`. |
| Give the model tools | `$.tool.register({ name, description, inputSchema })` in `session.start`; served by the `tool.call` hook on `mcp__<mod>__<name>`. This is how `compress`, `decompress`, `search_context`, `status`, `shift_note` are made. |
| Read the history | `$.session.messages()` (up to the last 4096, fields `role`, `text`, `toolUses`, `toolResults`); `as: "api"` gives blocks as they are. |
| Append a line to the conversation | `$.session.append({ message })` — user role, text blocks only. |
| Rewrite a line on write | the `session.append` event (by "door": `prompt`, `tool-result`, `response`, `compaction`, `note`, ...): `content` can be rewritten, it is stored and goes to the model in the rewritten form. |
| Add blocks to the first message | the `prompt.context` event: context blocks of the first user message; the answer holds until `$.ui.invalidate("prompt.context")` or reinstall (compaction, `/clear`). A natural place for an automatic `unshift`. |
| Change the system prompt | `prompt.compose` (sections, add with `scope: session`) and `prompt.section`. A place for the doctrine. |
| Call a model from the mod | `$.model.complete({ model: "<cheap model>", prompt, ... })` — without tools and history. A cheap model can be used to summarize. |
| Files, processes, timers | `$.fs` (reading up to 4 MiB), `$.process.spawn`, `$.clock`. |
| State | `$.state` (session, rendered), `$.store` (shared by all sessions on the machine, keys with the run id). |
| End of session | `session.end` — but the whole chain shares **one short boundary**, `next.budget` shows it. Do not do heavy writes there. |

Nuances already known from the `mods` skill: a hook budget of 10 seconds of its own time; module variables are reset on reload; on re-entry (an event from your own `$` call) `.catch` is not asked.

## 7. Proposed architecture

**[agent]** — the whole section is my proposal. The owner has not approved it.

### 7.1 The main argument

The mod works at the level of the Claude Code transcript, `bili` — at the level of the wire. Two consequences follow.

- Plus: no proxy is needed, no problem with the route through our gateway and with TLS interception, no problem with the desktop app that bypasses the proxy (described in the `bili` README as #2290). The mod works in the terminal, Desktop and `-p`.
- Minus: folding goes **through Claude Code's compaction**, and not on every turn in the request. That is, there is no continuous `prune`; folding happens in portions, when we ourselves call `$.session.compact()` between turns and substitute the result in `session.compact`. This is quite acceptable (`bili` also has portions of ~50K), but the mechanism is different.

### 7.2 Components

1. **Doctrine** (`prompt.compose`): a short system prompt section. Describes the tools, the criterion "does the current step need it?", KEEP/DROP, the letter skeleton for the summary. Take `kernel/DESIGN-prompts.md` as the basis, but **shorten** it: in `bili` initialization eats hundreds of tokens, the fork `billion-context-pi-lean` showed 486 instead of ~8K [repo: fork description]. This is a good reference for the budget.
2. **Trigger** (`session.measure` + `$.session.usage()`): count the growth since the last fold, check two thresholds (window share and growth). The decision on the nudge is made by a pure function that can be tested without Claude Code.
3. **Nudge** (`$.session.append` with a short line with range candidates and their sizes): without the fill percentage, with the right to decline. It must disappear by itself at the next fold (it lies in the folded range).
4. **Tools** (`$.tool.register`): `fold_compress { ranges:[{from, to, summary, topic}] }`, `fold_restore { block }`, `fold_search { query }`, `fold_status`. The `compress` handler does not rebuild anything at once but puts a request into a queue.
5. **Applying the fold:** in `turn.complete` of the main thread (without `agentId`) the mod calls `$.session.compact({ instructions })`; the `session.compact` hook with `trigger: "plugin"` returns **its own `messages` list**: the original transcript where the range is replaced by a summary message. Messages with `handle` stay as they are, the new one is built from `role`/`text`.
6. **Block storage** (`$.fs` in the session directory, not `$.store`): the sources of folded ranges and block metadata (`blockId`, `tier`, lineage). Needed for `restore` and `search`.
7. **References to messages:** the model needs addresses to specify a range. Options: `mNNNNN` marks via `session.append` (like `render-refs` in `bili`) or sequence numbers in the candidate list in the nudge (they do not change the stored text). **I lean to the second:** less risk of spoiling the transcript. [unchecked]
8. **Sink into shift** (`shift_note { kind, ... }`): recording a trap/lesson/runbook into `.shift/knowledge/` per the skeleton. On every fold — a **draft** `letter.md` next to the current snapshot: not final, but "the last known state". The final handoff is still made by the `shift` skill with a human.
9. **Accepting a shift** (`prompt.context`): in a new session add a block with paths "read `letter.md` of this snapshot, `owner.md`, check what is running" instead of a manual `unshift` call. It is better not to insert the letter's content whole but to give a reference.

### 7.3 Where the forks may lead

- Who writes the summary: **the model via `fold_compress`** (as in `bili`, higher quality, sees the task) or **the mod via `$.model.complete`** (a cheap model, predictable, but the judgment "is it needed" is worse). For the MVP — the first.
- Claude Code's auto-compaction: it must either be turned off (`DISABLE_AUTO_COMPACT=1`, this is what the native `bili` plugin for Claude Code does, `TECHNICAL-NOTES.md`), or intercepted by the `session.compact` hook with `trigger: "auto"` and replaced with our fold. The second option **looks** more elegant: we turn nothing off but build in. [agent, unchecked]
- `precompute`: Claude Code can compute a compaction in advance and keep the result. The fold could be computed in the background while the user reads. [agent, unchecked; the meaning of the trigger is described in the types, the behavior has not been tried]

### 7.4 MVP composition (proposal)

What the first slice should contain:

1. A mod with the doctrine and four tools.
2. A pure nudge-decision function and tests on it.
3. Applying the fold via `session.compact` with `messages` substitution.
4. Storing block sources in `$.fs` and `fold_restore`.
5. One sink into shift: a draft `letter.md` on fold. **Without** writing to `knowledge/` and without `owner.md`.
6. A report in the status line/toast: how much is folded, the block size.

What is **not** in the MVP: tier‑2/3, block merge, `precompute`, automatic writing of the accumulated material, automatic acceptance of a shift, a panel, `emergency-truncate`.

## 8. Experiments before writing code

The foundation must be checked first. I have not checked it.

1. **Substituting `messages` in `session.compact` really works.** A minimal mod: a hook on `trigger: "plugin"` returns the transcript with one range replaced by a text message. Call `$.session.compact()` from a command. Check: what the model sees on the next turn, whether the `tool_use`/`tool_result` link is intact (cutting in the middle of a pair is the classic cause of a 400 from the API), whether the first user message is lost. **If this does not work, the whole architecture 7.2 does not work**, and only the proxy option remains.
2. **What exactly lies in `messages`** at the hook's input. `SessionMessage` is a flattened view (`text`, `toolUses`, `toolResults`); it is unknown whether `thinking` blocks, attachments, images are lost. Compare with `$.session.messages({ as: "api" })`.
3. **Cache.** Take `cache_read_input_tokens` before and after the fold (via `session.measure`/`$.session.usage()` and the transcript). How many tokens are overpaid, and whether the prefix breaks earlier than point `A`. The measuring method is similar to the one described in the memory `agent-latency-from-transcripts`.
4. **Visibility and lifetime of the nudge.** Whether a line added by `$.session.append` disappears after the fold; whether it affects the cache.
5. **Hook budget.** Does substituting `messages` for a 100K context fit into 10 seconds? Heavy work (writing block sources) must go outside the hook.
6. **`restore`.** Can the original range be returned by the same mechanism (a second `session.compact` with substitution), and what happens with `tool_use`/`tool_result` pairs. A fallback variant: `restore` puts the text into a file, and the model reads it with the `Read` tool (this is what `decompress-to-file` does).

If experiment 1 fails — **tell the owner and stop**, do not invent a workaround. Fallback paths: a) stay with `bili` as an external proxy and make the mod only a shift layer (a letter draft, `prompt.context`); b) a fork of the `acp-kernel` core with a note into `.shift`.

## 9. Risks

- **Unstable API.** Mods are early access. Build in a version check on load and a clear refusal (`session.start` with a toast), and not a silent failure. Remember: a crashed hook without `.catch` is skipped, the call goes on (fail-open).
- **Transcript corruption.** Any history substitution can leave an orphan `tool_result`. Tests and a check of pairs before returning from the hook are needed; when in doubt — `{ skip }`, not a substitution.
- **Loss of verbatim.** Folding to ~1/8 loses the owner's formulations. Write the owner's decisions and prohibitions into `letter.md`/`owner.md` **at once**, and do not hope for the summary. This matches the "start the handoff early" mode of the `shift` skill.
- **Double compression.** If Claude Code's auto-compaction stayed and fired in parallel with ours, we get a double fold.
- **Recursion.** An event from your own `$` call (for example, `$.session.compact` inside the mod) bypasses the hook on re-entry; do not count on your own hook seeing your own call.
- **Work projects.** For `~/code/work` the rule applies not to mention AI tools in commits/comments. This mod is personal, but if it is applied in a work project, check that it writes nothing there.
- **Overlap with `.shift`.** The mod must not commit into the `.shift` git and must not write secrets. Any write on the `.shift/` path — exactly per the rules of the skill.

## 10. What not to do

- Do not rewrite the `bili` core into TypeScript "for the mod": first the experiments from section 8.
- Do not automate the `shift` judgments (`owner.md`, cleaning the accumulated material, the final secrets check).
- Do not start tier‑2/3 and merge before the basic fold and restore work.
- Do not take the `bili` authors' figures for your own: re-measure on our load.
- Do not publish the mod outside without asking the owner (the `mods` skill has a step "offer to share" — offer only after the owner has seen it work).

## 11. Questions for the owner (ask before starting)

1. Where to put the project: a new repository in `~/code/self/` or a directory inside an existing one?
2. The MVP — only on your machine, or make it suitable for installation by others right away (a plugin from a repository)?
3. Is the summary written by the model in the main session (expensive in tokens, better quality) or by a cheap model from the mod (`$.model.complete`)?
4. Turn Claude Code's auto-compaction off or intercept it?
5. What volume of draft letter on a fold is acceptable: only `letter.md`, or write to `knowledge/` at once as well?

## 12. The agent's first step

1. Read this file, the skills `mods`, `plugin-authoring`, `shift`, `unshift`.
2. Check `claude --version`; if not 2.1.302 — check against `references/changelog.md`.
3. Ask the owner the questions from section 11.
4. Perform experiment 1 from section 8 and report the result before any other code.

## Appendix: sources

- `~/code/reference/billion-context` — `README.md`, `TECHNICAL-NOTES.md`, `CLIENTS.md`, `kernel/DESIGN.md`, `kernel/DESIGN-prompts.md`, `kernel/src/handoff.ts`, `paper/`.
- The preprint paper v0.2 (2026-09-07), author Xianglei Ran, lies in `paper/`; for the revised claims about the cache see section 4.
- Related repositories (searched, not read): `ranxianglei/billion-context-pi`, `kunkun9527/billion-context-pi-lean` (lightweight initialization, a reference for the prompt budget), `Tyan66666/billion-context-dsh`.
- The skills `mods`, `plugin-authoring`, `shift`, `unshift` — in `~/.claude/skills/` (sources in `~/data/skills`).
