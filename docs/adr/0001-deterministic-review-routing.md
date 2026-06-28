# ADR 0001 — Deterministic, model-agnostic review-result contract

- **Status:** Proposed (review-only — this PR is a draft and is not intended to merge as-is).
- **Decision drivers:** future-proof the PR automation against model changes and prompt drift, remove manual intervention, align the CI automation with the repo's own engineering standards.
- **Relates to:** the marker contract documented in [`.github/workflows/CLAUDE.md`](../../.github/workflows/CLAUDE.md).

> **Revision note (v0.2).** v0.1 proposed *removing* the `<!-- CLAUDE_REVIEW_REQUEST -->` trigger marker and moving routing onto the `workflow_run` path. A five-lens adversarial review (GH-Actions mechanics, failure-modes/loops, repo-conventions, migration safety, completeness) found that unsound and it has been corrected. The marker is **workflow-authored** (by `claude-PR-code-reviewer.yml`), not model prose — removing it would make review-run detection *more* model-dependent and would not fix the incident. This version keeps the marker and narrows the change to the one genuinely fragile thing: **the prose count contract the model hand-writes.** The findings that reshaped this doc are summarized in the appendix.

---

## 1. Context

### 1.1 The incident (corrected attribution)

PR #829's review ran successfully but auto-apply never fired. Verified against the GitHub API, there were **two distinct breaks on two attempts**:

1. **06-26 — listener crashed (infra).** The code-reviewer posted the proper review request (marker present), but the listener run hit the agent-SDK `#852` startup crash. The artifact step is gated on `steps.claude.outcome == 'success'`, so it was skipped. This is `claude-PR-crash-retry.yml`'s job; that it was not recovered (crash exceeded the ≤240 s window or exhausted its 4 attempts) is a **crash-retry gap, not a contract failure** — out of scope for this ADR.
2. **06-28 — human bare re-trigger (routing).** A human typed a bare `@claude Review this PR…` that contained **neither** the `<!-- CLAUDE_REVIEW_REQUEST -->` marker **nor** a pointer to `claude-PR-code-reviewer.md`. The run succeeded (2 medium issues) but, lacking the marker, the artifact step was skipped again → no artifact → `post-review-comment` logged `nothing to do`.

Two things are worth separating cleanly, because v0.1 conflated them:

- **The marker is workflow-authored and is doing its job.** On the automated path, `claude-PR-code-reviewer.yml` always emits it. It is both the review-run discriminator *and* an authenticity binding (only a workflow-initiated review carries it).
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

Out of scope (handled elsewhere, named here to avoid re-conflation): the crash/success-gate path (`crash-retry`) and the bare manual re-trigger that never loads the reviewer prompt (§6).

---

## 3. Decision

**Keep the workflow-authored marker; replace only the model-authored prose-count contract with a schema-validated findings object; render the routing-critical comment deterministically.**

1. **Keep `<!-- CLAUDE_REVIEW_REQUEST -->` as the workflow-authored review-run + authenticity gate.** It is emitted by `claude-PR-code-reviewer.yml`, not the model. The upload/render step stays gated on it. *(Reverses v0.1.)*
2. **Model emits findings as JSON in its final message; counts are derived.** The review's deliverable becomes a single fenced ` ```json ` block carrying `high/medium/low/summary` only — captured by the already-uploaded `execution_file` transcript (the proven channel). `highCount = high.length`; the model never types a count.
3. **The workflow injects identity; the model never authors it.** `prNumber`, `headSha`, `runId` come from GH context (event payload / artifact name / run id), validated and **branded** per repo standard. The model-authored payload carries no identifiers.
4. **A tested module renders the comment, run inside the listener.** The listener already checks out the **PR head** and has the Node/pnpm toolchain, so the render module runs at the *same ref as the prompt that produced the JSON* — eliminating producer/consumer schema skew. It parses+validates the transcript JSON (zod `.safeParse`), renders the deterministic review comment (including the derived `HIGH/MEDIUM_PRIORITY_COUNT` markers), and uploads the **rendered comment** as the artifact. `post-review-comment` posts it verbatim.
5. **The existing comment-triggered `request-fix` is unchanged.** Because the posted comment is now workflow-rendered with *derived* counts, the existing `issue_comment` trigger (`CLAUDE_REVIEW_START` + non-zero count) becomes deterministic **with zero rewire**. The per-PR concurrency group and the `MAX_AUTO_FIX_ATTEMPTS = 5` cap stay exactly where they are. *(Reverses v0.1's `workflow_run` rewire.)*
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
const HeadSha = z.string().regex(/^[0-9a-f]{40,64}$/).brand<"HeadSha">(); // admits SHA-1 and SHA-256
const RunId = z.number().int().positive().brand<"RunId">();

export const needsAutoFix = (f: ReviewFindings) => f.high.length + f.medium.length > 0;
```

`decideNext` is defined **in terms of** `needsAutoFix` (single source of the threshold), and additionally takes the PR's live head + attempt-label state, because the real routing decision depends on staleness and attempt count, not findings alone (§4.4).

### 4.2 Data channel: the transcript, not a workspace file

The model emits the ` ```json ` findings block as its **final message**. The listener already uploads `steps.claude.outputs.execution_file` — the action-guaranteed transcript — so no new "did the agent write a file to disk" dependency is introduced. The render module extracts the fenced block from the transcript messages (the same slice `post-review-comment` does today for the legacy block) and `.safeParse`s it. This resolves v0.1's internal contradiction (committing to a workspace file while doubting it works).

### 4.3 Where the logic lives (and what stays untested YAML)

- **Tested module** (`@packages/review-result`, covered by `pnpm check`): `parseFindings(transcript) → Result<ReviewFindings, Deviation>`, `renderReviewComment(findings, identity) → string`, `decideNext(findings, liveHead, attempts) → Route`. Pure, fixture-tested, 100 % branch coverage incl. the optional `file`/`line` and empty-section branches (no `c8 ignore`).
- **Listener glue (YAML, review-run branch only, gated on the marker):** one `node` step that runs the built module over `execution_file`, writes `review-comment.md`, and uploads it. The listener already has checkout + node + pnpm, so no new heavy setup is added to the artifact-only `auto-apply` job.
- **`post-review-comment` (YAML):** downloads `review-comment.md` and posts it verbatim. Honestly scoped: the artifact-download / `createComment` IO glue **remains untested YAML** — the win is that the *decision and rendering* are now covered, not that all YAML disappears.

### 4.4 Routing — unchanged trigger, with a staleness guard

`request-fix` keeps firing on the workflow-rendered comment (now deterministic). The one addition: before honoring it, compare the review's `headSha` to the live PR head (`pulls.get().head.sha`); if stale, no-op (a newer review supersedes it). This closes the force-push / concurrent-run race that v0.1 left open while carrying `headSha` unused.

### 4.5 Fallback ladder (steady state is two rungs; salvage is dual-emit-only)

1. **Valid JSON** → render + route. Zero LLM round-trips.
2. **Dual-emit window only:** invalid/absent JSON → salvage the legacy `CLAUDE_REVIEW_START…END` block from the transcript (today's behavior) and render from it. **This rung disappears once §7.4 removes the legacy block** — stated explicitly so it is not mistaken for a durable net.
3. **No usable result** → append a deviation row (telemetry), bump a dedicated **non-resetting** `review-deviation-attempt-N` label, and re-post a fresh `<!-- CLAUDE_REVIEW_REQUEST -->` review request (a *new* mechanism — crash-retry and `auto-fix-attempt-N` provably cannot fire for a succeeded-with-bad-JSON run). At the cap → human escalation. Never silent.

---

## 5. Alternatives considered (and rejected)

| Alternative | Why rejected |
|---|---|
| **Remove the `CLAUDE_REVIEW_REQUEST` trigger marker** (v0.1) | It is workflow-authored, not model prose; it is also the authenticity binding. Removing it makes review-run detection depend on the model writing a file — strictly *more* model-fragile, and it lets any privileged `@claude` run masquerade as a review. |
| **Rewire `request-fix` onto the `workflow_run` path** (v0.1) | Breaks the documented per-PR concurrency-group serialization, relocates the 5× cap, and the comment-triggered job has no artifact in scope. Once the comment is workflow-rendered, the existing trigger is already deterministic — zero rewire needed. |
| **Model writes `prNumber`/`headSha` into the JSON** (v0.1) | Re-introduces the hand-typed-value bug the ADR deletes; the workflow already holds these authoritatively. Inject + brand them instead. |
| **Ask the model to "correct" a malformed comment** | Re-introduces the dependency being deleted; loops. Deterministic render makes a malformed routing comment unrepresentable. |
| **Auto-RCA + auto-open a fix on every deviation** | Noise/cost; a second LLM call on the happy path. Kept as telemetry, escalated on recurrence. |
| **Rewrite all four hops into one orchestrator** | Three already route deterministically. Out of scope. |

---

## 6. What this fixes, honestly

- **Fixes (the count-trust class):** a new model, reworded prompt, or sticky-comment channel can no longer drop or mis-state the routing-critical counts — they are derived from validated findings and the comment is workflow-rendered. This is the durable, model-agnostic win.
- **Does NOT fix, by itself:**
  - #829 **case 1** (listener crash) — orthogonal; owned by `claude-PR-crash-retry`. Residual dependency on its ≤240 s / 4-attempt bounds remains.
  - #829 **case 2** (bare manual re-trigger that never loads the reviewer prompt) — the agent writes no findings, so nothing routes. The honest fixes are (a) the **stop-gap** below, and (b) documenting the canonical re-trigger (re-run the failed listener run, or comment via the code-reviewer's exact marker-bearing format). This ADR does not claim to make an arbitrary free-form comment route.

**Independent stop-gap (ship anytime, no dependency on this ADR):** broaden the artifact gate to also accept a manual re-trigger that references the reviewer prompt — `contains(body,'CLAUDE_REVIEW_REQUEST') || contains(body,'claude-PR-code-reviewer.md')` — and re-post the proper marker request to un-stick #829.

---

## 7. Migration plan (atomic flips, explicit rollback)

1. **Add `@packages/review-result`** (schema + render + decide + tests). No behavior change; not yet wired.
2. **Dual-emit:** the reviewer prompt emits the ` ```json ` findings block *and* the legacy marker block. The listener's render step prefers JSON, salvages from the legacy block on failure (§4.5 rung 2). Observe the deviation rate in the telemetry issue.
3. **Atomic producer/trigger flip:** in **one** change, switch the posted comment to the workflow-rendered output **and** ensure exactly one routing path is live — the rendered comment keeps the count markers, so the existing `request-fix` trigger continues to fire; no second (artifact-based) route is added, so there is no double-fire. (This is why §3.5 keeps the trigger as-is rather than adding a parallel route.)
4. **Drop the legacy block** from `claude-PR-code-reviewer.md` only after the telemetry deviation rate is below the defined threshold for a defined window. Note: this removes the §4.5-rung-2 salvage net; steady state is rungs 1 + 3.
5. **Update `.github/workflows/CLAUDE.md`** to document the findings contract as the source of truth, and add a CODEOWNERS entry for `@packages/review-result`.

**Rollback:** each phase is a single revert. The risky phase is 4 (removes salvage); revert restores dual-emit and the legacy net in one commit.

---

## 8. Security, risks, open questions, consequences

**Security / permissions** (was absent in v0.1): the workflow-authored marker is retained partly as an **authenticity** gate — only a workflow-initiated review carries it, and the render step stays gated on it, so a privileged-but-careless `@claude` comment cannot fabricate a review that drives an auto-fix. The `@claude` fix re-trigger must keep posting via `PAT_TOKEN` (a `GITHUB_TOKEN`-authored comment does not re-trigger the listener). Trigger eligibility stays bound to the `OWNER/MEMBER/COLLABORATOR` `author_association` gate in `claude-listener.yml`.

**Risks & mitigations**
- *Model emits invalid JSON* → `.safeParse` + salvage (dual-emit) / bounded re-trigger (steady state); telemetry surfaces frequency.
- *Schema skew* → render runs in the listener at the **PR-head ref**, same as the prompt; consumer uses `schemaVersion <= N`, never `z.literal`, so a bump never bricks in-flight PRs.
- *Stale-commit race* → `headSha` staleness guard in `decideNext` (§4.4).
- *Build/install failure in the render step* → fail **loud** (the run fails), never silently skip routing.

**Open questions for the reviewer**
1. **Telemetry sink shape:** a single long-lived tracking issue with appended rows (proposed) vs. a committed metrics file. Which, and what exact deviation-rate threshold + window gates §7.4?
2. **`review-deviation-attempt-N` cap value** and its reset rule (proposed: non-resetting per PR; reset only on a clean green review).
3. **Package boundary:** confirm `@packages/review-result` as a standalone nx project kept **out of** the hutch app's build/coverage graph (it is CI tooling — neither product `runtime` nor Pulumi `infra`; v0.1's "runtime, not infra" framing was a false dichotomy).

**Consequences**
- (+) Routing-critical counts are derived and the comment is workflow-rendered → model-agnostic; the decision/rendering is unit-tested; the per-PR serialization, 5× cap, and authenticity gate are preserved.
- (−) One render step + built artifact in the listener; a dual-emit migration window; the reviewer prompt's deliverable changes from a marker block to a JSON block; the IO glue in `auto-apply` stays untested YAML.

---

## Appendix — adversarial review findings that reshaped this ADR

A five-lens review of v0.1 produced 40+ grounded findings. The load-bearing corrections:

| v0.1 claim | Finding | v0.2 |
|---|---|---|
| Remove the trigger marker; "gate on the review task" | The listener is one generic `@claude` job; the marker is its *only*, and *workflow-authored*, review-run signal. Removing it is more model-fragile and breaks authenticity. | Marker kept (§3.1, §5, §8). |
| Manual re-trigger "still routes" | #829 case 2 was a *bare* comment that never loaded the reviewer prompt → no findings → no route. | Scoped honestly (§6) + stop-gap. |
| Model writes `prNumber`/`headSha` | Re-introduces hand-typed-value bug; un-branded; `length(40)` hardcodes SHA-1. | Workflow-injected, branded, SHA-1/256 regex (§3.3, §4.1). |
| Workspace file as the data channel | Contradicts OQ2; transcript is the proven channel. | Transcript-only (§4.2). |
| Rewire `request-fix` onto `workflow_run` | Breaks per-PR serialization; relocates the 5× cap; no artifact in scope. | Trigger unchanged (§3.5, §4.4). |
| Fallback "reuses crash-retry + counter" | Neither fires for a succeeded-with-bad-JSON run. | New non-resetting deviation counter (§4.5 rung 3). |
| "Thin glue → call the module" | `auto-apply` has no checkout/node. | Render in the listener; IO glue stays YAML, honestly scoped (§4.3). |
| Telemetry "escalate on recurrence" | No recurrence store; circular migration gate. | Concrete sink + threshold (§3.7, §7.4, §8 OQ1). |
| `decideNext` ignores `headSha` | Stale-commit race left open. | Staleness guard (§4.4). |
| `z.literal(1)` schemaVersion | Producer/consumer ref skew bricks PRs. | `<= N` + render-at-PR-head (§4.1, §8). |
| `@packages/ci-orchestration` | "No Design Pattern Names" violation; runtime/infra false dichotomy. | `@packages/review-result`, standalone CI-tooling project (§4.1, §8 OQ3). |
