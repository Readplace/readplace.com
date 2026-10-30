---
name: canary-analysis
description: Iteratively analyze and fix the highest-percentage causal categories in the failed-articles canary when the user requests that workflow. Excludes stuck articles and pipeline-health canaries.
---

# Failed-articles canary analysis

Follow [CLAUDE.md](../../../CLAUDE.md) and the [failed-articles investigation contract](../../../.github/workflows/failed-articles-canary.md). Ordinary automatic discovery remains enabled; discovering this skill alone authorizes no mutations. A user invocation requesting this workflow authorizes end-to-end fixes, tests, atomic commits on `main`, push, watching matching CI, production deployment and Visual Review, recrawl and content verification, and the snapshot close/rescan cycle below. Ask before adding product capabilities or expanding access.

This invocation's explicit close/rescan policy replaces **only** the investigation contract's manual-close instruction. Never edit issue bodies or comments, or send messages. Keep all other privacy and product constraints.

## Establish a bounded run

Before work on startup or resume, read [runtime controls](references/runtime.md) and use the native Ask facility to establish the ending trigger unless the user's instruction is already unambiguous. Finite criteria include a quota threshold, deadline/duration, N completed categories, or no actionable categories. Multiple selected limits apply with **OR** semantics. Only for a quota-based trigger, confirm actual quota bucket(s) and remaining versus used semantics: **25% remaining means 75% used**.

Persist confirmed scope and stop rules across resumes. A new invocation requires the user's choice of stop rule. On resume, revalidate outstanding obligations; never silently clear a latched trigger. **Only when the agreed trigger includes a quota threshold**, revalidate telemetry freshness and check authoritative quota before costly phases or agents and between categories. Missing, stale or unreliable quota telemetry then requires asking and **pausing**, even midcategory, with outstanding verification/rollback checkpointed. A timestamped user reading is manual evidence: ask anew at the next required quota checkpoint. Other stop rules require no quota telemetry or invented quota threshold.

Evaluate **all configured criteria** before and after costly phases, before handoffs, immediately before selecting a hypothesis, and after each category refresh. During long reasoning, check cooperatively at tool/evidence-batch boundaries; carry this obligation in every handoff. Use the current clock for deadline/duration, the ledger for completed-category count, reconciled dispositions for no actionable categories, and authoritative quota readings only when applicable.

When a trigger fires, latch it and start no new hypothesis or category. Finish the already-selected hypothesis, including implementation, delivery, verification or revert still required. This **wrap-up** ends only at a result: the change retained with its verified production outcome reported, or reverted with the revert delivered. "Shipped, verification pending" is a checkpoint, not a result. Do not stop there, and do not hand verification back to the user as the outcome. If no hypothesis has been selected, checkpoint/report a diagnosis-only deferred exit without starting an experiment: award no completed-category credit and do not close/rescan solely for that deferred diagnosis. User **STOP** has this same meaning; an explicit **stop immediately** overrides it and requires an immediate checkpoint. Hard limits or access loss may prevent cleanup: record rollback-required, never imply a clean exit, and resume cleanup before new work.

## Runtime roles and private checkpoint

Resolve supported model IDs at runtime; use available delegation or switch facilities with a self-contained evidence brief. Per-category reasoning, RCA, acceptance design and verification judgment use Claude **Fable at default effort**, with **Opus Max** already authorized when Fable is unavailable, or Codex **Astra**. Code, tests and reverts use Claude **Opus 5.5 medium** or Codex **Sol**. Respect a narrower user selection; ask if no authorized model or required facility is available, rather than silently substituting. See the runtime reference for quota and handoff details.

The parent runs only one heavy check at a time, after checking local sessions and self-hosted runners are idle. Never delegate a full check or a commit that fires its hook. Follow repository checks and hook policy; do not bypass hooks.

Resolve the Git common directory with `git rev-parse --git-common-dir` (relative output is relative to the current directory). Store a durable private ledger in a run subdirectory there, never in `/tmp` or tracked logs. Persist before every handoff, mutation and pause:

- Baseline and current unique article identities; run/issue links; changing report row-number mappings; baseline, new and regressed cohorts separately.
- Category evidence, primary cause, independent per-axis status, hypothesis/attempt, frozen affected cohort and acceptance criteria, before/after observations.
- Commit and deployment revisions; verification, partial-revert dependencies, rollback and refresh obligations; next action.
- Confirmed scope, stop rule and quota bucket(s), source/metric/time, freshness assessment and persistent trigger latch.

Keep identities and raw evidence local. Never publish reader URLs, IDs, tokens or raw logs in issues, commits, output or public tools. Production rows must never pass through public Actions or `@claude` tools. Public summaries use aggregate evidence and report row numbers scoped to their snapshot.

## Shared attempt history

Read [results.md](references/results.md) on every startup or resume and before selecting a hypothesis. For a matching category or approach, read the linked attempt and revert commits and any available private checkpoint. Do not repeat an approach unless new evidence addresses its recorded failure or blocker; record what changed in the private ledger first. Local-only and blocked attempts are not disproven fixes.

Update that file after each attempt's disposition or significant verification/revert update, and before handoff or exit. Keep one concise Markdown table row per attempt, preserving earlier attempts when trying a different approach. Group rows by run/date and state each run's recovery denominator. Use the five-column format below. In `Commit(s)`, link the original attempt and explicitly state whether it was reverted, linking the revert when present; identify uncommitted work as such. In `Verified outcome`, state the result, reason and significant learning in plain text.

Keep detailed rationale, implementation and validation in the original attempt and revert commit messages, with private evidence in the run ledger. For uncommitted attempts, preserve the detailed record and any reusable patch privately. Keep the shared table public-safe; do not copy raw evidence into it.

## Build and rank the worklist

Read the latest relevant tracking issue, its admin report and current production state locally. Discover the workflow by the exact name **Failed articles canary** and tracking marker `<!-- CLAUDE_FAILED_ARTICLES_FIX -->`. Its zero exit code means the worklist command completed, not that no failures exist. An open marked tracking issue makes the workflow skip scanning.

Assign one primary causal category to each unique unresolved article; retain secondary independent axes. A summary failure caused by the crawl is not another article. Use all current unresolved articles, including blocked ones, as the denominator; report count and percentage, select the largest actionable category, and break ties by oldest affected article. Establish real causes from evidence: heterogeneous reason labels can share a cause, and `parse-error` alone is not an RCA. Keep unknown causes separate; do not invent causes or exact population percentages from samples.

Re-rank after every disposition. A repaired crawl can expose an independent summary category. Preserve baseline versus new/regressed counts. Pareto ranking prioritizes recovery; a flat distribution is not the goal.

## Complete one category

1. Apply the mandatory [crawl-pipeline-rca skill](../../../.claude/skills/crawl-pipeline-rca/SKILL.md) to **each** category, loading it when not already in the assigned reasoning agent's context. Read stored reasons first, then logs; trace the actual affected entry path, every hop, terminal-state writer and deployed retry budget. Discover implementation by behavior/contracts, not guessed names. Read [test-driven-design](../../../.claude/skills/test-driven-design/SKILL.md) and [git-commit](../../../.claude/skills/git-commit/SKILL.md); conditionally read [infrastructure-design](../../../.claude/skills/infrastructure-design/SKILL.md), [web](../../../.claude/skills/web/SKILL.md) or [e2e-testing](../../../.claude/skills/e2e-testing/SKILL.md) when relevant. Use this existing `.claude/skills/canary-analysis` directory and resolve documentation links from here. Read only relevant skills.
2. Freeze the affected cohort and acceptance criteria before changing anything. Pursue one isolated, evidenced hypothesis at a time; create a meaningful regression and minimal fix. Do not retry the same hypothesis without new evidence. Record blocked, unsupported, inaccessible, unverified and ineffective outcomes separately, with evidence and a revisit condition. Incomplete or inconclusive verification is **not** unfixability.
3. Have the implementation role write code/tests; the parent runs prescribed checks and commits atomically to `main`. Push and watch CI, production deployment and Visual Review for the **exact commit**, resolving failures before claiming delivery. Do not credit support plumbing as an independent recovery.
4. Before a production attempt, discover the deployed retry, polling and end-to-end budget and set a bounded verification window. Secure the access that verification needs, such as an admin session for the recrawl page, while CI runs, not after deployment: a recrawl blocked on sign-in stalls wrap-up. Inspect a fresh recrawl through the actual affected path. Compare actual canonical, rendered and hosted content to the intended source. Verify **every** claimed recovered row, without extrapolation. `ready`, HTTP 200, old content or report disappearance alone proves nothing. Depending on the failure, check original image bytes, completeness, text formatting, ordered collections, mail links or definitions. Track crawl recovery, summary recovery, full recovery and legitimate unsupported/skipped outcomes separately.
5. Before moving on, revert experiments with zero **or unproven** verified benefit. Preserve a proven partial fix and its necessary dependencies using a narrow partial revert. Use forward revert commits, never history rewriting. Run checks, verify matching deployment and regression outcomes after reverts, including partial reverts. Leave no ineffective experimental code on `main`. If cleanup cannot finish, checkpoint rollback-required visibly; cleanup precedes any new work.

## Replace the tracking snapshot

Complete a category by recording a verified fix, completed rollback, or evidenced reported disposition (unfixable, blocked, unsupported, inaccessible or unverified), then performing one snapshot refresh and reconciliation. Unverified experiments still require the cleanup above. After recording the disposition, persist the ledger, close the current tracking snapshot, and dispatch a fresh failed-articles scan. Closing with unresolved articles is authorized here specifically to replace the snapshot, not to claim recovery. Carry every unresolved identity forward, including articles omitted by the report. Preserve dispositions and revisit conditions across snapshots: unchanged blocked rows do not justify another attempt or increment the completed-category count again. Count a category once per genuinely new completed disposition, not once per appearance in a report.

Verify that a real scan executed and link its run and resulting issue. A skipped or failed run is not fresh evidence: checkpoint the refresh failure and investigate without a dispatch storm. Zero rows is meaningful only after an actual scan; reconcile stable identities against current production. Absence is never recovery evidence. Never weaken excludes, lookback, the scan's page cap (the `pagination cap reached` assert in the project with the `check-failed-articles` target) or outcome classification to quiet the canary. When only blocked categories remain, report and stop rather than starting more categories.

## Every exit

On success, limits, user stop, blocked or interrupted work, persist the checkpoint, update [results.md](references/results.md), and provide the same public-safe, commit-linked attempt rows:

| Category | Fix retained | Commit(s) | Verified outcome | Recovery share |
|---|---|---|---|---|

State the denominator of **unique verified recovered articles**, attributing each article once. Report later second-axis recoveries without duplicate credit; distinguish fully recovered from partial recovery and supported terminal classifications. With zero verified recoveries, use `n/a` shares. Do not convert legitimate unsupported/skipped classifications into content-recovery credit.

Use one row per attempt for retained and reverted work, including the reason, significant learning and any revisit condition. Briefly state the stop reason, last metric and timestamp, checkpoint location, and pending deployments, verification, refresh or cleanup. If interrupted before a commit, say so explicitly. Report only verified outcomes, with the limits of the evidence.
