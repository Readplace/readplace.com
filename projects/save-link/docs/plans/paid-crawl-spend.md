# Paid crawl spend is bounded by single-use permits and a byte cap

Abbreviations: `S` = `projects/save-link/src/runtime`, `SI` = `projects/save-link/src/infra`, `CA` = `src/packages/crawl-article/src`, `ADM` = `src/packages/crawl-admission/src`, `PC` = `src/packages/provider-contracts/src`. Line numbers were read on `main` at `cff8f3087` on 2026-11-21, and re-checked at `b6f4e032` on 2026-11-26: only `SI/index.ts` had moved, and it is updated here. Production logs were last read on 2026-11-20 at about 16:00 UTC with `--profile hutch-production`. If lines have moved, find each cited spot by the name given beside it.

**Self-contained.** This file holds everything needed to run the plan. It needs a checkout of the repository on the owner's computer, with that computer's `hutch-production` credentials (see **Running on the owner's computer**), and the owner, for decision 1's reading of the Bright Data console. It needs no other plan and no other file: no plan has to run before, after or beside it.

**Replanned 2026-11-26.** Step 0 runs on the owner's computer, in the repository's devbox shell, where the production profile already works. The attempt on 2026-11-22 ran in a cloud container, which had neither the AWS CLI nor production credentials, so it measured nothing. The 2026-11-23 revision corrected P3's trigger, which the logs cannot show as first written; that correction stands.

## Handoff summary

- **Status:** written 2026-11-21. **Gated: nothing in this plan is build work today.** It carries the paid-spend half of an earlier plan that no longer exists, "Route publisher requests with bounded retries and domain pacing", and the paid-retry step of another, "Retry transient crawl failures and report exhausted operations". Everything from them that is still valid is repeated here, and nothing else from them is needed.
- **Who runs it:** step 0 runs on the owner's computer. Either a local Claude Code session (Opus 5.5 at medium effort, inline, no workflow) or the owner by hand, from the repository root inside `devbox shell` (or with direnv active). Step 0 runs no `pnpm check` and fires no hook, so the three-heavy-tasks limit does not apply to it. The session that runs a gated item runs `pnpm check` once, at the end, and `pnpm check-infra` when the item touches an `infra` directory or a `Pulumi.*.yaml`. A delegated agent never runs `pnpm check`, a project's full `check`, or a `git commit` that fires the hook.
- **What already landed:**

  | Commit | Date | What |
  |---|---|---|
  | `e5218fecf` | 2026-11-05 | Metered-leg contracts (`PC/metered-leg-ledger.ts`, 38 lines): `PaidLegPermit { leg, claimId, inputHash }`, `ClaimMeteredLeg`, `SettleMeteredLeg`, `ReleaseMeteredLeg`. Used at `S/domain/comprehensive-crawl/comprehensive-crawl-handler.ts:41,104`, `S/domain/render-crawl/render-crawl-handler.ts:20`, `S/domain/render-crawl/render-ladder.ts:113-114`, `S/domain/metered-leg/run-metered-leg.ts` and `S/domain/generate-summary/link-summariser.ts:52` |
  | `d49f13a6c` (#1344) | 2026-11-12 | `@packages/crawl-admission` (routing policy, `Retry-After` parsing, DynamoDB host admission). Nothing imports it; it holds no paid-attempt code yet |
  | `67560821d` | 2026-11-08 | Added a residential recovery after a Web Unlocker 502 |
  | `e5bd1d583` | 2026-11-18 | **Reverted** that recovery (271 lines removed from `render-ladder.ts` and `render-crawl-handler.ts`); closed its seven-day review, issue #1330 |
  | `30f496962` | 2026-11-19 | Main-frame navigations count toward the 40-request cap of a proxied render (`PROXIED_REQUEST_LIMIT = 40`, `S/providers/render-page/render-request-filter.ts:29`). Its evidence: 6 renders at 41 requests with 2 navigations in the 14 days to 2026-11-18 |

- **What this plan does:** step 0 re-measures paid render volume and asks the owner for the one number nobody has read, the November Bright Data bill. Each of the five gated items is built only when its trigger fires.
- **Why nothing is built now:** spend is bounded and small. The paid gate is 50 paid crawls an hour in production (`save-link:paidCrawlBudget: 50/3600`, `projects/save-link/Pulumi.prod.yaml:22`), each proxied render is capped at 40 requests, and the 30 days to 2026-11-20 held 203 proxied renders (see **Evidence**). The only dimension with no cap is bytes on the per-GB leg, and that leg made 23 renders.
- **First action:** step 0.1, the preflight, on the owner's computer. Stop at the first check that fails, and report it. Do not fill in a number that was not measured.
- **Main risk:** building it anyway. The ledger (P2) touches every paid caller and a production budget; a mistake there either lets spend through or denies a reader's first capture. The second risk is enabling any paid retry before P2 is on `main`: that is the only path from this area to unbounded spend, and P5 forbids it.

## Decisions for the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | Read the November usage in the Bright Data console: GB on the residential zone, requests on the Web Unlocker zone, dollars for each, and whether each zone and the account carry a spend limit | **Open, and only the owner can do it.** The application has no byte counter, so the "cents" claim below is an inference from request counts. A provider-side spend limit is the real circuit breaker: set one if none exists |
| 2 | When the byte cap (P1) is built | When the residential zone passes 1 GB in a calendar month (about $8 at list price) or the per-GB leg passes 100 renders in any 7 days. **Open:** both numbers are policy |
| 3 | Which leg the byte cap covers | The `residential-per-gb` leg only. The older plan scoped the cap to the residential recovery that `e5bd1d583` reverted; the per-GB leg is what remains billed by bytes. The Web Unlocker legs are billed per request and already capped at 40 |
| 4 | How many paid attempts one operation may make once the ledger (P2) exists | Three, the render ladder's length today (`residential-per-gb`, then `web-unlocker-fetch`, then `web-unlocker-render`). The older plan said two; cutting a leg needs matched useful-capture evidence first, and the 30-day counts favour keeping the Web Unlocker render (124 rendered of 180) over the per-GB leg (2 rendered of 23). **Open** |
| 5 | The hourly ceilings P2 adds | 100 paid starts, 4,000 reserved paid requests and 10 paid starts a host, beside the unchanged 50/3600 gate. They are conservative policy choices, not measured demand |
| 6 | Whether a paid leg is ever retried (P5) | No, until P2 is on `main` and a measured transient failure on a paid leg is worth a second paid attempt. **Decided by the older plan as a deferral; it stands** |

Nothing here blocks step 0. Decision 1 is asked during it.

## Running on the owner's computer

Step 0 needs CloudWatch Logs Insights in the production account (`ap-southeast-2`), on two log groups only: `/aws/lambda/render-crawl-command-handler` and `/aws/lambda/comprehensive-crawl-command-handler`. It calls `logs:StartQuery`, `logs:GetQueryResults` and `logs:StopQuery`, plus `sts:GetCallerIdentity`, and writes nothing in AWS.

**How the repository sets the machine up:**

| Piece | What it does | What it means here |
|---|---|---|
| `devbox.json` | Provides `awscli2`, `jq` and `nodejs_22` | Nothing to install. Work inside `devbox shell`, or a directory where direnv has loaded `.envrc` |
| `.envrc` | Sets `AWS_CONFIG_FILE="$PWD/.aws/config"` | That file defines `[profile hutch-production]` with only `region = ap-southeast-2`. The keys come from `~/.aws/credentials`, from a `[hutch-production]` section there. If that section is missing, the profile has no credentials |
| `.envrc` | Unsets `AWS_PROFILE` whenever `AWS_ACCESS_KEY_ID` is set | Keys left over in the shell can belong to another account (CLAUDE.md, **AWS Accounts**). Unset them first (step 0.1) |
| macOS | BSD `date` has no `-d`, and zsh is the default shell | Times are computed with `node`. Query strings sit in single quotes, so the shell expands nothing in their regexes |

**Results** go to `~/readplace-paid-crawl-step0/<UTC date>/`, outside the repository. Step 0 changes no repository file.

**The Bright Data console** (decision 1) is read by the owner in a browser. Do not create an API token for it: a token that can read billing can do far more than read billing, and nothing here needs that.

## Evidence

Production, the 30 days to 2026-11-20, `render-attempt-summary` lines in `/aws/lambda/render-crawl-command-handler` (203 lines):

| Leg | Renders | Rendered | Failed | Blocked | Proxied requests |
|---|---|---|---|---|---|
| `web-unlocker-render` | 180 | 124 | 53 | 3 | 3,891 |
| `residential-per-gb` | 23 | 2 | 7 | 14 | 106 |

| Fact | Value |
|---|---|
| Proxied renders by week (weeks starting 11-01, 11-08, 11-15) | 116, 69, 18 |
| Per-GB renders by week | 3, 17, 3 |
| Largest proxied request count in one render | 41 before `30f496962`, 40 after |
| `render-crawl budget exhausted` lines by week | 153, 0, 0 |
| Crawl-Lambda records matching budget, 429 or timeout in the week to 2026-11-20 | 0 of 6,829 |
| List prices checked 2026-11-07 | Residential $8 a GB; Web Unlocker $1.50 per 1,000 successful requests. The account's negotiated price is not known. Custom headers or cookies can make every Web Unlocker request billable |
| Upper bound from those counts | Web Unlocker: 3,891 requests is at most $5.84 for the 30 days. Per-GB: 23 renders at 1 to 5 MB each is $0.18 to $0.92 |

A proxied render already skips images, media and fonts (`SKIPPED_RESOURCE_TYPES`, `render-request-filter.ts:28`). The summary line carries request counts and no bytes; `S/providers/render-page/puppeteer-render-page.ts` (129 lines) has no byte accounting. The measurement covers the two browser legs; the `web-unlocker-fetch` leg and the comprehensive leg log no such summary.

The paid gate today (`S/providers/paid-crawl-budget/dynamodb-paid-crawl-budget.ts`, 149 lines) is one transaction: a create-if-absent claim keyed `${scope}#claim#${messageId}#${windowStartSeconds}` (line 73) and a conditional `ADD` on `${scope}#global#${windowStartSeconds}` (lines 85 to 92), both expiring two windows after the window starts (line 61), with a release path from line 125. It is idempotent per message and window, so it counts paid operations, not physical requests: a redelivery in a later window, a gateway retry or a persona retry is not counted again. Staging runs `200/3600` (`Pulumi.staging.yaml:22`); infra reads it with `config.require("paidCrawlBudget")` (`SI/index.ts:146`) and passes `PAID_CRAWL_BUDGET` (`SI/index.ts:1042`).

The queries, for re-running (Logs Insights, `/aws/lambda/render-crawl-command-handler` and `/aws/lambda/comprehensive-crawl-command-handler`):

```
filter @message like "render-attempt-summary" | parse @message /renderedThrough"?: ?["'](?<leg>[a-z-]+)/ | parse @message /outcome"?: ?["'](?<outcome>[a-z-]+)/ | parse @message /continuedProxied"?: ?(?<cp>[0-9]+)/ | stats count() as renders, sum(cp) as proxiedRequests, max(cp) as maxProxied by leg, outcome, datefloor(@timestamp, 7d) as week | sort week asc
filter @message like /(?i)budget exhausted/ | stats count() as n by datefloor(@timestamp, 7d) as week, @log | sort week asc
```

## Chosen design

1. **Measure, then build what the measurement asks for.** CLAUDE.md's Evidence Over Speculation rule applies to every item: no guard for a problem that has not happened.
2. **Extend the metered-leg contracts; do not add a second spend coordinator.** A `PaidLegPermit` already exists and the paid callers already claim, settle and release one. P2 makes that permit single-use per physical attempt and adds the counters behind it.
3. **The shared code lives in `@packages/crawl-admission`**, because hutch and inbox must not import from save-link. Preview, submission and inbox roots stay direct-only: nothing here makes them eligible for paid work.
4. **A cap never loosens eligibility.** The automatic-save deferral, first-view eligibility, the 24-hour cooldown, settled-ledger reuse, the tracker-resolution exception, and manual-save, archive-host and recrawl semantics all stay as the callers have them. Read them in the callers before changing a line.
5. **An application counter is an abort budget, not an invoice cap.** In-flight responses overshoot, and headers, TLS and the provider's own accounting differ. The provider-side spend limit (decision 1) is the monetary circuit breaker.
6. **The Web Unlocker browser leg stays.** Bright Data says Web Unlocker is not designed for Puppeteer use, but it rendered 124 of 180 attempts here. Do not mark a working route incapable from product guidance, and do not blindly retry its 502s.
7. **No user-facing copy, translation key, privacy sentence, llms file or CLAUDE.md section changes** in any item. If P2 changes how a paid dead letter is redriven, grep CLAUDE.md, `.claude/skills` and `projects/*/docs` for `paidCrawlBudget`, `PAID_CRAWL_BUDGET` and `metered` and update what describes it, in the same commit.

## Ownership boundary

This plan owns the functions below. Other work may edit inside two of the files (see **Running beside other work**). Where a file is shared, this plan stays inside its own block; a conflict on adjacent lines is resolved by keeping both sides.

| Owned here | Not touched here |
|---|---|
| `S/providers/paid-crawl-budget/*`; `PC/metered-leg-ledger.ts`; `S/domain/metered-leg/*`; `S/domain/comprehensive-crawl/*`; `S/domain/render-crawl/*`; `S/domain/crawl-article-state/commit-deferred-crawl.ts`; `S/providers/render-page/*`; `CA/proxied-ladder-fallback.ts`; the paid wiring in `S/render-crawl-command.main.ts` and `S/comprehensive-crawl-command.main.ts`; new files in `ADM` and their export lines in `ADM/index.ts`; the paid Lambdas' blocks and the budget config in `SI/index.ts` and `projects/save-link/Pulumi.*.yaml` | The free transport ladder (`crawl-fetch.ts`, `transport-ladder.ts`, `persona-fallback.ts`, `rate-limit-retry.ts`, the redirect modules); `fetch-retry-decision.ts`; `crawl-article.ts`; the save, anonymous-save, submit-link and inbox preview handlers and their queues; the existing files in `ADM` (routing policy, host admission); every DeepSeek caller. `S/domain/generate-summary/link-summariser.ts` uses the metered-leg contracts for the `summary` leg: its behaviour and tests must not change |

Other work may edit other blocks of `SI/index.ts`: the selection constants (`SELECTION_FIFO_PROCESSING_ENABLED` and `SELECTION_ROUTE`, about line 319) and the save-command and anonymous-save queue blocks (about 330 to 390). This plan stays in the paid Lambdas' blocks and the budget config. P3 constructs the host-admission provider in the render root; if that root already constructs one for the free fetch path when P3 opens, reuse that instance.

## What is left

### Step 0: measure

Run every block below in one terminal, from the repository root, inside `devbox shell`. The blocks share shell variables, so keep the same terminal throughout. Step 0 changes no repository file. Its raw results go to `$OUT`, outside the repository.

**0.1 Preflight.** Stop and report the first check that fails.

1. `git status`. Files that other work modified or staged are not part of this plan.
2. Check the tools. `aws --version` must show `aws-cli/2`. `jq` and `node` must print versions. If any is missing, the shell is not the devbox shell.

   ```bash
   aws --version && jq --version && node --version
   ```

3. Clear any keys left in the shell, which would otherwise take the place of the profile:

   ```bash
   unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
   ```

4. Check where the profile's credentials come from. The `access_key` row must name `shared-credentials-file` (the `[hutch-production]` section of `~/.aws/credentials`) or `sso`. On an SSO profile whose session has expired, run `aws sso login --profile hutch-production` first.

   ```bash
   aws configure list --profile hutch-production
   ```

5. Check which account the profile reaches. The owner confirms that the `Account` it prints is production. A different account (CLAUDE.md records a machine whose defaults reached an unrelated, empty one) stops step 0.

   ```bash
   aws sts get-caller-identity --profile hutch-production
   ```

**0.2 Define the helper, the windows and the queries.** All windows are in UTC. Each query runs over both log groups, starts with `start-query`, and is polled until it finishes. The query strings sit in quoted heredocs, so neither bash nor zsh expands anything in them.

```bash
OUT="$HOME/readplace-paid-crawl-step0/$(date -u +%Y-%m-%d)"; mkdir -p "$OUT"
insights() { # name start end query
  local id
  id=$(aws logs start-query --profile hutch-production --region ap-southeast-2 \
    --log-group-names /aws/lambda/render-crawl-command-handler /aws/lambda/comprehensive-crawl-command-handler \
    --start-time "$2" --end-time "$3" --query-string "$4" --output text --query queryId) || return 1
  until aws logs get-query-results --profile hutch-production --region ap-southeast-2 --query-id "$id" > "$OUT/$1.json" \
    && jq -e '.status == "Complete" or .status == "Failed" or .status == "Cancelled" or .status == "Timeout"' "$OUT/$1.json" > /dev/null; do sleep 5; done
  jq -r '"\(.status) \(.statistics.recordsMatched) records matched"' "$OUT/$1.json"
  jq -r '.results[] | map("\(.field)=\(.value)") | join("  ")' "$OUT/$1.json"
}
NOW=$(node -p 'Math.floor(Date.now() / 1000)')
D30=$((NOW - 30 * 86400))
H1=$((NOW - 3600))
MONTH=$(node -p 'const d = new Date(); Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000)')
Q_RENDERS=$(cat <<'EOF'
filter @message like "render-attempt-summary" | parse @message /renderedThrough"?: ?["'](?<leg>[a-z-]+)/ | parse @message /outcome"?: ?["'](?<outcome>[a-z-]+)/ | parse @message /continuedProxied"?: ?(?<cp>[0-9]+)/ | stats count() as renders, sum(cp) as proxiedRequests, max(cp) as maxProxied by leg, outcome, datefloor(@timestamp, 7d) as week | sort week asc
EOF
)
Q_EXHAUSTED=$(cat <<'EOF'
filter @message like /(?i)budget exhausted/ | stats count() as n by datefloor(@timestamp, 7d) as week, @log | sort week asc
EOF
)
Q_MONTH=$(cat <<'EOF'
filter @message like "render-attempt-summary" | parse @message /continuedProxied"?: ?(?<cp>[0-9]+)/ | parse @message /renderedThrough"?: ?["'](?<leg>[a-z-]+)/ | stats count() as renders, sum(cp) as proxiedRequests by leg
EOF
)
Q_429=$(cat <<'EOF'
filter @message like /\b429\b/ | stats count() as n by @log, datefloor(@timestamp, 7d) as week
EOF
)
Q_PER_GB=$(cat <<'EOF'
filter @message like "render-attempt-summary" and @message like "residential-per-gb" | stats count() as renders by datefloor(@timestamp, 1d) as day | sort day asc
EOF
)
```

**0.3 Preflight query.** The last preflight check runs the render query over the last hour. It must print `Complete`. An `AccessDeniedException` or `ResourceNotFoundException` means the profile or the account is wrong: fix that, never the query. Zero rows in a quiet hour is allowed. If it is zero, widen this one check to `$((NOW - 86400))` and expect at least one row.

```bash
insights preflight "$H1" "$NOW" "$Q_RENDERS"
```

**0.4 Run the five queries.**

```bash
insights renders-30d "$D30" "$NOW" "$Q_RENDERS"
insights exhausted-30d "$D30" "$NOW" "$Q_EXHAUSTED"
insights renders-month "$MONTH" "$NOW" "$Q_MONTH"
insights status-429-30d "$D30" "$NOW" "$Q_429"
insights per-gb-daily-30d "$D30" "$NOW" "$Q_PER_GB"
```

| Name | Window | What it feeds |
|---|---|---|
| `renders-30d` | 30 days to now | Both tables in **Evidence**; P1 |
| `exhausted-30d` | 30 days to now | P2 |
| `renders-month` | First of this month (00:00 UTC) to now | P2's comparison with the console, over the same span as decision 1's reading |
| `status-429-30d` | 30 days to now | P3 (read the limits below) |
| `per-gb-daily-30d` | 30 days to now | P1's test of 100 renders in any 7 days. Sum each run of 7 calendar days, counting a missing day as 0, and keep the largest sum |

A query that ends `Failed`, `Cancelled` or `Timeout`, or that matched zero records in a window where the 2026-11-20 tables found some, is a broken query. It is not evidence of zero: fix the parse and run it again (see the crawl-pipeline-rca skill on queries that return no rows).

**Limits of what the logs show.**
- The `render-attempt-summary` line carries request counts and no bytes, so no query measures GB. Only the console does.
- The resource-host lines (`stream: "render-resource-hosts"`, on in both stacks through `save-link:renderRequestDiagnostics: hosts`) count responses as `response2xx`, `responseOther` and `failed`. They hold no status code, so a 429 inside a render is invisible to them. `status-429-30d` finds only lines whose text holds `429`, such as a fetch or handler error. A zero there does not show that no render saw a 429.
- The `web-unlocker-fetch` leg and the comprehensive leg log no summary line. Their spend shows only in the console.

**0.5 Ask the owner for decision 1** (with the Ask tool in a Claude Code session, or noted by hand), for the same span as `renders-month`: residential GB and dollars, Web Unlocker requests and dollars, and whether each zone and the account carry a spend limit. Record the answer with its date. If the owner cannot read it yet, record that, and record P1's GB test and P2's console test as "not measurable", not as "not fired".

**0.6 Evaluate each trigger** in this table, with the numbers beside it:

| Item | Fires when | Source |
|---|---|---|
| P1 | Residential GB this month > 1, or per-GB renders in any 7 days > 100 | Decision 1; `per-gb-daily-30d` |
| P2 | `budget exhausted` lines in two consecutive weeks; or console Web Unlocker requests > 2 × the `web-unlocker-render` proxiedRequests in `renders-month`; or P5 is wanted | `exhausted-30d`; decision 1; owner |
| P3 | A 429 from the document's own origin during a proxied render | Not measurable from today's logs (see the limits above). Record "not measurable", and propose the measurement as its own change only if the owner asks for it |
| P4 | P2 enforced in production | `git log` |
| P5 | P2 enforced, and a measured paid-leg transient failure that recovers on a second attempt | Not measured |

**0.7 Report.** Include:
- the comparison with the 2026-11-20 tables;
- the filled-in trigger table;
- the account ID confirmed in 0.1;
- "run locally on the owner's computer";
- the path of `$OUT`.

If no trigger fired, the plan is done for now: say so and stop, and build nothing. The report goes to the owner, and into the issue or commit of any item that does fire. The JSON files in `$OUT` stay on the owner's computer.

### P1. A per-GB render stops after 5 MiB

- **Trigger:** decision 2's threshold. Baseline: 23 per-GB renders and 106 proxied requests in 30 days.
- **Build:**
  - `S/providers/render-page/puppeteer-render-page.ts`: in the existing `page.on("response")` handler (line 90), add each response's observed size to the render's tally. Enforce at the network boundary, not after the page has loaded.
  - `S/providers/render-page/render-request-filter.ts`: `decide` aborts every further request of a per-GB render once the tally passes 5 MiB, the way it aborts request 41 today. The filter is created with `{ proxied, url }` (line 58 of the render page); it needs to know the leg, so pass it.
  - `S/providers/render-page/render-request-counts.ts` and `S/domain/render-crawl/render-page.types.ts`: the tally gains observed bytes and an aborted-by-bytes count.
  - `S/domain/render-crawl/report-proxied-render-attempt.ts`: the `render-attempt-summary` line gains the observed bytes and the byte limit.
- **Keep:** the allowances of a first capture, a PDF and a file download, including the large-PDF limit; the 40-request cap; direct renders, which never abort on bytes.
- **Tests first** (`render-request-filter.test.ts`, `report-proxied-render-attempt.test.ts`): a per-GB render aborts once 5 MiB is observed; a Web Unlocker render and a direct render do not; the summary line carries the bytes; request 41 still aborts. Run the existing `puppeteer-render-page.integration.ts` against a real article that renders with JavaScript and confirm no regression.
- **If the owner can read spend but not attribute it:** build only the summary line's byte field first, as its own commit, and re-evaluate the trigger after 14 days.

### P2. One ledger per operation, one single-use permit per paid attempt

- **Trigger:** P5 is wanted; or `budget exhausted` lines return in two consecutive weeks; or the console's Web Unlocker request count for a month is more than twice the application's `continuedProxied` sum for the same month. Baseline: exhausted lines 153, 0, 0 by week.
- **Why it would be needed:** today's claim does not cap physical requests (see **Evidence**). Redelivery, persona retries, gateway retries and any future durable retry can each spend again.
- **Build:**
  - Move or re-export the transaction logic of `S/providers/paid-crawl-budget/dynamodb-paid-crawl-budget.ts` into `@packages/crawl-admission`, keeping every caller compatible: `S/comprehensive-crawl-command.main.ts`, `S/domain/comprehensive-crawl/comprehensive-crawl-handler.ts`, `S/domain/comprehensive-crawl/paid-crawl-budget.types.ts`, `S/domain/crawl-article-state/commit-deferred-crawl.ts`, `S/domain/render-crawl/render-crawl-handler.ts`, `S/render-crawl-command.main.ts`. Keep the 50/3600 gate unchanged.
  - An operation ledger keyed by a stable `operationId` that carries `saveAttemptId`, `generation` and `createdAt`. An operation is one intended save, refresh or recrawl generation, never a delivery or a transport leg; redelivery and handoff preserve it. Completed content and settled ledgers short-circuit before admission.
  - A single-use `physicalAttemptId`, reserved in one transaction with the counters **before** the paid network boundary. A reserved attempt whose outcome is unknown after a crash stays spent; releasing ownership is not a refund. An idempotent replay of a reservation never authorises a second send.
  - Paid attempts per operation: decision 4. At most one of them is a residential alternate-egress navigation.
  - Reserved requests: a browser attempt reserves 40, a fetch reserves 6 (the first request and five redirects), and one operation reserves at most 80. Unused reservations after a crash count as consumed. Record actual requests separately for reconciliation.
  - Hourly counters: decision 5. They expire one window after their own; check timestamps, never deletion.
  - Lifetimes: an active or unresolved ledger has no TTL; a settled or retired one gets 30 days. An envelope older than 14 days with no ledger returns `recovery-required`: it is neither a fresh allowance nor a reason to drop unfinished work. A redrive never resets paid counters; whoever redrives checks completion and the current generation, then authorises a new recovery operation explicitly, carrying the earlier spending evidence.
  - A store failure denies paid admission, and is reported apart from an ordinary denial. Reuse the bounded transaction-conflict retry the budget has.
  - `CA/proxied-ladder-fallback.ts`: each paid physical leg of the fetch ladder takes a new permit. Keep one bounded proxy loop (it allows two gateway or timeout attempts today); do not nest another.
  - `S/domain/render-crawl/` (`render-ladder.ts`, `render-crawl-handler.ts`, `render-page.types.ts`, `report-proxied-render-attempt.ts`): take the permit per leg, represent `deferred` and `capability-invalid` outcomes, keep previous captures and paid view eligibility. Every skipped, attempted or capability-invalid route logs a structured outcome with route, status, provider error code, useful-content result, latency, reserved and actual requests, and no credential, cookie, signed query string or body.
  - `S/providers/render-page/residential-egress.ts`: a newly minted session token is not proof of a new exit address. Log "new session requested; exit change unverified" unless the provider reliably supplies an exit identifier.
- **Tests first, on the package's existing DynamoDB fake:** a duplicate command or a redelivery cannot reuse a spent permit; a replayed reservation does not authorise a second send; the per-operation slots run out in each route order; a crash after reservation counts as spent; a store outage denies; an envelope older than 14 days with no ledger returns `recovery-required`; concurrent attempts and a lost acknowledgement cannot exceed the operation, hourly or request reservations; nothing resets at midnight or on a queue handoff; settled work is reused. The existing paid-budget tests pass unchanged or only moved. An unsupported Web Unlocker browser configuration is tested apart from a provider outage.
- **Infra:** new limits are explicit, required config and environment, read with the required-env accessor and no default. `pnpm check-infra` should show only new environment variables and, if a table grant is needed, an IAM addition: no replace, no delete, no new queue, table or scheduler. Read the infrastructure-design skill first.
- **Roll out:** deploy with the new caps logged but not enforced for at least 24 h, report any legitimate first capture they would have denied, then enforce. Record the activation commit and its UTC time.

### P3. A 429 seen inside a render cools its origin down

- **Trigger:** a 429 from the document's own origin during a proxied render. **This cannot be observed today:** the resource-host buckets count non-2xx responses as `responseOther`, with no status code, and the summary line carries none (`render-resource-hosts.ts`, `report-proxied-render-attempt.ts`). The 2026-11-20 baseline, "0 records with 429 in the week to 2026-11-20", was a text match. It shows no 429 surfaced in an error line, not that no render saw one. Recording the status in the bucket would be a new measurement: propose it as its own change, with a reason, only if the owner asks for it.
- **Build:** persist that origin's cooldown through the host-admission provider in `ADM/dynamodb-host-admission.ts` (it is on `main`, unwired), honouring `Retry-After` through `ADM/retry-after.ts`: 60 s without a valid value, the greatest cooldown seen wins, never shortened. Grant the rate-limits table to the render Lambda. This persists a cooldown; it does not serialise browser subresources.
- **Tests first:** a subresource 429 writes the cooldown; a later render of that origin is deferred with `nextEligibleAt` and makes no paid request; a 429 from another host writes nothing.

### P4. The paid caps are reviewed seven days after they are enforced

- **Trigger:** P2 is enforced in production.
- **Build:** search open and closed issues for "paid crawl caps seven-day review" and the activation commit; update a matching open issue, and create one only if none exists. Put the due date, activation plus seven days, in the title in UTC and Australia/Sydney with its real offset. Include equal windows before and after, sample sizes, useful captures and terminal failures per distinct eligible operation, deferred and in-flight work counted apart, first captures the caps denied, and the provider's usage reconciled against the application's bytes and requests. Name an owner; the issue schedules nothing by itself.

### P5. A paid leg is retried

- **Trigger:** P2 is on `main` and enforced, **and** a measured transient failure on a paid leg recovers on a second attempt often enough to pay for it. Baseline: none measured; 53 of 180 Web Unlocker renders failed in 30 days, and a browser-through-Unlocker 502 repeats on retry.
- **Rules when it is built:** every retry takes its own permit from P2; a deferred or denied admission makes no request; reader-triggered permission, settled-input reuse and in-flight exclusion stay; an ambiguous crash counts as charged; nothing resets at midnight or on a handoff. Use the redelivery mechanism that is on `main` (`initRetryingSqsRecordHandler`, `src/packages/infra-components/src/runtime/sqs-record-handler.ts:122`) on the render and comprehensive command handlers; never publish a new message to reset a receive count. Exactly-once billing after a crash is not promised.
- **Until then:** only free direct-fetch recovery exists, and it must stay that way.

## Acceptance criteria

1. Step 0's numbers and the owner's console reading are recorded with their date, the account ID the owner confirmed as production, and that the run was made on the owner's computer.
2. No item was built without its trigger. If none fired, no repository file changed.
3. For any item built: its tests were written first and fail without the change; the 50/3600 gate, every eligibility rule and every reader capture behave as before; `pnpm check` passes; `pnpm check-infra` shows only the additions the item names.
4. No paid retry exists on `main` unless P2 is enforced there.
5. Every crawler health-canary source is still present.

## Verification

- `git grep -n "PROXIED_REQUEST_LIMIT" -- 'projects/save-link/src/runtime'` still shows 40.
- `git grep -n "paidCrawlBudget" -- projects/save-link` still shows `50/3600` for production.
- After P1: a per-GB render in staging logs its observed bytes, and a render past 5 MiB logs the byte abort.
- After P2: the staging logs show one reservation per paid attempt, and a forced redelivery shows no second reservation for the same attempt.

## Running beside other work

This plan can start at any time. Step 0 writes nothing, so it cannot conflict with a commit. Other sessions may be committing to `main` while a gated item is built.

- Run `git status` first. Leave files that other work modified or staged alone, and commit an item's files by path.
- The session that builds an item runs the one full `pnpm check`; a delegated agent never does. On the machine that hosts the self-hosted CI runners, count the heavy tasks already running and start while fewer than three are (CLAUDE.md, "Delegated agents never run the full check").
- If a push is rejected, `git pull --rebase origin main`. On a conflict in adjacent lines keep both sides. After a rebase that brought in a change to a file under **Files touched**, re-run `pnpm nx run save-link:check` before pushing, and `pnpm check-infra` again if an infra file changed.

Files other work is likely to edit, and the part of each this plan owns:

- **`projects/save-link/src/infra/index.ts`.** This plan edits the paid Lambdas' blocks and the budget config. Other work may edit or delete the selection constants (about line 319) and the selection worker block.
- **The metered-leg contract.** P2 adds the permit types and the permit path in `PC/metered-leg-ledger.ts` and `S/domain/metered-leg/run-metered-leg.ts`. It does not change the `in-flight` result variant or the in-flight branch of `initRunMeteredLeg`: other work may add the holder's `claimId` and `expiresAt` there. When P2 opens, re-read both files on `main` first.
- **The render root and the render Lambda's table grant.** P3 writes the one host-admission provider instance in `S/render-crawl-command.main.ts` and grants the rate-limits table to the render Lambda. P3 does not change the `initCrawlFetch(` arguments in that root. If the root already constructs a host-admission provider when P3 opens, reuse that instance.
- **`src/packages/crawl-admission/src/index.ts`.** P2 adds export lines for its new files. It leaves the existing files and their lines unchanged.
- **`S/domain/generate-summary/link-summariser.ts`** is not edited here. Other work may edit `generate-summary-handler.ts`, a different module.

## Files touched

Step 0 touches no repository file. Its results go to `~/readplace-paid-crawl-step0/` on the owner's computer. Only if its gate opens:

| Item | Files |
|---|---|
| P1 | `projects/save-link/src/runtime/providers/render-page/puppeteer-render-page.ts`, `render-request-filter.ts`, `render-request-filter.test.ts`, `render-request-counts.ts`; `projects/save-link/src/runtime/domain/render-crawl/render-page.types.ts`, `report-proxied-render-attempt.ts`, `report-proxied-render-attempt.test.ts` |
| P2 | `projects/save-link/src/runtime/providers/paid-crawl-budget/dynamodb-paid-crawl-budget.ts` and its test; new ledger files and tests in `src/packages/crawl-admission/src/`, and `index.ts` there; `src/packages/provider-contracts/src/metered-leg-ledger.ts`; `projects/save-link/src/runtime/domain/metered-leg/run-metered-leg.ts`; `projects/save-link/src/runtime/domain/comprehensive-crawl/comprehensive-crawl-handler.ts`, `paid-crawl-budget.types.ts`; `projects/save-link/src/runtime/domain/crawl-article-state/commit-deferred-crawl.ts`; `projects/save-link/src/runtime/domain/render-crawl/render-ladder.ts`, `render-crawl-handler.ts`, `render-page.types.ts`, `report-proxied-render-attempt.ts`; `projects/save-link/src/runtime/providers/render-page/residential-egress.ts` and its test; `src/packages/crawl-article/src/proxied-ladder-fallback.ts` and its test; `projects/save-link/src/runtime/render-crawl-command.main.ts`, `comprehensive-crawl-command.main.ts`; `projects/save-link/src/infra/index.ts`, `projects/save-link/Pulumi.prod.yaml`, `projects/save-link/Pulumi.staging.yaml`; `projects/save-link/package.json` and `pnpm-lock.yaml` for the new workspace dependency |
| P3 | `projects/save-link/src/runtime/providers/render-page/puppeteer-render-page.ts`, `render-request-filter.ts` and its test; `projects/save-link/src/runtime/render-crawl-command.main.ts`; `projects/save-link/src/infra/index.ts` (table grant on the render Lambda) |
| P4 | none (a GitHub issue) |
| P5 | `projects/save-link/src/runtime/domain/render-crawl/render-crawl-handler.ts`, `projects/save-link/src/runtime/domain/comprehensive-crawl/comprehensive-crawl-handler.ts` and their tests; the two command mains; the render and comprehensive queue blocks in `projects/save-link/src/infra/index.ts` |
