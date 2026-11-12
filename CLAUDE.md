# Development Guidelines

This file documents **why** — rationale, constraints, and policy. The code documents **how**: when a section here starts narrating mechanics the code already shows, condense it to the why and describe how to find the code.

## Setup

1. Install devbox: https://www.jetify.com/docs/devbox/installing-devbox#linux
  a) if unable to install devbox, check [devbox.json](./devbox.json) for required tools and install them manually (Node.js, AWS CLI, Pulumi, etc.), Check [.envrc](./.envrc) for required environment variables and set them in your shell profile (e.g., .bashrc, .zshrc)
1. Run pnpm install to install dependencies

## Evidence Over Speculation

Every change must fix a problem that has been observed — a failing run, a measured behaviour, a reproduced bug — or implement an explicit requirement. Do not add guards, fallbacks, canaries, or standing infrastructure for problems that have not happened, even when a plan or a review proposes them: ask for the evidence or leave them out. If a safeguard still seems worth having, propose it as its own change with the evidence that motivates it.

## Product Constraints

### Imports are self-serve and public

Importing is a top-of-funnel acquisition path: it is reachable **logged out**, not gated behind auth. Do **not** restore the removed "Import Your Data" landing-page card.

Why the flow is shaped the way it is (the import page module — the router that mounts the `/:id/commit` route; grep for it — shows the mechanics): auth is deferred to **commit** so the whole upload-and-review works logged-out, and anonymous sessions are reached by **capability** (the unguessable import id), not by owner — that is what lets signup round-trip back to the same review with selections intact. Only the commit route carries the save gates (the middleware that rejects a locked, unverified-past-window account and the one that rejects an account without write access — both in the main app's web middleware directory). Committed links stub-save first and enrich asynchronously so cards appear immediately. Files or imports above the caps in the shared domain package's import-session rules (the module that fixes the per-import URL and upload-byte limits — grep the domain package for `2_000`) are refused, and every surface that names the caps tells the reader to split the export and import the parts one at a time. There is no concierge import path — do not reintroduce one.

### Crawler Health Canary Is Load-Bearing

A failure in the crawler source health canary (the `tier-1-plus-pipeline-health` nx target of the crawler package — `pnpm nx show projects --with-target tier-1-plus-pipeline-health` names it; the source list is the module that target's script imports it from, in the package's scripts directory) means production traffic is also blocked for that source. Every entry exists because a real user tried to save that type of URL and the crawler broke on it. When a canary fails, fix the crawler until the canary's URL loads — do not delete the entry to make the workflow green. Removing a source silently accepts that readers will get "Sorry, we couldn't save this link" for any URL matching that edge-sniffer's fingerprint (Cloudflare TLS fingerprinting, Fastly JA3, etc.).

Workflow for a canary failure:
1. Reproduce the failing fetch locally against the same URL before touching any code.
2. Find the block (status code, Cloudflare `cf-mitigated` header, body contents) and pick a mitigation that hits the real origin (HTTP/2 fallback, header tweaks, oembed, etc.).
3. Re-run the canary locally until the failing source passes — never commit until it does.
4. Only then push and watch CI.

One exception: when the origin refuses our egress outright — every transport leg blocked, no mitigation that reaches it — comment the entry out together with the evidence, and treat reaching that origin as its own work. A commented entry still records that a real save path is broken; a deleted one records nothing.

### A reader's own capture is never failed by the judge

A tier-0 candidate (a browser-extension capture, an iOS share, a `save-content` upload, a PDF upload, a Gmail newsletter body) is the page the reader saw and chose to keep. The model that ranks candidates during content selection may not turn a readable one into a failed save. Its `none` verdict is terminal: the crawl is marked failed and nothing retries it, unless the save is a YouTube video (see **YouTube video card** below). When every candidate set started going through the judge on 2026-10-07, it rejected the staging reader-path upload in about 30% of runs. The same path was open for real captures saved alongside a live 403 or 404 page.

Content selection enforces this with two rules (grep the save-link select-content module for the comparison log line's `selectionRule` values):

| Rule | When it applies | What happens |
|---|---|---|
| `first-capture` | A lone tapped capture of a non-wrapper host is the article's first content | It is served without asking the judge |
| `own-capture-over-verdict` | The judge answers `none`, there is no committed content and no earlier canonical, and this save's attempt holds a readable tapped capture that is not of a wrapper host | The capture is selected anyway |

**Lone first body:** after both rules, a selection with one candidate on an article with no committed content (the same first-content test the rules above use) skips the judge. A body that answered HTTP 400 or more ends `no-readable` (`lone-error-status`); in the day to 2026-11-03 the judge rejected all 87 such runs. A body of 100 words or more that is not of a wrapper host is selected (`lone-body`). The judge had rejected 81 such pages that day, such as paywall teasers, cookie walls and navigation pages, and the owner accepted that on 2026-11-04 to cut about a third of content-selection spend. A shorter body is judged, and so is a wrapper-host body that did not answer an error status. An automatic capture takes this rule like a crawl copy; it never takes either rule above.

**Tapped, not automatic:** both rules trust a capture because the reader chose it. A capture a client took without the reader's tap carries `captureTrigger: automatic` on its tier-0 manifest. Nobody chose it, so it competes like a crawl copy: neither rule applies, a `none` verdict fails it, and it never raises `ownCaptureFailed`. A manifest whose `captureTrigger` is `manual` or absent holds a tapped capture.

**Boundary:** once an article holds committed content, a capture is still judged, so a co-saver's unreadable capture cannot replace a readable canonical. A committed body with no words and no media is not committed content, so both rules apply as on a first save: 166 rows held one on 2026-10-13, left by the lone-source shortcut that selection dropped on 2026-10-07. A tapped capture may end `no-readable` only when the deterministic readability check rejects it (a blank body, or no words and no media) or when it falls outside the boundary above.

**Guards:**
- An invariant test in the select-content module runs every tier-0 producer against every judge outcome. The test file is named for this rule.
- A sibling test runs an automatic capture against the judge's outcomes (none, a winner, a provider rejection, an HTTP 500) and fails if either rule applies to it. Its file is named for that boundary.
- The comparison log line carries `ownCaptureFailed`, which reports any remaining breach, and each candidate's `captureTrigger` when it has one. The `select-content-own-capture-failed-alarm` CloudWatch alarm emails the alert address on the first one.
- The daily Tier 1+ canary uploads a page through `save-content` and fails unless that upload is the content selected.

Do not remove either rule to "let the judge decide", and do not extend either rule to an automatic capture.

**YouTube video card:** when selection ends with nothing readable and the save's original URL parses as a YouTube video, selection fetches the video's oEmbed and commits a card (title, poster, channel) under `selectionRule: "video-card-fallback"` instead of marking the crawl failed. In the 45 days to 2026-11-02, 77 of 163 prod selections for a YouTube URL ended `no-readable` on a `none` verdict, mostly on an empty shell or the "Sign in to confirm you're not a bot" wall. The card applies only where the save would otherwise fail for having nothing readable: not while the live crawl is deferred to the render tier, not while an older stored capture is withheld from selection, and never over a readable candidate or a retained canonical. When oEmbed refuses or times out, the save fails as before. Do not remove this rule to "let the judge decide" either.

### Gmail sender discovery is a deliberate Lambda self-loop

The Gmail discovery worker pages through a mailbox by re-entering its own queue: each page publishes a progress event that routes back to the same queue, and the progress branch dispatches the next page command to that queue directly (the discovery Lambda's composition root — grep the main app's runtime for `GMAIL_DISCOVERY_QUEUE_URL`). Lambda's recursive-loop detection follows that chain and cut it after roughly 16 invocations in production on 2026-09-12, which meant a mailbox of more than about eight pages could never finish loading. The Lambda is therefore provisioned with recursive-loop detection set to **Allow** (the shared Lambda component's opt-in input that creates the `FunctionRecursionConfig` resource — grep the infra-components package for it). Do not remove it, and do not "fix" a stalled discovery by restructuring the continuation into a longer chain of hops: termination is guaranteed by the page token running out, the generation fence on every page claim, and the DLQ consumer that marks an exhausted run failed.

### Gmail senders load once per mailbox, not once per page view

The Gmail newsletters page and every readlist's Preferences tab show the connected mailbox's senders from the discovery table (`hutch-gmail-discovery`: one state row and one row per sender, per Readplace user, checked against the connected account and gateway address) merged with the senders the six-hourly newsletter monitor has observed. Until 2026-11-06 the Gmail page also started a new discovery generation on every load that lacked `discovery=started`. Each start was a Gmail history list plus one metadata read per changed message, became a full 5,000-message rescan once Gmail had expired the cursor, and showed "Checking for new messages…" with a polling loop on every visit, while the Preferences tab showed "Checking…" for as long as that run lasted; one reader's counter had reached 6,728 checked messages on a 5,000-message window.

A discovery now starts in three cases only: the hidden load-triggered start the Gmail page renders while the connected mailbox has no discovery at all (grep the Gmail page component for `hx-trigger="load"`); the reader's own "Load senders" button on either surface; and the OAuth callback, when a scan was paused waiting for the reader to re-authorise. A new sender reaches both surfaces through the monitor's observations within six hours. Do not restore a load-triggered start, add a time-based refresh, or start a discovery from the Preferences tab to "keep the list fresh".

### The Gmail credentials table lives only while its KMS key does

The table that holds Gmail refresh tokens is encrypted under a customer-managed KMS key created beside it (grep the hutch infra for `hutch-gmail-credentials-key`), for CASA 4.1.3 and 6.7.1. AWS makes the table inaccessible when that key is disabled or scheduled for deletion, and archives it after seven days. Every connected mailbox then stops syncing, and a readlist's Preferences tab fails for every signed-in reader, because the web app reads this table there whether or not the reader connected Gmail. Never disable the key, and never remove the key resource while the table's `SSEDescription` names it. To go back to the AWS-owned key, first deploy `serverSideEncryption: { enabled: false }` with the key kept, confirm `SSEDescription` is gone, and only then remove the key; do not `git revert` the commit that added the key, and never apply a preview that deletes the key and shows no change to the table.

### iOS signs in *inside* the app, and opens our own content links Chrome-first

**Signing in never leaves the app.** App Store review rejected build 53 under Guideline 4 for handing the user to the default browser to authenticate, so Login and Sign up run `/oauth/authorize` in an `ASWebAuthenticationSession` (the App-target presenter that constructs one — grep the iOS Swift sources for `ASWebAuthenticationSession(`), which captures the `readplace://oauth-callback` redirect in-process. Do not route auth back through an external browser, and do not reintroduce the app-level deep-link handler the session replaced: the callback is returned to its caller, so the PKCE verifier lives in one `await` and never has to be persisted.

**Content links stay Chrome-first.** When the app opens a **readplace.com** URL that is *not* auth — the changelog banner's "Learn more" — it reuses the user's existing **Chrome** web session: most users browse in Chrome but never change the iOS default-browser setting, so their OS default stays **Safari**, where they are not signed in. The app rewrites such a URL to Chrome's `googlechrome(s)://` scheme (the Shared-target rewrite — grep the iOS Swift sources for `googlechrome` — opened by the App-target opener that calls it through the seam wrapping `UIApplication.shared.open`) and must **not** fall back to the OS default browser when Chrome is installed — the fallback fires only when the system reports Chrome can't be opened (not installed). Do not reintroduce a `canOpenURL` pre-check to decide the browser (a false-negative probe silently routes the user into Safari and regresses session reuse); let the actual open result decide.

The rewrite is **scoped to our own host** (the iOS app config's server host — the value the rewrite compares the URL's host against), and must stay that way. A link to someone else's site — the bulk of what an article body links to — is handed to the system untouched, because a custom scheme can never be claimed by a **Universal Link**: rewriting it would stop `apps.apple.com`, `youtube.com`, or `x.com` handing off to their native apps, and would override a default browser the user deliberately chose, all to reuse a Readplace session that does not exist on those hosts.

Reuse also depends on the `hutch_sid` session cookie being **persistent** — it carries a `maxAge` (bounded by the server session TTL; the cookie name and its max age are exported together by the shared package that mints and reads the server session cookie — grep the workspace packages' non-test sources for `hutch_sid`) so a Chrome login survives Chrome fully closing; do not downgrade it back to a bare session cookie.

### Webmail pages never leave the store

A webmail tab — Gmail, Outlook and the other hosts on the domain package's non-article host list (grep its non-test sources for `"mail.163.com"`) — is someone's mailbox, not an article, and its URL is generic: every Gmail user's first inbox is `mail.google.com/mail/u/0/`. Article rows, bodies and summaries are keyed by URL and shared by everyone who saves or opens that URL, so a webmail row can hold another person's mailbox. Each surface used to check the host for itself, and a branch added to a route above that route's own check served a stored webmail body.

The rule therefore lives in the read ports, and their types carry it:

| Read | What a webmail URL gets |
|---|---|
| Article body | `not-an-article`, never a body |
| Summary | `skipped` |
| Display metadata (title, site, excerpt, word count, image) | The host stub |
| Related-articles and past-reads rows | Dropped |

Only the functions that apply the rule can mint the body and summary brands (grep the domain package's non-test sources for `brand<"ArticleBody">` and `brand<"ShownSummary">`). Every function written to turn a body into reader output — HTML, EPUB, markdown, MCP — takes the branded body, so a body that skipped the rule does not compile into one.

- Read an article row's body, summary or display metadata only through those ports, and never mint either brand another way.
- A new renderer types its body input as the branded body. The generic HTML converters (markdown, EPUB XHTML) take plain strings because they also convert other HTML: hand them a body only from a branded value.
- A surface's own host check drives behaviour only — no crawl, no polling, the not-an-article notice. It is not what keeps a webmail row private.

### A highlight moves only when its passage moved

An article's body is shared by everyone who saves its URL and is replaced whenever a recrawl or refresh commits new canonical content. A highlight is therefore stored as its quote with the text around it, never as a position, and the server re-anchors every highlight when the canonical body changes.

- A highlight whose passage cannot be found again is kept and listed as "Not found in this version". It is never moved to a weaker match and never deleted: a mark that jumps to the wrong passage costs the reader's trust in every other mark.
- The server anchors only against text it rendered itself. It never trusts offsets a client sends or a publisher's own `<mark>` elements; the highlight route tests and the sanitiser tests guard this.
- The matching thresholds were tuned against real recrawled bodies: on 2026-11-07, 185 highlights over 37 staging recrawl pairs came out 29% anchored in place, 60% moved (almost all the exact quote at a new offset) and 11% not found, every one of those from a single archived page whose versions alternate between two different pages. Change a threshold only with a new measurement.

### ChatGPT runs the tools OpenAI's scan last published

ChatGPT readers call the tool definitions OpenAI's plugin directory published from its last successful scan of our MCP server, not our live `tools/list`, and the scan runs on an OAuth grant of its own. Changing a tool, the scan's credential, the OAuth code, `ANALYTICS_SALT` or the OAuth table is governed by the [MCP skill](./.claude/skills/mcp/SKILL.md), whose guards refuse the dangerous change and name the approval each needs. The [MCP scanner runbook](./projects/hutch/docs/mcp-scanner-runbook.md) has the operations.

### A DeepSeek dead letter is kept to be redriven

**Read the row first.** In the 30 days to 2026-10-24 every judge and summary dead letter moved on without a redrive: of 31 judge rows, 27 were ready on 2026-10-24 and 4 had failed again with a parse error, and the 3 summary rows settled. A late redrive is therefore usually stale. Before you redrive a message, read its article row, and delete the message instead when the row has already moved on. SQS cannot edit a message on the way back, so a redrive runs the old command against the row as it is now. A stale `recrawl-content-extracted` dead letter, one whose candidates were all fetched before the committed canonical, keeps that canonical and pays no judge call; the comparison line logs it as `superseded-by-canonical`. On `select-most-complete-content`, an older attempt's direct resource no longer replaces a canonical fetched later: selection logs `superseded-by-canonical` and keeps the row. Its judge path can still choose an older body, so the rule above stands. `refresh-content-extracted-dlq` needs no prior read, because its handler makes this comparison itself.

Each queue below dead-letters into its own `<queue>-dlq`, and nothing consumes it.

| Queue | On the final receive |
|---|---|
| `select-most-complete-content`, `reselect-after-removal`, `recrawl-content-extracted` | The handler marks the crawl failed, logs `dead-lettered after N receives`, and still fails the record |
| `generate-summary` | The handler marks the summary failed and still fails the record. A message whose article row is gone, as a released private upload's row is, is acknowledged on its first receive and never dead-letters |
| `refresh-content-extracted` | Nothing is marked; the reader keeps the current content. A redrive is safe at any time: the handler acknowledges a message when the row is purged, `unsupported`, or holds a newer fetch than the message, and logs `[RefreshContentExtracted] refused`. Otherwise it commits, which heals |
| `select-article-content` (FIFO; its consumer is disabled until the selection cutover) | It depends on the command's `sourceKind`. A `refresh-content-extracted` command marks nothing, the same as on its own queue. Every other kind marks the crawl failed, the same as the three queues above. A record whose judge claim is held by another owner logs `ownership anomaly` and marks nothing on any receive, so its dead letter leaves the row `pending` until that owner settles it. A failed record is retried only after its 1,800 s visibility ends, and every later selection for that article waits behind it, so a failing message reaches its third receive, where the crawl is marked, about 60 minutes in, and reaches the DLQ about 90 minutes in (1,800 s visibility × `maxReceiveCount` 3) |
| `compute-related-articles` | Nothing is marked; Next read and Already read stay as they were |
| `canonical-content-changed` | Nothing is marked and nothing is written: the handler reads the row and either dispatches `generate-summary` or fails the record, so a redrive cannot damage a row and needs no row reading first. A record keeps failing only while the row cannot be summarised yet: a crawl still `pending` with no readable content (redrive once the crawl has ended), a crawl `ready` with no readable content, or a revoked canonical candidate with no content. Each clears when the crawl ends, a new canonical is committed or the row is tombstoned. When none of those will come, read the row and delete the message |
| `filter-email-links` | The handler marks that readlist's decision failed, and the email page shows its failed line. Every link is already in All |

A redrive of `filter-email-links-dlq` checks the row itself. A decided readlist, an email that no longer selects it, or a read-only account costs no DeepSeek call, and a link the reader chose on that email is not filed again while that choice is among the readlist's 20 newest, nor is a link the reader removed from that readlist after the email arrived. A read-only account's message is consumed and leaves the `failed` line, so restore access before redriving if you want it decided. Anything else is decided under the readlist's purpose today, so read the purpose first if it has changed since the failure. Read the readlist's choices first too: when all 20 are newer than the message, an older choice may already be gone, and no row shows it. Delete the message then, because every link is already in All and the failed line still offers Keep.

Where a handler marks, the reader sees today's failure state. The message is the only copy of the work: once the cause is fixed, a redrive lets the handler replace the failed state. Do not attach a consumer, purge the queue to quiet its alarm, or point the queue back at the shared dead-letter queue, because removing an own dead-letter queue from the Pulumi program deletes it and every message in it.

| Step | What to know |
|---|---|
| Alarm | `<queue>-dlq-alarm` emails each time it enters ALARM, from OK or from INSUFFICIENT_DATA, where an idle queue sits. While one message stays visible it stays in ALARM, so later dead letters send no email: read the queue's depth, not the inbox. |
| Cause | In `/readplace/errors`, a `deepseek-call-failed` line carries `feature`, `kind` and `status`, and no URL. Its `messageId` matches the record-failed line in that Lambda's own log group and, on the three judge queues, the `dead-lettered after` line, which carries the URL. The dead-lettered message's own body always names the article: poll it in the SQS console. |
| Balance | A `status` of 402 is the DeepSeek balance, not the code. Top up, then redrive every queue that alarmed. Triage and the three PDF stages leave no dead letter, because they fail open or fall back to text; their lines count what an outage cost. |
| Redrive | After the fix is live: in the SQS console open the `-dlq` queue and choose Start DLQ redrive to the source queue, or run `aws sqs start-message-move-task --source-arn <dlq arn>`. A message EventBridge put there carries only a `TARGET_ARN` attribute and needs Redrive to custom destination, with the source queue's ARN. A redrive before the fix fails every receive again and pays a DeepSeek call each time. |
| Expiry | A message expires 14 days after it first entered its source queue. A redrive makes it a new message and restarts the 14 days, so redrive once before day 14 when a fix needs longer. |

AWS documents the redrive at https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html.

### A subscription message older than the row's status does not act

`subscription-events-dlq` holds six detail types and a redrive cannot pick between them, so a redrive can deliver a fact about a subscription the reader has since replaced, reactivated or re-opened. Every write that moves a subscription row into a status records the second in `statusEnteredAt`, and a message whose envelope `time` is older does nothing (grep for `messagePredatesStatus` and `markCancelledByEvent`). A new write that changes a row's status must set it, or stale messages will act on that status. An absent value means the status predates the field and is not a refusal: do not make it required, because armed schedules and old rows both depend on that. Redrive this queue with `aws sqs start-message-move-task`, and no row needs reading first.

### User-facing copy comes from the translation files

Readplace serves en-US today and will add en-AU and other languages. A literal string in a template, view model, email or Siren title cannot be translated, and one key missing from one locale ships a blank or English string to every reader of that locale. Copy therefore lives in the translations workspace package (`pnpm nx show projects` names it; its README table lists each surface and its purpose), whose types make every supported locale carry every key with the same `{name}` placeholders.

| Where | How copy reaches the reader |
|---|---|
| A template | `{{t "page.component.element" name=value}}` — an unknown key fails the render |
| TypeScript, for copy chosen by state | `t()` / `tPlural()` from a translator bound once to the surface, arriving through the template's existing `{{vm.field}}` |

- Never write a literal label, sentence, `aria-label`, `placeholder`, `title`, `alt` or meta description in a migrated surface. The brand name and server-supplied text are not copy to translate.
- Adding or changing a key means deciding its value for every locale in the supported-locale list (grep the package for `SUPPORTED_LOCALES`).
- Values never contain HTML. A sentence split around a link becomes `before` / `link` / `after` keys with the `<a>` kept in the template. Plurals are `one` / `other` sub-keys chosen with `Intl.PluralRules`, used only where the code compared a cardinal count `=== 1`.
- Store a code, never a sentence: a row is shared by readers of every locale.
- Read a locale tag from `DEFAULT_LOCALE` instead of writing `"en"` or `"en-US"`. A tag that is part of a contract (crawler `accept-language`, `en_US_POSIX` date parsing, `localeCompare` sorts) stays as written.
- Every new or changed user-facing string goes into the translation files, including in a surface no copy checker covers yet. A literal string needs the human's explicit approval.
- Each web deployable's `copy.test.ts` runs the copy checker over the directories it lists as migrated and fails on literal copy left in a template. Do not extend a checker's exempt list without the human's approval.

Not translated by design: the home, landing, help, support, terms and privacy prose pages and the import FAQ; store and manifest metadata; admin pages and operator dashboards; MCP and WebMCP text; agent documents (`llms.txt`, `llms-full.txt`, `auth.md`, skills); blog posts; log lines; protocol text such as HTTP reason phrases and JSON-RPC bodies.

## Architecture Guidelines

### Brand & Design Guidelines

For colours, typography, voice, and UI conventions, see the [brand guidelines](./BRAND_GUIDELINES.md).

### Web Adapter Conventions

For HTML/CSS/SSR conventions, see the [web skill](./.claude/skills/web/SKILL.md).

### Test Driven Design

For testing conventions and designing testable code, see the [test-driven-design skill](./.claude/skills/test-driven-design/SKILL.md).

### No Cross-Project Relative Imports

Never import from another project using relative filesystem paths (e.g., `../../../../other-project/dist/...`). These create invisible dependencies that bypass the package manager and risk cyclic imports. Extract shared code into a workspace package instead.

```typescript
// BAD - Invisible sideways dependency
const mod = path.resolve(__dirname, "../../../../flights/dist/runtime/test-app");
const { createFlightsTestApp } = await import(mod);

// GOOD - Declared workspace dependency
const { createFlightsTestApp } = await import("flights-test-app");
```

### Filter and Query Testing Strategy

Use integration tests for comprehensive filter/query functionality testing, not E2E tests. Filter logic tests should verify URL parameters produce correct HTML output using supertest + parseHTML.

| Test concern | Test type | Location |
|-------------|-----------|----------|
| Domain Logic | Unit test | `*.test.ts` next to implementation |
| Web Layer | Integration test | `*.route.test.ts` |


E2E tests have ~11s startup overhead per test (browser, server, navigation). Integration tests avoid this overhead while still testing the full server-side flow.

## Coding Style

### Environment Variable Access

Use the two accessors from the workspace package that reads environment variables — one throws when the variable is unset, the other returns undefined when it is unset or empty (`pnpm nx show projects` lists it; its package.json description names both). Never use `process.env` directly. In the examples below, an angle-bracketed name stands for an export of the package just described — read the real name from the package.

```typescript
// BAD - Direct process.env access
const apiKey = process.env.API_KEY;

// GOOD - Required env var (throws if not set)
const apiKey = <required-env accessor>('API_KEY');

// GOOD - Optional env var
const proxyUrl = <optional-env accessor>('HTTPS_PROXY');
```

**Never default missing environment variables.** Always use the required accessor and let the process fail if a variable is not set. Do not use the optional accessor with a fallback (e.g., `<optional-env accessor>("KEY") ?? ""`) to work around CI environments missing secrets. Instead, ensure the CI environment provides the variable. Silent defaults complicate debugging and create behaviour that takes longer to diagnose.

**Exception:** Playwright config files (`playwright.config.*.ts`) must use `process.env` directly. Importing either accessor causes the playwright process to load the env package outside V8 coverage instrumentation, creating uncovered function entries that break the 100% function coverage threshold.

### Logging

Use the logger interface from the shared logging package — the one that also exports a console-backed implementation and a no-op implementation (`pnpm nx show projects` lists it) — for all logging. Never use raw `console.log`/`console.error` in application code. In composition roots, build the logger from the package's console-backed implementation.

```typescript
// BAD - Raw console
console.log("[recovery] Starting…");

// GOOD - the shared logger
const logger = <build shared logger>(<console-backed logger>);
logger.info("[recovery] Starting…");
```

**Swift:** route logging through `os.Logger` (with a subsystem/category) and mark sensitive interpolations `privacy: .private`; raw `NSLog`/`print` is the equivalent of raw `console.log`. Never log credentials, tokens, or user PII (e.g. saved URLs / reading history).

### Comments

Comment policy — when a comment may exist, the human-approval gate that must be cleared *before* one is written, the allowed formats, and the *why*-not-*what*/*how* rule — lives in the [code-comments skill](.claude/skills/code-comments/SKILL.md). Default stance: prefer code that explains its own why (a clearer name, a type, an `assert`, a test); remove comments freely and more often than you add.

### Unused Variables

Use underscore prefix (`_`) to indicate intentionally unused variables. Biome is configured to allow this.

### Runtime Validation with Zod

Use [zod](https://zod.dev/) for validating external input at system boundaries (HTTP requests, external API responses). Do NOT use zod for internal function parameters already typed by TypeScript.

| Method | Use case |
|--------|----------|
| `.safeParse()` | User-facing validation |
| `.parse()` | Invalid data indicates a bug |
| `z.infer<>` | Derive TypeScript type from schema |

**Swift:** the analog is `Codable`/`Decodable` decoded at the boundary with `JSONDecoder().decode` — return `nil`/throw on malformed input rather than force-decoding. Model evolving wire fields as optionals so one bad entity doesn't fail the whole decode.

### Prefer Wrappers Over Global Modifications

When extending functionality (e.g., adding proxy support to fetch), create a wrapper module that exports a decorated version as the default export.

```typescript
// BAD - Modifying global
globalThis.fetch = createProxyFetch();

// GOOD - Wrapper module with same interface
// fetch-with-proxy.ts
export default createProxyFetch();
```

### No Design Pattern Names in Identifiers

Use domain-focused names, not implementation-pattern names.

```typescript
// BAD
interface BookingRepository { ... }
class BookingService { ... }

// GOOD
type SaveBooking = (booking: Booking) => Promise<void>;
type FindBookingById = (id: BookingId) => Promise<Booking | undefined>;
```

**Swift:** SwiftUI/UIKit platform vocabulary — `View`, `ViewModel`, `ViewController` (a `UIViewController` subclass is framework-mandated) — is an allowed exception. The rule still applies to discretionary domain types: prefer a domain name or free functions over `…Service`/`…Manager`/`…Factory`/`…Repository`.

### Named Parameters Over Positional When Types Repeat

When a function signature has 2 or more consecutive parameters of the same type (e.g., `(string, string)` or `(number, number)`), use a named parameter object instead. Positional arguments of the same type are easy to swap by accident (connascence of position is weaker than connascence of name).

```typescript
// BAD - Two consecutive strings are easy to swap
type CheckIn = (passengerRef: string, flightNumber: string) => Promise<CheckInResult>;
await bookings.checkIn("PNR123", "QF1");

// GOOD - Named parameters prevent accidental swaps
type CheckIn = (passenger: { passengerRef: string; flightNumber: string }) => Promise<CheckInResult>;
await bookings.checkIn({ passengerRef: "PNR123", flightNumber: "QF1" });
```

This does NOT apply when the types differ (e.g., `(string, number)`) or when there is only one parameter.

### Prefer Compile-Time Constraints Over Runtime Validation

When a value has a known finite set of valid options, use TypeScript's type system to make invalid states unrepresentable at compile time. Only fall back to runtime validation when the value comes from outside the type system (user input, external APIs).

```typescript
// BAD - Runtime assert for something the type system can enforce
const mode = <required-env accessor>("PERSISTENCE");
assert(mode === "prod" || mode === "development");

// GOOD - Constrained at compile time via generic
const mode = <required-env accessor with the "prod" | "development" generic>("PERSISTENCE");
// mode is typed as "prod" | "development" — no assert needed
```

### No Default Noop Logger in Production Code

Never default a logger dependency to the no-op logger in production code. A missing logger silently swallows errors and makes debugging impossible. Always require the caller to pass a logger explicitly. Use the no-op logger only in test code where logging output is intentionally suppressed.

```typescript
// BAD - Silent failure in production
function createWidget(deps?: { logger?: <logger interface> }) {
	const logger = deps?.logger ?? <no-op logger>;
}

// GOOD - Logger is required
function createWidget(deps: { logger: <logger interface> }) {
	const logger = deps.logger;
}

// GOOD - the no-op logger in tests
const widget = createWidget({ logger: <build shared logger>(<no-op logger>) });
```

**Swift:** same rule — require the caller to pass the logger (e.g. `os.Logger`) rather than defaulting one internally; a silenced logger hides failures identically in any language.

### Use `assert` for Runtime Invariants

Use `assert` from `node:assert` for runtime invariant checks instead of `if`/`throw`. Assert is more concise, communicates intent clearly, and integrates with coverage tooling (no uncovered branches for the truthy path).

```typescript
// BAD - Verbose, creates coverage branches
if (!entity.properties) {
	throw new Error("Server response entity missing properties");
}

// GOOD - Concise, clear intent
import assert from "node:assert";
assert(entity.properties, "Server response entity missing properties");

// GOOD - Strict equality in test code
import assert from "node:assert/strict";
assert.equal(actual, expected, "Values should match");
```

Use `assert` from `node:assert` in production code (non-strict, allows falsy checking). Use `assert` from `node:assert/strict` in test code for strict equality semantics.

**Swift:** use `assert` (debug-only) or `precondition` (also fatal in release) for invariants instead of ignoring an impossible-failure path; prefer `precondition` when the check must hold in shipped/sideloaded builds (e.g. the `SecRandomCopyBytes` status, a required `UserDefaults(suiteName:)`). `guard … else { throw }` remains correct for recoverable / external-input failures.

### No Default In-Memory Implementations

Never default a dependency to an in-memory implementation in production code. All dependencies MUST be mandatory and the in-memory or production implementations are explicitly set at the entry point (composition root). In-memory implementations are for tests only.

```typescript
// BAD - Silent fallback to in-memory
function createWidget(deps: { store?: Store }) {
	const store = deps.store ?? initInMemoryStore();
}

// GOOD - Store is required
function createWidget(deps: { store: Store }) {
	const store = deps.store;
}
```

**Swift:** inject the real store at the composition root; do not silently fall back to a degraded one (`UserDefaults(suiteName:) ?? .standard`, an internally-constructed `URLSession.shared`, or a credential store newed up at the use site). An injectable `init(...)` seam is for tests only.

### Branded Types for Domain IDs

Use branded types to prevent mixing up identifiers.

```typescript
type BookingId = string & { readonly __brand: 'BookingId' };
type PassengerId = string & { readonly __brand: 'PassengerId' };
```

**Swift:** the analog is a single-field wrapper struct — `struct BookingId: Hashable { let raw: String }` — instead of a raw `String`. Especially valuable for two same-typed fields that are easy to transpose (e.g. an access token vs a refresh token).

### Avoid TypeScript Type Assertions (`as`)

Do not use `as` to cast types. Type assertions bypass the compiler and create weak connections between modules — if a type changes upstream, `as` silently hides the mismatch instead of producing a compile error.

```typescript
// BAD - Assertion hides type mismatches
const passengerId = rawValue as PassengerId;
const item = dbResult.Item.seat as string;

// GOOD - Validated factory with Zod + infer
const PassengerIdSchema = z.string().brand<'PassengerId'>();
type PassengerId = z.infer<typeof PassengerIdSchema>;
const passengerId = PassengerIdSchema.parse(rawValue);

// GOOD - Zod schema at system boundary (DynamoDB, HTTP, etc.)
const BookingRow = z.object({
  id: BookingIdSchema,
  seat: z.string(),
  // ...
});
function fromItem(item: Record<string, unknown>): Booking {
  return BookingRow.parse(item);
}

// BAD - Faking a partial object with `as`
function fakeSeatMapResponse(): Response {
  return { status: 200, ok: true } as Response;
}

// GOOD - Partial<T> makes the subset explicit
function fakeSeatMapResponse(): Partial<Response> {
  return { status: 200, ok: true };
}
```

**Allowed exceptions:**

| Exception | Reason |
|-----------|--------|
| `as const` | Not a type assertion — narrows literal types |
| Isolated Node.js API wrappers (e.g., `promisify(scrypt)` returning `Buffer`, the required-env accessor's generic) | The `as` is already contained in a single wrapper function with no better alternative from the type definitions |
| A test fake bound to an existing signature (e.g. a `fetch` fake that must satisfy `typeof fetch` → `Promise<Response>`, as in [Tests Simulate Explicit HTTP Statuses](#tests-simulate-explicit-http-statuses)) | `Partial<T>` is not assignable where the full type is required, so the cast is forced. Still prefer `Partial<T>` whenever you control the return type, as in the `fakeSeatMapResponse` example above |

**Swift:** the analog of `as` is force-cast `as!`, force-try `try!`, force-unwrap `!`, and `fatalError` — all bypass the compiler. Use `guard let … else { throw }` / `as?` for anything from external input (user-typed URLs, network bodies). Allowed, mirroring `as const` / isolated-wrapper above: force-unwrapping a compile-time-constant literal, and Apple's implicitly-unwrapped delegate parameters (e.g. `WKNavigation!`), which are framework-defined, not your assertions.

### Tests Simulate Explicit HTTP Statuses

A test fake that answers HTTP takes the actual status the test wants to simulate — never a boolean the fake maps to a status. `ok ? 200 : 403` hides which failure is under test and cannot express a second failure class without another flag.

```typescript
// BAD - the boolean hides the simulated status
function fakeTimetableFetch(body: Buffer, ok = true) {
	return async () => ({ ok, status: ok ? 200 : 403 }) as Response;
}

// GOOD - the caller states the status; ok derives from it like a real Response
function fakeTimetableFetch(body: Buffer, status = 200) {
	return async () => ({ ok: status >= 200 && status < 300, status }) as Response;
}
```

## CLI Commands

### New Commands Require Approval

Never add a new command — a `package.json` script, a `scripts/*.js` entry point, or an nx target — without explicit human approval. Propose it and wait; if it is refused, the change ships without it.

```jsonc
// BAD - a new script added unprompted
"refresh-seat-maps": "node scripts/refresh-seat-maps.js",
```

### AWS Accounts

Name the account on every command: staging is `--profile hutch-staging` and prod is `--profile hutch-production` (both `ap-southeast-2`). A machine's default credentials can reach neither: on 2026-11-09 one developer machine's defaults belonged to an unrelated, empty account. Node scripts must also unset `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, which take precedence over `AWS_PROFILE`.

### Prefer Longhand Parameters

Always use longhand (full) parameter names in CLI commands for clarity.

```bash
# GOOD - Self-documenting
livereload src --exts html,css,ts --wait 500

# Avoid - Requires API knowledge
livereload src -e html,css,ts -w 500
```

## Test Runner Logging

When logging test phase transitions (e.g., "Running unit tests", "Running E2E tests"), prefix with the project name so it's clear which project is running when multiple projects run together.

```javascript
// BAD - Ambiguous in monorepo output
console.log('\n=== Running E2E tests ===\n')

// GOOD - Clear which project is running
console.log('\n=== Readplace - Running E2E tests ===\n')
```

## Code Coverage

### Coverage Over Legibility

100% code coverage is more important than code legibility. When a code path cannot be exercised by tests — whether due to V8 engine instrumentation quirks (e.g., `??` creating unreachable branches) or because the fallback is unreachable by design — remove the dead code OR rewrite it to eliminate the untestable path. Do not leave dead fallbacks in place and lower thresholds to accommodate them.

```typescript
// BAD - ?? creates a V8 branch for a null case that never happens
const wrapper = document.querySelector("div") ?? document.documentElement;

// GOOD - assert eliminates the untestable branch (no V8 branch in caller)
const wrapper = document.querySelector("div");
assert(wrapper, "parseHTML('<div>...') must produce a <div>");
```

When V8 coverage instrumentation requires restructuring code, make those changes with explanatory comments linking to verified online resources.

### No Coverage Ignore Comments

Coverage ignore comments (`/* c8 ignore */`) are forbidden unless explicitly approved. Instead, restructure code to eliminate untestable branches.

```typescript
// BAD - hiding untested code
/* c8 ignore start */
if (value === null) { return defaultValue }
/* c8 ignore stop */

// GOOD - assertion fails fast
assert(value !== null, 'Value must not be null')
```

### Allowed `c8 ignore` Cases

When `c8 ignore` is necessary, use inline comments — do NOT add individual files to `enforce-coverage.config.js` `extraExcludePatterns`. Config excludes are for whole directories (e.g., `src/infra/**`).

**Thin AWS SDK wrappers** tested via integration tests (not Jest): use whole-file `/* c8 ignore start/stop */` with a reason.

```typescript
/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
export function initS3PutObject(deps: { client: S3Client; bucketName: string }) { ... }
/* c8 ignore stop */
```

**CI-only retry callbacks** that never fire during a passing local run:

```typescript
retryHook: /* c8 ignore next */ async (page) => { await page.reload() },
```

**V8 async function artifacts**: `await` and `return` statements in `async` functions create V8 continuation branches that no test can exercise — they are runtime state machine internals, not logical code paths. Use `/* c8 ignore next */` on the specific line.

**V8 block coverage phantoms**: V8's bytecode-level block coverage creates zero-count sub-ranges inside executed code. These appear as uncovered branches in c8/v8-to-istanbul output even though the code runs. Common triggers: `||`/`&&` continuation counters, `for...of` iterator protocol, ternary `?:` combined with `||`. Code restructuring only moves the phantom — it does not eliminate it. Use `/* c8 ignore next */` with a reference to [bcoe/c8#319](https://github.com/bcoe/c8/issues/319) and [V8 block coverage design](https://v8.dev/blog/javascript-code-coverage). Where possible, use `assert` to replace `||` fallbacks that guard against `null`/`undefined` — this eliminates real uncovered branches (the assert's branch lives inside the assert function, not in the caller's V8 block coverage).

### Never Add Excludes or Ignore Patterns to Coverage, Lint, Knip, etc. Without Approval

Never add exclude patterns to any `enforce-coverage.config.js` or `enforce-coverage.config.base.js` including knip, biome, etc. without explicit human approval. When coverage fails because a file needs to be excluded, present the situation and ask before adding the pattern.

## CI/CD Guidelines

### Always Verify Changes with `pnpm check`

Run `pnpm check` (or `pnpm nx run <project>:check` for a single project) to verify changes. Do NOT run lint, type-check, tests, coverage, knip, or unused-css individually — the `check` target already composes all of them under one nx invocation, mirrors what the pre-commit hook runs, and uses the same nx cache. Reaching into the underlying tooling separately wastes time, gets different cache hits than the hook does, and can mask mismatches between local verification and the pre-commit run.

```bash
# GOOD - one command, matches the pre-commit hook
pnpm check

# GOOD - single project
pnpm nx run <project>:check

# BAD - bypasses the meta-target, drifts from the hook
pnpm exec tsc --noEmit
pnpm exec biome lint src
pnpm nx run <project>:test-with-coverage
```

Use individual nx targets only when `pnpm check` has already surfaced a specific failure and you're isolating that one task while debugging.

### Verify Infrastructure Changes with `pnpm check-infra`

After any infrastructure change — a Pulumi program (anything under an `infra` directory), a `Pulumi.*.yaml` stack config, a shared infra component, or a deploy input that alters a built artifact (e.g. the OCR `Dockerfile`) — run `pnpm check-infra` and confirm the preview is the diff you intend: no unexpected replace, delete, or drift. Do this before pushing. For a single stack, `pnpm nx run <project>:check-infra`.

`pnpm check` does not preview infrastructure, by design: it must stay credential-free so fork-PR CI can run it with no cloud secrets.

### Never Bypass Git Commit Hooks

Never use `--no-verify` without explicit human approval. If hooks fail:
1. Investigate the failure
2. Fix the underlying issue
3. Ask the human if you cannot fix it

See the [git-commit skill](./.claude/skills/git-commit/SKILL.md) for pre-commit hook failure diagnostics.

### Commit Directly to Main

Commit and push directly to `main`. Do not create a feature branch unless a human explicitly approves one for a specific change. This overrides any default behaviour that branches off the main branch before committing — the standing instruction is that every commit lands on `main` unless a human says otherwise.

### Unrelated Small Changes Ship as Their Own PR

A small cleanup or refactor that is unrelated to the change being worked on — a stale comment fix, a rename, a drive-by simplification — must not ride the working diff. Send it as its own PR via the GitHub API (`gh pr create`) so the main change stays reviewable and the cleanup lands on its own merits.

## Agent Workflows and Model Selection

### Learnings go where every instance reads them

Never save a learning to an agent's local memory, the per-machine auto-memory directory. Other sessions, other machines and CI's `@claude` runs never see it, and nobody reviews it. A guideline, a clarification or a correction a human makes goes into CLAUDE.md, a skill, a runbook, or the code itself (a test, a type, a name), so every instance gets it.

### Workflows are opt-in and sized to the task

A multi-agent workflow spawns many agents at once, and the tokens they burn are the human's to spend. Run one only when the human asks for it in their own words, invokes a skill or command that calls for one, or has turned ultracode on for the session. A task that would merely go faster in parallel is not a request for a workflow: do it inline, or delegate the independent parts to single subagents and relay what they find.

When a workflow is warranted:

- Give every agent a brief that stands alone — the goal, what is already ruled out, and where to look — because the brief is the only context it has.
- Keep each agent's scope narrow enough that its report can be checked, not just trusted. An agent handed a hypothesis tends to return it confirmed.
- Never run the same work inline that a spawned agent is already doing; wait for the result.

### A limit pauses a workflow; it never restarts one

In the week to 2026-10-31, 39 workflow sessions on one machine accounted for 99% of what it spent, and 87% of that went to the agents they spawned. 639 of those 2,193 agents — 42% of the agents' spend — were started by "rerun everything that did not complete, the limit is reset" prompts, and the agents logged 289 rate-limit errors. About one workflow launch in six resumed by run id; the rest re-ran every agent, finished ones included.

- A workflow that a limit, a kill or a script edit stopped is resumed with its run id (`resumeFromRunId`): agents that finished return their cached result and only the rest run. Read the run's journal first; a finished agent's result is already there.
- Every agent writes its findings to the file its brief names as it goes, before the summary it returns, so the work a limit kills is on disk.
- Before a workflow starts, check `/usage`. A Fable phase does not start above about three quarters of the 7-day limit: it waits for the reset, or runs on Opus 5.5 after the approval the model table requires.

### An agent is sized to finish inside one context

That same week the median agent needed 16 model calls. The 16% of agents that outgrew their 400k-token context and compacted spent 41% of all agent tokens, and agents over 30 calls were 35% of agents and 69% of the spend. The longest ran 235 to 358 shell commands on a 150k-token context — 84% of them `ls`, `cat`, `head` or `sed` — and compacted up to 14 times for a handful of edits. An agent that compacts has lost its brief and the findings it had not yet written down; what it costs is the result that then has to be redone.

- Every brief states a budget — about 30 tool calls — and an exit rule: when the budget is spent, write what was found and what is left to the named file, and stop. The orchestrator splits the remainder into new agents; it never lets one agent run on.
- A brief points at files and sections and says what to grep for. It never pastes a plan, a document or another agent's output: 425 briefs that week exceeded 20k characters, the largest a 668k-character dump of earlier agents' findings, and every pasted character is cached again for each agent that receives it.
- An agent batches its shell commands, sieves output with `head`, `grep` or a redirect to a file, and reads a file once, by range. Every tool call sends the whole context again.
- A read-only stage — locate files, list call sites, summarise a document — runs as the Explore agent type (`agentType` in a workflow script, `subagent_type` in the Agent tool), which skips CLAUDE.md and runs Opus 5.5 at low effort. CLAUDE.md is about 10k tokens and was loaded into every one of the week's roughly 2,100 agents, most of which only searched.

### Which model for which work

Current as of 2026-11-01. Pick by the kind of judgment the step needs, not by what is cheapest or newest; a human's explicit choice for a task overrides this table.

| Work | Model | Effort | Why |
|---|---|---|---|
| Locating and reporting — finding files, listing call sites, summarising a document | Opus 5.5, as the Explore agent type | low | The answer is what the search returns; reasoning effort adds thinking to every call and nothing to the result |
| Coding tasks — writing or editing code, tests, fixes, refactors, running `pnpm check` | Opus 5.5 | medium | Fast, capable at well-specified implementation, and cheaper than a reasoning-tier model for work the tests will verify |
| Checking a claim against the code — does the module do what the finding says, does the reproduction reproduce, does the test fail without the fix | Opus 5.5 | medium | The check is implementation-grade work with a yes-or-no answer; the judgment it feeds is the Fable call |
| Complex reasoning and decisions — architecture choices, root-cause analysis across a pipeline, security judgments, ambiguous trade-offs, judging another agent's plan or findings | Fable 5.1 | high, named on the call | Mythos-class reasoning is what catches the subtle failure; a cheaper model's confident wrong answer costs more than the tokens saved |

The split applies to delegated work too: a subagent or workflow step that implements a decision runs on Opus 5.5 at medium effort, and the step that makes the decision runs on Fable 5.1. When one task mixes both — a decision that is then implemented — make the decision first on Fable, then hand the implementation to Opus with the decision written into its brief.

A workflow makes one Fable call per question it has to answer: the judge. The stages that gather what the judge weighs — the analyst, the skeptic, the reproduction — run on Opus. In the week to 2026-10-31 thinking was 21% of everything spent and Fable agents 20%; one script ran four Fable agents per plan (an analyst, two skeptics and a judge) across ten plans, and 146 workflow calls named Fable without an effort, so each inherited the session's `xhigh`. Name the effort on every delegated call: an unnamed one inherits whatever the session runs at.

If Fable is unavailable or has hit the limit, Use Opus 5.5 Max in its place instead after user's approval asked via the Ask tool.

### Delegated agents never run the full check

`pnpm check`, a project's full `check` and the pre-commit hook are the heaviest work in the workspace: hutch's `check` alone runs 14 parallel coverage shards, then its Playwright suite in Docker. The machine that runs them locally also hosts the self-hosted CI runners: the OrbStack runner that runs `web-tests` and the `@claude` listener, and the macOS runner whose Visual Review loads an ~18 GB vision model (the [macOS runner README](./.github/runner/macos/README.md)). On 2026-10-18 an implementer agent and a reviewer agent each ran full checks while another session checked 15 worktrees, and memory reached about 56 GB on a 48 GiB machine. Later that day a single local hook that overlapped CI's `web-tests` and Visual Review left 4% of memory free.

- Never brief a subagent or workflow step to run `pnpm check`, a project's full `check`, or a `git commit` that fires the hook. The session that spawned the agents runs the one full check once their changes are in; an agent fixing a failure that check surfaced re-runs only the failing test.
- At most three heavy tasks run on the machine at once. A heavy task is a `pnpm check`, a project's full `check`, a `git commit` whose pre-commit hook runs the check, or a CI job on one of the self-hosted runners (`web-tests` on the OrbStack runner, the Visual Review on the macOS runner); a GitHub-hosted job is not on this machine and does not count. Count the ones already running and start yours while the count is below three: two running is fine. Each busy self-hosted runner counts as one (`gh api repos/{owner}/{repo}/actions/runners`), and each other session's running check counts as one by its `nx` root process, not the jest and Playwright children it spawns (the process list shows them). The cap replaced an idle-machine rule on 2026-11-06: the machine idles for seconds to a minute between checks, so sessions that waited for it found it busy again by the time they started, and queued while there was room to run. A `@claude` listener run starts the check its prompt asks for without waiting: on the OrbStack runner it holds the runner's only job slot.

### Gmail settings under browser automation open from the Inbox

A browser-automation session that loads a Gmail settings URL directly can get a degraded settings page. On 2026-11-08, `#settings/fwdandpop` opened cold showed a plain text box where "Add a forwarding address" should be, and saving it answered "Invalid forwarding address". Saving an already-verified address there can also switch on forward-all. Load the Inbox first, then open Settings from inside the app. The proper forwarding controls then appear.

## Architecture

### Project Structure

Monorepo at the repository root; `pnpm nx show projects` is the authoritative list of projects. The main application (the project that mounts the import commit route `/:id/commit` — grep for it) keeps its source under `src/`, in two directories:

- `src/runtime/` — Application code (Express SSR app and Lambda entry points)
- `src/infra/` — Infrastructure as Code (Pulumi)

New workspace packages and projects start from `pnpm generate-package` and
`pnpm generate-project`: they emit the standard config set, including the
package/project difference in whether jest and knip extend the root bases.

### Runtime vs Infra Code

A module belongs under an `infra` directory only if it imports Pulumi. Everything else belongs under `runtime` — including Lambda entry points and composition roots that wire dependencies but have no test-worthy logic. Nothing outside `infra` should import from `infra`.


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->
