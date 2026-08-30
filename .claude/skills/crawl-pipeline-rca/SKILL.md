---
name: crawl-pipeline-rca
description: Root-cause methodology for distributed pipelines (command → event → handler chains over Lambda + EventBridge + SQS), with the article crawl system as the primary application. Use when a state-machine row is stuck non-terminal (e.g. `crawlStatus='pending'`, `summaryStatus='pending'`), when a canary or SLO times out with the row never transitioning, when one entry point works but another doesn't for the same input (e.g. `/view` vs `/admin/recrawl`), when investigating a multi-Lambda async chain where the first handler logs a clean success, or before bumping Lambda timeouts / SQS visibility / `maxReceiveCount` to "give it more room".
---

# Debugging Distributed Pipelines (Command → Event → Handler)

Work flowing through multiple Lambdas connected by EventBridge → SQS hops has a small set of recurring failure modes that are non-obvious from any single handler. When a state-machine row is stuck in a non-terminal state, the bug is almost always a missing terminal-state write **downstream** — not the handler you start staring at hanging.

## Methodology

### 1. Logs Before Hypotheses

Observation beats reasoning across process boundaries. Before changing code, tail every handler in the chain:

```bash
AWS_PROFILE=hutch-production aws logs filter-log-events \
  --region ap-southeast-2 \
  --log-group-name /aws/lambda/<handler> \
  --filter-pattern '"<id>"' \
  --start-time <ms-epoch>
```

A clean success log in handler N followed by silence in handler N+1 pinpoints the bug. Speculating about Lambda timeouts or hangs before reading logs almost always wastes hours.

For the crawl pipeline, the chains are:

| Entry point | Lambda chain (the `<handler>` in the log-group name) |
|---|---|
| `/admin/recrawl` | `recrawl-link-initiated-handler` → `recrawl-content-extracted-handler` |
| `/view` (new article) | `save-anonymous-link-command-handler` → `select-most-complete-content-handler` |
| Save link command | `save-link-command-handler` → `select-most-complete-content-handler` |

The `<handler>` names are the Lambda names the Pulumi program assigns — confirm against the program before pasting. Inspect each project's Pulumi program (what `pnpm nx run <project>:check-infra` previews) for the full Lambda/queue topology — its event-bus subscriptions map each event (`SaveLinkCommand`, `SaveAnonymousLinkCommand`, `RecrawlLinkInitiated`, then `TierContentExtracted` or `RecrawlContentExtracted` for the second hop) to the Lambda that consumes it.

### 2. Audit Every Path Against the Single Writer of Each Terminal State

For each terminal status in the state machine (`ready`, `failed`, `succeeded`, …), grep for who writes it. There should be one canonical writer per state. Then walk every reachable code path through the handler chain — each must end at a writer, or the row stays stuck. Skip-promotion / no-op-update / tie / "canonical unchanged" branches are the most common offenders.

For the crawl pipeline, `crawlStatus='ready'` has one writer: the article store's aggregate save — the DynamoDB update that binds `:crawlStatus` to the aggregate's crawl kind; grep the article store for `:crawlStatus`. The aggregate reaches that kind through the transitions the content-selection handlers persist once the winning tier is settled on the canonical S3 key — the two promotions (which copy the winner there first), the recrawl tie that keeps the canonical unchanged — and through the content-refresh transition; grep the aggregate's transitions for crawl assignments whose kind is `ready`. A content purge also stamps `ready` directly from its tombstone update, outside the aggregate save — it binds `:ready`, not `:crawlStatus`, so the grep above does not surface it.

### 3. Conditional vs Unconditional State Mutators Are Not Interchangeable

When the codebase has both a conditional and an unconditional variant of the same transition, they expose different bug surfaces. A bug that reproduces only on the unconditional path is usually in code that the conditional path silently skips — because the conditional mutator is a no-op when the row is already in its terminal state.

Crawl pipeline example: `/view` marks the crawl pending conditionally — the crawl-state store's update guarded by `crawlStatus <> :ready`, grep for that condition; `/admin/recrawl` marks it pending unconditionally — the sibling update in the same store with no condition. A bug that reproduces on the latter but not the former lives in a code path only the unconditional mutator exposes.

### 4. Retry-Chain Wall Clock = Visibility × maxReceiveCount

Lambda timeout, SQS visibility, and `maxReceiveCount` form an interdependent failure-surfacing budget: the DLQ-driven terminal write lands at roughly `visibility × maxReceiveCount` after the first failure. Raising Lambda timeout in isolation pushes that out, often past the SLO/canary budget. Tune all three together, or short-circuit by writing the terminal state inline before throwing for retry.

For the crawl pipeline, queue/Lambda config is in the Pulumi program that subscribes a Lambda to `RecrawlLinkInitiated` — grep the Pulumi programs for the event-bus subscribe call that names that event. The Tier 1+ canary's poll budget is in the script behind the `tier-1-plus-pipeline-health` nx target (`pnpm nx show projects --with-target tier-1-plus-pipeline-health` names its project).

### 5. Symmetric Paths That Diverge Are a Signal, Not a Coincidence

When two paths share a core but diverge for the same input (one works, the other doesn't), the bug almost never lives in the shared core or in environmental factors (warm pools, IPs, caching). Audit each path's divergent prefix — entry-point state mutations and preconditions — first.

## Anti-Patterns

| Don't | Why |
|---|---|
| Speculate about Lambda timeouts before tailing logs | Symptoms whose duration matches a single timeout (a Lambda timeout, the canary's poll budget) usually point to retry-chain math, not Lambda hangs |
| Bump Lambda timeout in isolation to "give it more room" | Pushes failure-surfacing past the canary/SLO budget without addressing the cause; rule 4 applies |
| Dismiss "path A works, path B doesn't" as warm-pool or IP coincidence | This pattern almost always points to a real divergence in path B's prefix; rule 5 applies |
| Patch the first handler in the chain when it logs success | The bug is in the next hop; patching the first hop fights the wrong fight |
| Race the shared save-link worker (the function the save, anonymous-save, submit and recrawl handlers all call to fetch and finalize one URL) against a wall-clock timer to force the crawl-failed terminal write | Aggressive budgets regress the working majority of URLs (e.g. Wikipedia) without fixing the stuck minority; address the missing terminal write directly |
