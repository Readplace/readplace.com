# Stuck Articles Canary Failure Investigation

You have been triggered because the `Stuck articles canary` workflow failed on its scheduled run. One or more articles in the production DynamoDB articles table are owed a manual retry — `summaryStatus`/`crawlStatus` is `pending` (worker never produced a terminal outcome), or `summaryStatus = "skipped"` with reason `ai-unavailable` (AI was down and no auto-heal fires for `skipped`).

## Your Task

1. **Read the issue body and any follow-up comments.** Each stuck row is listed as `[<reasons>] <url> — fetched: <ts>; failure: <reason>; recrawl: <admin-url>`. The reasons map to:
   - `summary-pending` / `crawl-pending` — the worker never produced a terminal outcome on that axis.
   - `summary-pending-after-aggregate-migration` / `crawl-pending-after-aggregate-migration` — same as above but the latest writer was a Phase 2 cross-axis transition that was supposed to flip both axes to terminal.
   - `summary-skipped-ai-unavailable` — the summariser recorded the AI as down at the time the summary ran. The handler treats `skipped` as terminal and never re-runs, and the auto-heal only fires for `failed` rows — so the only recovery is a manual recrawl via the `/admin/recrawl/<url>` link in the row.
2. **Find the change that introduced the state.** Run `git log --since='14 days ago' --format='%h %s'` and inspect commits touching:
   - `projects/save-link/src/generate-summary/**` (summary state machine)
   - `projects/save-link/src/article-crawl/**` and `projects/hutch/src/runtime/providers/article-crawl/**` (crawl state machine)
   - `projects/hutch/src/runtime/providers/article-summary/**`
   - `src/packages/article-state-types/**` (the shared schema)
   - `src/packages/check-stuck-articles/scripts/classify-row.ts` (the classifier itself)

   The classifier is exhaustive over the shared status enums, so a *new* status added without a classifier branch would have failed `tsc --noEmit` in CI. Suspect upstream changes first: a worker that publishes to a wrong queue, a Lambda role that lost an IAM grant, an event that no longer arrives, etc.
3. **Propose 2-3 concrete fix options** as a comment on this issue. Distinguish:
   - **Data fix** — recrawl or delete the stuck rows (the recrawl URLs are in the issue body). This addresses the symptom only.
   - **Code fix** — the bug that produced the stuck rows. This is the root cause.
4. **If a code fix is the right path, open a draft PR** with:
   - The fix.
   - A report covering the stuck rows, the introducing commit, why the fix addresses the root cause, and how to data-fix the existing stuck rows.
5. **Edit the issue body to remove the `@claude` mention** after you respond. The next scheduled run will post a fresh comment with `@claude` if the canary is still red — that is what should re-trigger this workflow, not your own edits.

## Important Guidelines

- Follow ALL CLAUDE.md guidelines.
- **The issue body only lists rows whose URL still resolves on the public network.** `src/packages/check-stuck-articles/scripts/check-reachable.ts` runs a HEAD probe per stuck row and drops rows whose `fetch()` throws (DNS failure, TCP refused, TLS error, timeout). Do not propose "the URL is dead, exclude it" as a fix — that path is already handled and the row would not have reached you. A row that *does* reach you got an HTTP response from its origin; the bug is somewhere between that response and the row's terminal state.
- **Never edit `src/packages/check-stuck-articles/scripts/exclude-patterns.ts` to make the canary green.** Every entry is a class of URL that is genuinely never a real article (own-domain pages, browser-internal URLs, the AWS console). Adding a real article URL there silently hides the regression and tomorrow's cron passes for the wrong reason.
- **Never lower the pagination cap or remove the `assert` in `collectStuckRows`.** The cap exists to fail loud on a runaway scan.
- Do not change `EXPRESSION_ATTRIBUTE_VALUES`, `FilterExpression`, or `classifyRow` unless the prod state machines actually changed. The canary is the contract — drift it only when production schema drifts.

## Applicable Skills

- **git-commit** (`.claude/skills/git-commit/SKILL.md`) — Conventional Commits format for any fix commit.
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`) — when the fix touches the state machines or the classifier.
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`) — the primary methodology for this canary: rows stuck non-terminal in a command → event → handler chain. Use it to locate the missing terminal-state write rather than treating the symptom on the stuck rows.
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`) — when the root cause is an IAM grant, EventBridge rule, SQS binding, or other Pulumi-managed wiring.
