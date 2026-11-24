# Failed Articles Canary Investigation

You have been triggered because the `Failed articles canary` workflow surfaced one or more articles in the production DynamoDB articles table whose state machines reached a **terminal error** outcome:

- `crawlStatus = failed` — crawl exhausted its retry chain and the DLQ handler flipped the row.
- `summaryStatus = failed` — summary generation exhausted its retries (likely DeepSeek or an upstream LLM error).

`crawlStatus = unsupported` and `summaryStatus = skipped` are NOT failures — they are complete, *supported* terminal outcomes, and the canary does not surface them. `unsupported` is a deliberate determination that the URL is a content type the product does not render (e.g., an image); `skipped` is the summary worker intentionally producing no summary (content too short, crawl failed first, etc.). The canary derives this split from `classifyCrawlOutcome` / `classifySummaryOutcome` in `src/packages/article-state-types/`.

This canary produces a **debug worklist**. A successful scan can find failed articles for the operator to investigate.

Only articles with a recorded full-processing admission for the latest attempt qualify. Deferred-only imports and unverifiable history are excluded. Summary failures hidden by the reader are excluded.

## Exact-key exceptions

The initial list covers 197 articles from [#1456](https://github.com/Readplace/readplace.com/issues/1456). It includes 62 login, share, subscription or account pages, 56 apps, indexes, storefronts, profiles or other non-article destinations, 40 access refusals or challenges, and 39 redirect notices. A new article in any of these groups remains eligible for the report unless its own key is added.

Keep the canonical JSON array in private storage. For each individually approved article, add the lowercase SHA-256 hex digest of the raw DynamoDB `url` key encoded as UTF-8, preserving the key's case and every character. Use the physical key as stored, without formatting it as a URL or substituting `originalUrl`. Keep the entries unique and read the keys in a private local session.

The scan requires `FAILED_ARTICLES_IGNORED_KEY_HASHES`. Use `[]` for an intentionally empty list. For a local run, set `ignored_key_hashes_file` to the path of the private JSON file. Use the same environment variable alongside the usual canary settings.

```sh
FAILED_ARTICLES_IGNORED_KEY_HASHES="$(cat "$ignored_key_hashes_file")" \
  pnpm nx run @packages/check-failed-articles:check-failed-articles
```

GitHub Actions secrets are write-only. After updating the private copy, replace the full secret in the `prod` environment from that file.

```sh
gh secret set FAILED_ARTICLES_IGNORED_KEY_HASHES --env prod < "$ignored_key_hashes_file"
```

## Your Task

1. **Read the issue, then its report.** The issue shows totals by recorded access, failure axis and stored-reason kind, plus a **Report (admins only)** link. The admin report shows each row's access group, URL, axes, stored reason, saved and fetched times and Recrawl button. Older reports may lack the access group. The axes tell you which state machine terminated unsuccessfully.

2. **Group by root cause.** Multiple rows usually share the same cause — a single Cloudflare fingerprint change can fail hundreds of URLs. Cluster the report's rows before recommending fixes:
   - By **failure-reason kind** (`http-error:403`, `non-html-content:application/pdf`, `exhausted-retries`, `crawl-failed`, etc.).
   - By **host/domain** (`medium.com`, `substack.com`, `nytimes.com`).
   - By **axis** (crawl vs summary).
   - By **recorded access** across saves of the same article. The reader-open group counts each article once when either the signed-in reader or the public reader was confirmed before the latest processing admission, or a signed-in reader request directly triggered that admission. The issue shows both route counts and their overlap. The admin report shows the confirmed routes on each row. A readlist-triggered admission with sufficient evidence and no confirmed reader open belongs to the readlist group. Rows with inconclusive history go under other or unknown. Opening the signed-in reader on a supported client can trigger a local HTML capture. Confirming an upload requires separate evidence.

3. **Do not edit the issue.** This canary's workflow skips its scheduled scan while an open tracking issue exists — the operator closes the issue manually once they have worked through the backlog. Closing is the operator's signal that the worklist is processed.

## Important Guidelines

- Follow ALL CLAUDE.md guidelines.
- **Never copy a reader's URL, user id or token into an issue, comment, commit or log line.** The repository is public. Cite a row by its number on the report, and name a host only when the host itself is the finding.
- **Keep the exact-key list private.** Share aggregate counts in issues, comments, commits and logs.
- **Read the report's rows, and any row's production record, in a local session or an admin's browser, never through `@claude` in GitHub Actions.** The `@claude` listener's run log shows every tool result, and that log is public.
- **The stored `crawl-failed` / `summary-failed` reason strings on each row are the most direct signal of root cause.** Read them before reaching for logs. The schemas live in `src/packages/article-state-types/` (`CrawlFailureReasonSchema`, `SummaryFailureReasonSchema`).
- **Never edit `src/packages/check-failed-articles/scripts/exclude-patterns.ts` to make the canary quiet.** Each entry must represent a class of URL that is genuinely unsupported by product policy. Adding a fixable failure URL silently hides the regression and tomorrow's cron emits a shorter (misleading) list.
- **Never raise `FAILED_ARTICLES_LOOKBACK_DAYS` to hide a backlog.** That env var is for the operator to narrow the worklist once the historical tail is processed, not a way to make the next scan smaller without doing the work.
- **Never switch `collect-failed-rows.ts` back to a table `Scan`.** It queries the `failed` partitions of the status indexes.

## Applicable Skills

- **git-commit** (`.claude/skills/git-commit/SKILL.md`) — Conventional Commits format for any fix commit.
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`) — when the fix touches the crawl/summary state machines.
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`) — for diagnosing the command → event → handler chain that produced a `failed` terminal state.
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`) — when the root cause is an IAM grant, EventBridge rule, SQS binding, or other Pulumi-managed wiring.
