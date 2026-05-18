# Failed Articles Canary Investigation

You have been triggered because the `Failed articles canary` workflow surfaced one or more articles in the production DynamoDB articles table whose state machines reached a **terminal but unsuccessful** outcome:

- `crawlStatus = failed` — crawl exhausted its retry chain and the DLQ handler flipped the row.
- `crawlStatus = unsupported` — crawler refused the URL (e.g., non-HTML content type, blocked by a content gate).
- `summaryStatus = failed` — summary generation exhausted its retries (likely DeepSeek or an upstream LLM error).

`summaryStatus = skipped` is NOT a failure — the summary worker intentionally decided not to produce a summary (content too short, crawl failed first, etc.). The canary treats it as a successful terminal outcome and does not surface rows whose only non-ready axis is summary-skipped.

This canary is a **debug worklist**, not a pass/fail health check. The script always exits 0; a non-empty report means real customer URLs were dropped and the operator wants to investigate each one.

## Your Task

1. **Read the issue body.** Each failed row is listed as `[<axes>] <url> — <axis>: <stored reason>; saved: <ts>; fetched: <ts>; recrawl: <admin-url>`. The axes tell you which state machine terminated unsuccessfully.

2. **Group by root cause.** Multiple rows usually share the same cause — a single Cloudflare fingerprint change can fail hundreds of URLs. Cluster the list before recommending fixes:
   - By **failure-reason kind** (`http-error:403`, `non-html-content:application/pdf`, `exhausted-retries`, `crawl-failed`, etc.).
   - By **host/domain** (`medium.com`, `substack.com`, `nytimes.com`).
   - By **axis** (crawl vs summary).

3. **For each cluster, propose a fix.** Distinguish:
   - **Crawler fix** — the most common case. The crawler couldn't handle a URL class. Check `src/packages/crawl-article/` and the [crawler health canary sources](../../src/packages/crawl-article/scripts/health-sources.ts) — a new failure pattern may warrant a new canary source entry.
   - **Summary fix** — `summaryStatus=failed` on a row whose `crawlStatus=ready` means the summary worker (`projects/hutch/src/runtime/providers/article-summary/`) couldn't process valid content. Check token caps, DeepSeek availability, prompt size.
   - **Operator exclude** — if a URL class is genuinely unsupported by design (e.g., authenticated content, video-only pages), the right action is to add an entry to `src/packages/check-failed-articles/scripts/exclude-patterns.ts` AND to ensure intake (`SaveableUrlSchema` in the domain package) rejects new ones if applicable. **Never** add a fixable URL to the exclude list to make the canary quiet.
   - **Data fix** — recrawl individual rows via the recrawl URL in the issue body. The operator does this manually; do not bulk-recrawl from a PR.

4. **Open a draft PR** if a code fix is the right path, with:
   - The fix.
   - A report covering the failed rows you addressed, the root cause cluster, why the fix resolves it, and whether the operator should recrawl the existing rows.

5. **Do not edit the issue.** This canary's workflow skips its scheduled scan while an open tracking issue exists — the operator closes the issue manually once they have worked through the backlog. Closing is the operator's signal that the worklist is processed.

## Important Guidelines

- Follow ALL CLAUDE.md guidelines.
- **The stored `failed` / `unsupported` reason strings on each row are the most direct signal of root cause.** Read them before reaching for logs. The schemas live in `src/packages/article-state-types/` (`CrawlFailureReasonSchema`, `CrawlUnsupportedReasonSchema`, `SummaryFailureReasonSchema`).
- **Never edit `src/packages/check-failed-articles/scripts/exclude-patterns.ts` to make the canary quiet.** Each entry must represent a class of URL that is genuinely unsupported by product policy. Adding a fixable failure URL silently hides the regression and tomorrow's cron emits a shorter (misleading) list.
- **Never raise `FAILED_ARTICLES_LOOKBACK_DAYS` to hide a backlog.** That env var is for the operator to narrow the worklist once the historical tail is processed, not a way to make the next scan smaller without doing the work.
- **Never lower `MAX_PAGES` in `collect-failed-rows.ts`.** The cap exists to fail loud on a runaway scan.

## Applicable Skills

- **git-commit** (`.claude/skills/git-commit/SKILL.md`) — Conventional Commits format for any fix commit.
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`) — when the fix touches the crawl/summary state machines.
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`) — for diagnosing the command → event → handler chain that produced a `failed` terminal state.
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`) — when the root cause is an IAM grant, EventBridge rule, SQS binding, or other Pulumi-managed wiring.
