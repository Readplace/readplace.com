# ADR 0001 — Deterministic, model-agnostic review *routing* from a validated review-result contract

- **Status:** Proposed (review-only — this PR is a draft and is not intended to merge as-is).
- **Decision drivers:** future-proof the PR automation against model changes and prompt drift, remove manual intervention, align the CI automation with the repo's own engineering standards.
- **Relates to:** the marker contract documented in [`.github/workflows/CLAUDE.md`](../../.github/workflows/CLAUDE.md).
- **Scope of "model-agnostic":** the *routing decision* (auto-fix or not) becomes model-agnostic — derived from validated findings, never model-typed counts. The *findings* stay model-authored, now schema-validated JSON instead of free prose (§6); "model-agnostic" in the title qualifies routing, not the findings' authorship.

> **Revision note (v0.2).** v0.1 proposed *removing* the `<!-- CLAUDE_REVIEW_REQUEST -->` trigger marker and moving routing onto the `workflow_run` path. A five-lens adversarial review (GH-Actions mechanics, failure-modes/loops, repo-conventions, migration safety, completeness) found that unsound and it has been corrected. The marker is **workflow-authored** (by `claude-PR-code-reviewer.yml`), not model prose — removing it would make review-run detection *more* model-dependent and would not fix the incident. This version keeps the marker and narrows the change to the one genuinely fragile thing: **the prose count contract the model hand-writes.** The findings that reshaped this doc are summarized in the appendix.

> **Revision note (v0.3).** An automated review pass on this PR found that v0.2's corrections were all on the *producer* side, while the **consumer** (`request-fix`) still (a) substring-matched markers over a body that also carries model text, (b) had no executable home for the combined `decideNext`, and (c) located findings by an unmarked code fence with no unique key. v0.3 closes these: the render **escapes model text** so the markers are a render-only vocabulary (§3.5, §4.1); the routing decision is **decomposed** into a tested render-time threshold (`needsAutoFix`) plus a dispatch-time staleness/cap check in `request-fix`'s existing script step (§4.3–§4.4); and findings are wrapped in a unique `CLAUDE_REVIEW_FINDINGS_START/END` marker pair (§3.2, §4.2). It also re-anchors the trust model on the `author_association` gate (§8) and scopes "model-agnostic" to *routing* (title, §6). The corrections are tabulated in the appendix.

---

## 1. Context

### 1.1 The incident (corrected attribution)

PR #829's review ran successfully but auto-apply never fired. Verified against the GitHub API, there were **two distinct breaks on two attempts**:

1. **06-26 — listener crashed (infra).** The code-reviewer posted the proper review request (marker present), but the listener run hit the agent-SDK `#852` startup crash. The artifact step is gated on `steps.claude.outcome == 'success'`, so it was skipped. This is `claude-PR-crash-retry.yml`'s job; that it was not recovered (crash exceeded the ≤240 s window or exhausted its 4 attempts) is a **crash-retry gap, not a contract failure** — out of scope for this ADR.
2. **06-28 — human manual re-trigger (routing).** A human re-typed the review request. It **referenced** `claude-PR-code-reviewer.md` (verified — so the agent loaded the reviewer prompt and the review ran fine, 2 medium findings) but **omitted** the `<!-- CLAUDE_REVIEW_REQUEST -->` HTML marker. The artifact step is gated on that marker, so it was skipped again → no artifact → `post-review-comment` logged `nothing to do`. (An earlier note here called this comment "bare"; that was wrong — it pointed at the reviewer prompt, which is why the stop-gap in §6 covers it.)

Two things are worth separating cleanly, because v0.1 conflated them:

- **The marker is workflow-authored and is doing its job.** On the automated path, `claude-PR-code-reviewer.yml` always emits it. It is the review-run discriminator — the only signal that tells the generic listener a given run is a review.
- **The model-authored prose count contract is the fragile part.** The routing decision "does this review warrant an auto-fix?" is read from `<!-- HIGH/MEDIUM_PRIORITY_COUNT: N -->` markers the *model hand-types* into prose (`claude-PR-code-reviewer.md:96-107` ships a "CRITICAL" checklist begging it to). That is the model-format dependency to delete.

### 1.2 The contract surface (why the fix is narrow)

Only **one** of the four LLM-driven hops routes off model-produced formatting; the other three route off deterministic git/CI state:

| Hop | Routing signal | Model-format dependency? |
|---|---|---|
| `claude-PR-CI-failure-fixer` | CI `conclusion == 'failure'` + attempt label | None |
| `claude-PR-conflict-fixer` | `pulls.get().mergeable === false` | None |
| `claude-PR-crash-retry` | run `conclusion == 'failure'` + duration ≤ 240 s | None |
| **review → auto-fix** | **model-typed `HIGH/MEDIUM_PRIORITY_COUNT` in prose** | **Yes — the only one** |

`post-review-comment` already crawled halfway to the fix: it lifts the review block from the run's **`execution_file` transcript** (the action-guaranteed channel) and posts the comment *itself* rather than trusting the agent's choice of channel. This ADR finishes that journey by pinning a **data contract** for the findings, so counts are derived, not typed.

---

## 2. Problem statement

The review → auto-fix routing decision is read from **prose the model formats**, and the model **hand-types the counts** that drive it. This is:

- **Model-fragile:** a new model or reworded prompt can drop/malform the counts or route the block through the sticky comment (which strips markers).
- **Unverifiable:** `COUNT: 2` is trusted even if the list has 3 items.
- **Untested:** the parse/route logic lives in inline `github-script` inside YAML — the one place the repo's zod-at-boundaries / 100%-coverage / no-`as` standards do not reach.

Out of scope (handled elsewhere, named here to avoid re-conflation): the crash/success-gate path (`crash-retry`) and a *truly* bare manual `@claude` comment that references no reviewer prompt at all (§6).

---

## 3. Decision

**Keep the workflow-authored marker; replace only the model-authored prose-count contract with a schema-validated findings object; render the routing-critical comment deterministically.**

1. **Keep `<!-- CLAUDE_REVIEW_REQUEST -->` as the workflow-authored review-run discriminator.** It is emitted by `claude-PR-code-reviewer.yml`, not the model, and is the only thing that tells the generic listener a given run is a review. The upload/render step stays gated on it. *(Reverses v0.1.)*
2. **Model emits findings as JSON, wrapped in a unique marker pair, in its final message; counts are derived.** The review's deliverable becomes a single fenced ` ```json ` block carrying `high/medium/low/summary` only — captured by the already-uploaded `execution_file` transcript (the proven channel). `highCount = high.length`; the model never types a count. The JSON sits inside a unique `<!-- CLAUDE_REVIEW_FINDINGS_START -->` … `<!-- CLAUDE_REVIEW_FINDINGS_END -->` marker pair so the render locates it deterministically (§4.2).
3. **The workflow injects identity; the model never authors it.** `prNumber`, `headSha`, `runId` come from GH context (event payload / artifact name / run id), validated and **branded** per repo standard. The model-authored payload carries no identifiers.
4. **A tested module renders the comment, run inside the listener.** The listener already checks out the **PR head** and has the Node/pnpm toolchain, so the render module runs at the *same ref as the prompt that produced the JSON* — eliminating producer/consumer schema skew. It slices the `CLAUDE_REVIEW_FINDINGS_START/END` block, validates it (zod `.safeParse`), renders the deterministic review comment — deriving the `HIGH/MEDIUM_PRIORITY_COUNT` markers, injecting a `REVIEW_HEAD_SHA` marker for the staleness guard (§4.4), and **escaping all model-authored text** so it cannot forge a marker (§4.1) — and uploads the **rendered comment** as the artifact. `post-review-comment` posts it verbatim.
5. **The comment-triggered `request-fix` keeps its trigger, but its correctness now rests on a render invariant — it is not "untouched."** The `issue_comment` gate still substring-matches `CLAUDE_REVIEW_START` + non-zero count over the whole body (`contains()` is all a GH-Actions `if:` can do). That is only safe because the render **escapes all model-authored text**, so the reserved markers become a vocabulary only the render can mint (§4.1); without that invariant a finding that *quotes* a marker (e.g. a review of `claude-PR-code-reviewer.md`, whose "no issues" example carries both `…COUNT: 0…` markers) would suppress or trip auto-fix. So routing is deterministic with **no trigger rewire**, but §4.1's escaping is load-bearing and `request-fix`'s own script step gains a staleness check (§4.4) — honestly, the consumer is *narrowed and depended-upon*, not unchanged. The per-PR concurrency group and the `MAX_AUTO_FIX_ATTEMPTS = 5` cap stay exactly where they are. *(Still reverses v0.1's `workflow_run` rewire.)*
6. **Deviation handling is bounded and human-terminating, with no LLM correction loop.** Invalid/absent JSON → deterministic salvage from the legacy block *during the dual-emit window only* → otherwise a dedicated, non-resetting `review-deviation-attempt-N` re-trigger (its own cap, distinct from `auto-fix-attempt-N` and from `crash-retry`'s `run_attempt`) → human escalation. Loud, never silent.
7. **Deviation telemetry is a decision, not an open question.** Each violation appends a structured row to a long-lived tracking issue (the recurrence store); a defined deviation-rate threshold gates the migration's legacy-drop (§7). No second LLM call on the happy path.

### 3.1 What deliberately stays the same

- The workflow-authored marker, the comment-as-trigger seam, the per-PR serialization, the 5× cap, and `post-review-comment` posting the comment.
- Comments remain the audit log and the `@claude` trigger; only the **content** of the routing-critical comment moves from model-formatted to workflow-rendered.
- The `.github/workflows/CLAUDE.md` principles "Single Execution Point", "Comment-Based Communication", "Auditable" are preserved.
- The other three hops are untouched.

---

## 4. Detailed design

### 4.1 The data contract (model authors findings only)

```ts
// @packages/review-result/src/review-result.ts  (standalone CI-tooling package; see §8)
import { z } from "zod";

const ReviewIssue = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  file: z.string().optional(),               // findings are not always localized
  line: z.number().int().positive().optional(),
});

// MODEL-AUTHORED payload: findings + summary, no identifiers, no counts.
export const ReviewFindings = z.object({
  schemaVersion: z.number().int().positive(), // consumer accepts <= N, never z.literal — see §8 skew
  high: z.array(ReviewIssue),
  medium: z.array(ReviewIssue),
  low: z.array(ReviewIssue),
  summary: z.string().min(1),
});
export type ReviewFindings = z.infer<typeof ReviewFindings>;

// WORKFLOW-INJECTED identity, branded per repo standard ("Branded Types for Domain IDs").
const PrNumber = z.number().int().positive().brand<"PrNumber">();
const HeadSha = z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/).brand<"HeadSha">(); // exactly SHA-1 (40) or SHA-256 (64) hex
const RunId = z.number().int().positive().brand<"RunId">();

export const needsAutoFix = (f: ReviewFindings) => f.high.length + f.medium.length > 0;
```

`needsAutoFix` is the single source of the count→route threshold and is the only routing input the **tested module** owns. The full route is deliberately *not* one function: the **content** decision (does the rendered comment carry the trip signal?) is `needsAutoFix`, evaluated at **render time** in the listener; the **staleness** and **attempt-cap** decisions are dispatch-time and live in `request-fix`'s existing script step (§4.4) — the head can move, and the attempt label only exists, *after* the comment is posted. v0.1's combined `decideNext(findings, liveHead, attempts)` is dropped: it implied one tested function ran the whole decision inside a job that has neither the toolchain nor the live state to do so (§4.3).

The render also **HTML-escapes every model-authored string** (`title`/`detail`/`summary`) before interpolation, so the reserved markers (`CLAUDE_REVIEW_START/END`, `HIGH/MEDIUM_PRIORITY_COUNT`, `CLAUDE_REVIEW_FINDINGS_START/END`, `REVIEW_HEAD_SHA`) form a vocabulary only the render can mint. This is standard output-encoding applied to a routing channel: model text can no longer forge a marker, which is what makes `request-fix`'s substring gate safe (§3.5). The escape step is `escapeModelText`, part of the tested module.

### 4.2 Data channel: the transcript, not a workspace file

The model emits the ` ```json ` findings block, wrapped in a `<!-- CLAUDE_REVIEW_FINDINGS_START -->` … `<!-- CLAUDE_REVIEW_FINDINGS_END -->` marker pair, as its **final message**. The listener already uploads `steps.claude.outputs.execution_file` — the action-guaranteed transcript — so no new "did the agent write a file to disk" dependency is introduced. The render module slices that block by its **unique** markers — exactly how `post-review-comment` slices `CLAUDE_REVIEW_START/END` today, so it stays locatable during dual-emit and cannot be confused with a code fence the model quotes from the diff — then strips the fence and `.safeParse`s the payload. (A bare fence has no unique key; the marker pair is what makes the new channel *at least as* locatable as the legacy block it replaces.) This resolves v0.1's internal contradiction (committing to a workspace file while doubting it works).

### 4.3 Where the logic lives (and what stays untested YAML)

- **Tested module** (`@packages/review-result`, covered by `pnpm check`): `parseFindings(transcript) → Result<ReviewFindings, Deviation>`, `renderReviewComment(findings, identity) → string`, `needsAutoFix(findings) → boolean` (the count→route threshold), and `escapeModelText(s) → string` (marker neutralization, §4.1). Pure, fixture-tested, including the optional `file`/`line` and empty-section branches; coverage targets 100 % per the repo policy — residual V8 block-coverage phantoms (`||`/`??`/`for…of`/async artifacts the repo's `CLAUDE.md` documents as sometimes unavoidable) are restructured away where possible and otherwise annotated with a `bcoe/c8#319` reference, never blanket-ignored. Every exported function has a real caller (next bullet); there is no defined-but-unreachable routing function.
- **Listener glue (YAML, review-run branch only, gated on the marker):** one `node` step that runs the built module over `execution_file`, calls `needsAutoFix` + `renderReviewComment`, writes `review-comment.md`, and uploads it — this is the caller for the tested module. The listener already has checkout + node + pnpm, so no new heavy setup is added to the artifact-only `auto-apply` job.
- **`post-review-comment` (YAML):** downloads `review-comment.md` and posts it verbatim. Honestly scoped: the artifact-download / `createComment` IO glue **remains untested YAML**.
- **`request-fix` script step (YAML):** keeps its trigger gate; its existing `github-script` step gains the dispatch-time **staleness** comparison (§4.4) beside the `MAX_AUTO_FIX_ATTEMPTS` cap it already enforces. This stays **untested inline YAML** — so the claim is precisely that the *threshold and rendering* are unit-tested, not that the whole dispatch decision is. No checkout/node is added; the comparison is a few lines over data `pulls.get()` already returns. The win is that the *decision and rendering* are now covered, not that all YAML disappears.

### 4.4 Routing — same trigger gate; staleness in the existing script step

`request-fix`'s `if:` trigger gate is unchanged — it fires on the workflow-rendered, now-deterministic comment. The render injects a `<!-- REVIEW_HEAD_SHA: <sha> -->` marker (workflow-injected, branded `HeadSha` upstream). Inside `request-fix`'s **existing** `github-script` step — the one that already calls `pulls.get()` and enforces `MAX_AUTO_FIX_ATTEMPTS` — we read that marker and compare it to the live PR head (`pr.data.head.sha`); if stale, no-op (a newer review supersedes it). This closes the force-push / concurrent-run race v0.1 left open while carrying `headSha` unused, **without** giving the job a checkout or node: it is a few lines over data the step already fetches. It is untested inline YAML, scoped like the rest of the IO glue (§4.3); the unit-tested surface is the threshold (`needsAutoFix`) and the render, not this comparison.

### 4.5 Fallback ladder (steady state is two rungs; salvage is dual-emit-only)

1. **Valid JSON** (the `CLAUDE_REVIEW_FINDINGS_START/END` block parses) → render + route. Zero LLM round-trips.
2. **Dual-emit window only:** invalid/absent JSON → salvage the legacy `CLAUDE_REVIEW_START…END` block from the transcript (today's behavior) and render from it. **This rung disappears once §7.4 removes the legacy block** — stated explicitly so it is not mistaken for a durable net.
3. **No usable result** → append a deviation row (telemetry), bump a dedicated **non-resetting** `review-deviation-attempt-N` label, and re-post a fresh `<!-- CLAUDE_REVIEW_REQUEST -->` review request **authored with `PAT_TOKEN`** — a `GITHUB_TOKEN`-authored comment does not re-trigger the listener (§8), so the rung is inert without it. This is a *new* mechanism: crash-retry and `auto-fix-attempt-N` provably cannot fire for a succeeded-with-bad-JSON run. **Cap: 2 deviation re-triggers per PR**, non-resetting within the PR and reset only by a later clean (parseable, zero-deviation) review; rung 3 is the loop's only bound, so the cap is pinned here, not deferred to implementation (§8 OQ2). At the cap → human escalation. Never silent.

---

## 5. Alternatives considered (and rejected)

| Alternative | Why rejected |
|---|---|
| **Remove the `CLAUDE_REVIEW_REQUEST` trigger marker** (v0.1) | It is workflow-authored, not model prose. Removing it makes review-run detection depend on the model writing a file — strictly *more* model-fragile — and it is the only thing that tells the generic listener a run is a review at all. |
| **Rewire `request-fix` onto the `workflow_run` path** (v0.1) | Breaks the documented per-PR concurrency-group serialization, relocates the 5× cap, and the comment-triggered job has no artifact in scope. Once the comment is workflow-rendered, the existing trigger is already deterministic — zero rewire needed. |
| **Model writes `prNumber`/`headSha` into the JSON** (v0.1) | Re-introduces the hand-typed-value bug the ADR deletes; the workflow already holds these authoritatively. Inject + brand them instead. |
| **Ask the model to "correct" a malformed comment** | Re-introduces the dependency being deleted; loops. Deterministic render makes a malformed routing comment unrepresentable. |
| **Auto-RCA + auto-open a fix on every deviation** | Noise/cost; a second LLM call on the happy path. Kept as telemetry, escalated on recurrence. |
| **Rewrite all four hops into one orchestrator** | Three already route deterministically. Out of scope. |

---

## 6. What this fixes, honestly

- **Fixes (the count-trust class):** a new model, reworded prompt, or sticky-comment channel can no longer drop or mis-state the routing-critical counts — they are derived from validated findings, the comment is workflow-rendered, and model text is escaped so it cannot forge a marker (§4.1). This is the durable, model-agnostic routing win **this decision** delivers.
- **What this decision does NOT, by itself, deliver — #829 case 2:** the data contract + deterministic render do *not* make a marker-less manual re-trigger route. Case 2 is fixed by the **independent stop-gap** below (broadening the upload gate to also accept a comment that references `claude-PR-code-reviewer.md`), which ships with no dependency on this ADR. It is listed here only so the incident's coverage is complete — attributed to the stop-gap, not to this decision.
- **Does NOT fix, by itself:**
  - #829 **case 1** (listener crash) — orthogonal; owned by `claude-PR-crash-retry`. Residual dependency on its ≤240 s / 4-attempt bounds remains.
  - A *truly* bare `@claude` comment that carries neither the marker nor a reference to any reviewer prompt — the agent never produces findings, so nothing routes. That is a documentation concern (use the canonical re-trigger: re-run the failed listener run, or comment via the code-reviewer's exact marker-bearing format), not a contract bug.

**Independent stop-gap (ship anytime, no dependency on this ADR):** broaden the artifact gate to also accept a manual re-trigger that references the reviewer prompt — `contains(body,'CLAUDE_REVIEW_REQUEST') || contains(body,'claude-PR-code-reviewer.md')` — and re-post the proper marker request to un-stick #829.

---

## 7. Migration plan (atomic flips, explicit rollback)

1. **Add `@packages/review-result`** (schema + render + `needsAutoFix` + `escapeModelText` + tests). No behavior change; not yet wired.
2. **Dual-emit:** the reviewer prompt emits the ` ```json ` findings block (wrapped in the `CLAUDE_REVIEW_FINDINGS_START/END` markers) *and* the legacy marker block. The listener's render step prefers the findings markers, salvages from the legacy block on failure (§4.5 rung 2). Observe the deviation rate in the telemetry issue.
3. **Atomic producer/trigger flip:** in **one** change, switch the posted comment to the workflow-rendered output **and** ensure exactly one routing path is live — the rendered comment keeps the count markers, so the existing `request-fix` trigger continues to fire; no second (artifact-based) route is added, so there is no double-fire. (This is why §3.5 keeps the trigger as-is rather than adding a parallel route.)
4. **Drop the legacy block** from `claude-PR-code-reviewer.md` only after the telemetry deviation rate is below the defined threshold for a defined window. Note: this removes the §4.5-rung-2 salvage net; steady state is rungs 1 + 3.
5. **Update `.github/workflows/CLAUDE.md`** to document the findings contract as the source of truth, and add a CODEOWNERS entry for `@packages/review-result`.

**Rollback:** each phase is a single revert. The risky phase is 4 (removes salvage); revert restores dual-emit and the legacy net in one commit.

---

## 8. Risks, open questions, consequences

> **Trust model.** The permission boundary is the `author_association` gate in `claude-listener.yml` — the run proceeds only for `OWNER`/`MEMBER`/`COLLABORATOR`. That gate is what makes "restricted to contributors" true, and the design trusts those contributors fully. The workflow-authored marker is **not** a security boundary; it is only the review-run *discriminator*. So the design adds no *new* authenticity controls — but it does not lack one either: if the gate is later loosened (e.g. to admit first-time contributors), the "contributors trusted fully" premise must be revisited.

**Risks & mitigations**
- *Model emits invalid JSON* → `.safeParse` + salvage (dual-emit) / bounded re-trigger (steady state); telemetry surfaces frequency.
- *Schema skew* → render runs in the listener at the **PR-head ref**, same as the prompt; consumer uses `schemaVersion <= N`, never `z.literal`, so a bump never bricks in-flight PRs.
- *Stale-commit race* → a `REVIEW_HEAD_SHA` marker compared to the live head in `request-fix`'s existing script step (§4.4).
- *Build/install failure in the render step* → fail **loud** (the run fails), never silently skip routing.
- *Re-trigger plumbing* (mechanism, not a security control) → every listener re-trigger must be posted via `PAT_TOKEN` — the `@claude` fix comment and the §4.5-rung-3 deviation re-request alike; a `GITHUB_TOKEN`-authored comment does not re-trigger the listener. Unchanged from today.

**Open questions for the reviewer**
1. **Telemetry sink shape:** a single long-lived tracking issue with appended rows (proposed) vs. a committed metrics file. Which, and what exact deviation-rate threshold + window gates §7.4?
2. **`review-deviation-attempt-N` cap** — pinned to **2** per PR, non-resetting within the PR, reset only on a later clean (parseable, zero-deviation) review (§4.5 rung 3). Open only for confirmation, since rung 3 is the loop's sole bound.
3. **Package boundary:** confirm `@packages/review-result` as a standalone nx project kept **out of** the hutch app's build/coverage graph (it is CI tooling — neither product `runtime` nor Pulumi `infra`; v0.1's "runtime, not infra" framing was a false dichotomy).

**Consequences**
- (+) Routing-critical counts are derived and the comment is workflow-rendered → model-agnostic routing; the threshold (`needsAutoFix`) and rendering are unit-tested (the dispatch-time staleness/cap check stays inline YAML); the per-PR serialization and 5× cap are preserved.
- (−) One render step + built artifact in the listener; a dual-emit migration window; the reviewer prompt's deliverable changes from a marker block to a JSON block; the IO glue in `auto-apply` stays untested YAML.

---

## Appendix — adversarial review findings that reshaped this ADR

A five-lens review of v0.1 produced 40+ grounded findings. The load-bearing corrections:

| v0.1 claim | Finding | v0.2 |
|---|---|---|
| Remove the trigger marker; "gate on the review task" | The listener is one generic `@claude` job; the marker is its *only*, and *workflow-authored*, review-run signal. Removing it is more model-fragile. | Marker kept (§3.1, §5). |
| Manual re-trigger "still routes" | #829 case 2 was a *bare* comment that never loaded the reviewer prompt → no findings → no route. | Scoped honestly (§6) + stop-gap. |
| Model writes `prNumber`/`headSha` | Re-introduces hand-typed-value bug; un-branded; `length(40)` hardcodes SHA-1. | Workflow-injected, branded, SHA-1/256 regex (§3.3, §4.1). |
| Workspace file as the data channel | Contradicts OQ2; transcript is the proven channel. | Transcript-only (§4.2). |
| Rewire `request-fix` onto `workflow_run` | Breaks per-PR serialization; relocates the 5× cap; no artifact in scope. | Trigger unchanged (§3.5, §4.4). |
| Fallback "reuses crash-retry + counter" | Neither fires for a succeeded-with-bad-JSON run. | New non-resetting deviation counter (§4.5 rung 3). |
| "Thin glue → call the module" | `auto-apply` has no checkout/node. | Render in the listener; IO glue stays YAML, honestly scoped (§4.3). |
| Telemetry "escalate on recurrence" | No recurrence store; circular migration gate. | Concrete sink + threshold (§3.7, §7.4, §8 OQ1). |
| `decideNext` ignores `headSha` | Stale-commit race left open. | Staleness guard added (§4.4); in v0.3 it runs in `request-fix`'s script step, not a combined `decideNext`. |
| `z.literal(1)` schemaVersion | Producer/consumer ref skew bricks PRs. | `<= N` + render-at-PR-head (§4.1, §8). |
| `@packages/ci-orchestration` | "No Design Pattern Names" violation; runtime/infra false dichotomy. | `@packages/review-result`, standalone CI-tooling project (§4.1, §8 OQ3). |

### v0.3 — corrections from the automated review pass

A two-pass automated review of v0.2 surfaced that every v0.2 fix was producer-side, leaving the **consumer** (`request-fix`) still carrying the model-format dependence. The load-bearing corrections:

| v0.2 gap | Finding | v0.3 |
|---|---|---|
| Counts derived, but `request-fix` still substring-matches markers over a body that also carries model `detail`/`summary` | A finding that quotes a count/START marker (e.g. a review of `claude-PR-code-reviewer.md`) suppresses or trips auto-fix | Render **escapes all model text**; markers are a render-only vocabulary (§3.5, §4.1). |
| `decideNext(findings, liveHead, attempts)` listed as tested | No job can run it: auto-apply has no node, and staleness/attempts are dispatch-time state | Decomposed: `needsAutoFix` (tested, render-time) + staleness/cap in `request-fix`'s script step (untested YAML, honestly scoped) (§4.3–§4.4). |
| Findings located by an unmarked code fence | A bare fence has no unique key; collides during dual-emit and with quoted JSON | Unique `CLAUDE_REVIEW_FINDINGS_START/END` marker pair, sliced like the legacy block (§3.2, §4.2). |
| Trust note: "no authenticity or permission controls" | Contradicts the `author_association` gate the "contributors trusted" premise rests on | Re-anchored on the `OWNER/MEMBER/COLLABORATOR` gate; marker demoted to discriminator only (§8). |
| `HeadSha` regex `/^[0-9a-f]{40,64}$/` | Admits invalid lengths 41–63 | `/^([0-9a-f]{40}\|[0-9a-f]{64})$/` (§4.1). |
| "model-agnostic … review-result" | Overclaims: findings are still model-authored | Title/§6 scope the claim to *routing*; findings are validated, still model-authored. |
| "100 % branch coverage, no `c8 ignore`" | The repo documents V8 phantoms as sometimes unavoidable | Softened to the repo coverage policy: minimize, annotate residuals with `bcoe/c8#319` (§4.3). |
| Rung-3 deviation re-trigger under-specified | Must be `PAT_TOKEN`-authored; cap is the loop's only bound | `PAT_TOKEN` stated; cap pinned to 2, reset on a clean review (§4.5, §8 OQ2). |
| #829 case 2 listed under "what this fixes" | The fix is the independent stop-gap, not this decision | Re-attributed to the stop-gap (§6). |
