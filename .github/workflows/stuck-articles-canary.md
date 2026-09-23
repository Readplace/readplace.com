# Stuck Articles Canary Failure Investigation

You are investigating a tracking issue opened by the `Stuck articles canary` workflow. One or more articles in the production DynamoDB articles table are owed an action: `summaryStatus`/`crawlStatus` is `pending` and the worker never produced a terminal outcome, or `summaryStatus = "skipped"` with reason `ai-unavailable`, a terminal state that no retry or auto-heal touches.

## Your Task

1. **Read the issue body and any follow-up comments.** Each stuck row is listed as `[<reasons>] <url> — <message>; fetched: <ts>; recrawl: <admin-url>`. The reasons map to:
   - `summary-pending` / `crawl-pending` — the worker never produced a terminal outcome on that axis. Find the missing terminal-state write (see **crawl-pipeline-rca** below); once that fix is deployed, recrawl the row and confirm it leaves `pending`.
   - `summary-skipped-ai-unavailable` — the summariser's model **answered**, and the answer was its refusal sentinel `Summary not available.`. The provider was up; this is not an outage, whatever the reason's name suggests. No current code writes this reason, so the row is a legacy skip with no missing write to find. Only a change to the canonical content re-runs its summary, so recovering it with a recrawl *is* the fix.
2. **Recrawl a row only when its origin still serves the page** (a GET returns 2xx). A recrawl sets the crawl back to `pending` before it fetches, which lifts the guard that keeps a readable article readable, so an origin that now answers not-found or blocks the crawler turns the article into crawl `failed`. Record such a row on the issue as its own work instead.
3. **Trigger the recrawl with a POST.** The row's `/admin/recrawl?url=<url>` link opens an admin page whose script POSTs the recrawl from a browser signed in as an admin; any other client must POST to that URL with the `x-service-token` header (`RECRAWL_SERVICE_TOKEN`). A GET alone triggers nothing.
4. **Confirm the outcome on the production row**, after its `crawlStatus` is `ready` again. A promotion logs `[RecrawlContentExtracted] promoted tier to canonical` and moves `summaryStatus` to `pending`, then `ready`, `failed`, or `skipped` with reason `declined` — the model refused the new content on its last delivery, and only a later content change re-runs it. `[RecrawlContentExtracted] tie kept canonical unchanged` means the tier sources tied and the canonical stayed, so the summary did not re-run and another recrawl will not change that: recovering that row needs a change to the recrawl's tie path, with the row as evidence.

## Important Guidelines

- Follow ALL CLAUDE.md guidelines.
- **The issue body only lists rows whose URL still resolves on the public network.** The canary's reachability filter HEAD-probes each stuck row and drops rows whose `fetch()` throws (DNS failure, TCP refused, TLS error, timeout); it logs how many it dropped, not which. Do not propose "the URL is dead, exclude it" as a fix — that path is already handled and the row would not have reached you. A row that *does* reach you got an HTTP response from its origin — any status, so a 404 or 403 still counts.
- **`fetched` is not when the row got stuck.** It is the row's `contentFetchedAt`, which a freshness check can move forward without touching the summary or the crawl. A pending row went pending at its `crawlPendingSince`/`summaryPendingSince`; read those from the production row before any recrawl, because a recrawl resets `crawlPendingSince` to now. Lambda logs are kept for 30 days, so a stuck row can be older than every log line about it — that is not evidence of another writer.
- **A legacy `ai-unavailable` skip was logged as `[summarize] AI returned unavailable`.** Despite the wording, that line is the refusal sentinel, not an outage.
- **The same row reappears every day.** Each day's failure opens a new date-titled issue, so earlier open issues can list the rows you are fixing. Close them together once the rows are resolved.
- **Never lower the scan's pagination cap or remove its `assert`.** The cap exists to fail loud on a runaway scan.
- **Change the scan filter or the row classifier only with evidence of what production stores and what writes it.** Judge a reason by what its writer meant, not by its name. Keep the `ai-unavailable` clause while a production scan still finds a row with `summarySkippedReason = "ai-unavailable"`: nothing writes the reason, but legacy rows still hold it.

## Applicable Skills

- **git-commit** (`.claude/skills/git-commit/SKILL.md`) — Conventional Commits format for any fix commit.
- **test-driven-design** (`.claude/skills/test-driven-design/SKILL.md`) — when the fix touches the state machines or the classifier.
- **crawl-pipeline-rca** (`.claude/skills/crawl-pipeline-rca/SKILL.md`) — the primary methodology for `pending` rows stuck in a command → event → handler chain. Use it to locate the missing terminal-state write rather than treating the symptom on the stuck rows.
- **infrastructure-design** (`.claude/skills/infrastructure-design/SKILL.md`) — when the root cause is an IAM grant, EventBridge rule, SQS binding, or other Pulumi-managed wiring.
