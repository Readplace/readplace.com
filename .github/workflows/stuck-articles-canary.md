# Stuck Articles Canary Failure Investigation

You have been triggered because the `Stuck articles canary` workflow failed on its scheduled run. One or more articles in the production DynamoDB articles table are owed a manual retry — `summaryStatus`/`crawlStatus` is `pending` (worker never produced a terminal outcome), or `summaryStatus = "skipped"` with reason `ai-unavailable` (AI was down and no auto-heal fires for `skipped`).

## Your Task

1. **Read the issue body and any follow-up comments.** Each stuck row is listed as `[<reasons>] <url> — fetched: <ts>; failure: <reason>; recrawl: <admin-url>`. The reasons map to:
   - `summary-pending` / `crawl-pending` — the worker never produced a terminal outcome on that axis.
   - `summary-pending-after-aggregate-migration` / `crawl-pending-after-aggregate-migration` — same as above but the latest writer was a Phase 2 cross-axis transition that was supposed to flip both axes to terminal.
   - `summary-skipped-ai-unavailable` — the summariser recorded the AI as down at the time the summary ran. The handler treats `skipped` as terminal and never re-runs, and the auto-heal only fires for `failed` rows — so the only recovery is a manual recrawl via the `/admin/recrawl/<url>` link in the row.

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
