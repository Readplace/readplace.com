# Inbox link-preview flow (M3)

> **Commit:** `cd26b26` · **Date:** 2026-06-28 · **Branch:** `claude/email-link-previews-bs64f0`
> **Subject:** feat(hutch,save-link): wire the inbox link-preview pipeline end to end

After M2 stored a forwarded newsletter and published the past-tense
`EmailReceivedEvent` (with no consumer), M3 attaches two consumers that extract
the links inside the email and crawl a **preview** of each — title, excerpt,
lead image, site name — exactly like the `/queue` cards, **with nothing saved to
the reading queue**. Everything stays behind `?feature=email`.

The pipeline mirrors how `/queue` fans each imported URL into its own
`SaveLinkCommand`: `extract-email-links` emits one `CrawlEmailLinkPreview` per
link, and `crawl-email-link-preview` consumes one per message — SQS gives the
fan-out concurrency, per-link retry, and per-link DLQ isolation for free.

> File paths in this document are accurate as of this commit and may later move.

## Legend

| Role | Fill | Stroke |
|---|---|---|
| Command | `#a6d8ff` | `#1e6fb8` |
| System / aggregate | `#fff2a8` | `#a08a00` |
| Event | `#ffb976` | `#a85800` |
| Policy / gate | `#d6b8ff` | `#6b3fb0` |
| Read model / store | `#b8e8c5` | `#2f7a45` |
| Queue | `#e8e8e8` | `#666` |
| DLQ | `#f8c8c8` | `#a83434` |

**Nodes introduced by this change are outlined in thick amber (`:::new`).**

## Extract flow — `EmailReceivedEvent` → links + fan-out (★14)

`extract-email-links` re-derives the body from the **immutable raw `.eml`** (read
raw → re-parse → re-sanitize through the shared `deriveSanitizedBody`), so a
future parse/sanitize change applies to extraction too — never a body sanitized
by stale logic. It extracts URLs, applies the per-email soft cap (200), writes
one `pending` link row per URL, and fans out one `CrawlEmailLinkPreview` per link.
The per-email meta row is **always** written last as an "extraction finished"
barrier (its presence is what the detail view polls against); `truncated` is just
one field on it. A truncated email still ships the first N previews (the working
path) while raising an alert on a **dedicated alert queue** — off the failure DLQ,
so the DLQ's depth alarm stays unambiguous (degrade-with-alert, deterministic
count signal only).

```mermaid
flowchart TD
	classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#06243b;
	classDef system fill:#fff2a8,stroke:#a08a00,color:#3a3000;
	classDef event fill:#ffb976,stroke:#a85800,color:#3a1e00;
	classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
	classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f3a1f;
	classDef queue fill:#e8e8e8,stroke:#666,color:#222;
	classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3a0d0d;
	classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#2a1a00;

	ERE[EmailReceivedEvent<br/>userId, receivedAtMessageId]:::event
	rule[EventBridge rule<br/>source hutch.inbox / EmailReceived]:::new
	q[extract-email-links SQS]:::new
	dlq[extract-email-links DLQ<br/>+ alarm -> SNS email]:::dlq
	h[extract-email-links Lambda<br/>extract-email-links-handler.ts]:::new

	getEmail[(inbox-emails table<br/>getEmail — skip if status != received)]:::store
	rawS3[(raw .eml bucket<br/>readRawEmail)]:::store
	derive[parseEmail + deriveSanitizedBody<br/>re-derive body from raw]:::system
	extract[extractUrls + capEmailLinks<br/>soft cap 200]:::system
	putLink[(inbox-email-links table<br/>putLink one pending row per url)]:::new
	meta[(inbox-email-links table<br/>putLinksMeta — always, extraction-finished barrier)]:::new
	alert[alertTruncated<br/>SendMessage -> dedicated alert queue]:::policy
	alertq[extract-email-links truncated-alert queue<br/>+ depth alarm -> SNS email]:::dlq
	pub[publish CrawlEmailLinkPreview<br/>one per link]:::new

	ERE --> rule --> q --> h
	q -. maxReceiveCount .-> dlq
	h --> getEmail
	h --> rawS3
	h --> derive --> extract
	extract -->|each url| putLink --> pub
	extract --> meta
	extract -. if truncated .-> alert --> alertq
	pub --> CELP[CrawlEmailLinkPreview]:::new
```

## Crawl flow — `CrawlEmailLinkPreview` → preview, no queue write (★16)

`crawl-email-link-preview` runs the same SSRF-guarded `crawlAndFinalizeArticle`
the save pipeline uses (fail-closed `validateSaveableUrl` + `isBlockedIpAddress`
on every connect/redirect hop), keeps only the metadata, **discards the body**,
and stamps the outcome on the link row. A dead/blocked/paywalled link is an
expected `failed` preview (the record is ACKed); only a store-write fault or a
malformed envelope fails the record to the DLQ. Neither Lambda is granted the
articles/user-articles tables — the "nothing saved to /queue" invariant lives at
the IAM boundary.

```mermaid
flowchart TD
	classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#06243b;
	classDef system fill:#fff2a8,stroke:#a08a00,color:#3a3000;
	classDef event fill:#ffb976,stroke:#a85800,color:#3a1e00;
	classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
	classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f3a1f;
	classDef queue fill:#e8e8e8,stroke:#666,color:#222;
	classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3a0d0d;
	classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#2a1a00;

	CELP[CrawlEmailLinkPreview<br/>userId, receivedAtMessageId, ordinal, url]:::new
	rule[EventBridge rule<br/>hutch.inbox / CrawlEmailLinkPreview]:::new
	q[crawl-email-link-preview SQS<br/>batchSize 1]:::new
	dlq[crawl-email-link-preview DLQ<br/>+ alarm -> SNS email]:::dlq
	h[crawl-email-link-preview Lambda<br/>crawl-email-link-preview-handler.ts]:::new

	ssrf{validateSaveableUrl<br/>+ isBlockedIpAddress}:::policy
	crawl[crawlAndFinalizeArticle<br/>metadata only — body discarded]:::system
	img[(content bucket<br/>lead-image upload via CDN)]:::store
	outcome[(inbox-email-links table<br/>setLinkOutcome crawled / failed)]:::new

	CELP --> rule --> q --> h
	q -. genuine fault .-> dlq
	h --> ssrf
	ssrf -- unsafe-url --> outcome
	ssrf -- ok --> crawl
	crawl -->|fetched| img
	crawl -->|fetched / failed / unsupported| outcome
```

## Read flow — Articles tab + per-card poll (behind ?feature=email)

The detail page reads `inbox-email-links` in one partition Query. Before the
extractor writes its meta barrier the Articles panel itself polls
`GET /inbox/:id/articles` every 3 s (a "Looking for links…" state) and swaps in the
finished card set the instant extraction completes — so a just-received email is
never shown a terminal "No links found", and the card set is never frozen
mid-extraction. Once the cards render, each `pending` card polls
`GET /inbox/:id/links/:ordinal/card` every 3 s (etag + 304, shared `MAX_POLLS`
budget) until terminal — reusing the `/queue` card machinery. The list and detail
header show an "N links" badge derived from the same Query (no parent-row
denormalisation). The crawl is paid once at receipt; the tab never triggers one.

```mermaid
flowchart TD
	classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#06243b;
	classDef system fill:#fff2a8,stroke:#a08a00,color:#3a3000;
	classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
	classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f3a1f;
	classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#2a1a00;

	detail([GET /inbox/:id]):::command
	detailSys[inbox.page.ts GET /:id]:::system
	links[(inbox-email-links table<br/>listLinksByEmail — links + meta)]:::store
	panel[Articles panel<br/>one card per link + N-links badge]:::new

	panelpoll([GET /inbox/:id/articles every 3s while extracting]):::command
	panelpollSys[inbox.page.ts /:id/articles<br/>poll until meta barrier present]:::new

	poll([GET /inbox/:id/links/:ordinal/card every 3s]):::command
	pollSys[inbox.page.ts poll route<br/>etag + 304, omit poll url when terminal]:::new
	getLink[(inbox-email-links table getLink)]:::store
	card[inbox-article-card fragment<br/>pending / crawled / failed]:::new

	list([GET /inbox]):::command
	listSys[inbox.page.ts GET /<br/>per-email count Query, fired concurrently]:::system
	badge[N-links badge per row]:::new

	detail --> detailSys --> links --> panel
	panelpoll --> panelpollSys --> links
	poll --> pollSys --> getLink --> card
	list --> listSys --> links
	listSys --> badge
```

## Command → System → Event(s) reference

| Command / trigger | System (handler) | Event(s) emitted | Next |
|---|---|---|---|
| `EmailReceivedEvent` | `extract-email-links` Lambda | **`CrawlEmailLinkPreview`** (one per link) | crawl consumer |
| link cap hit | `extract-email-links` Lambda | none — `truncated` flag on the meta barrier + dedicated alert-queue message | alert-queue depth alarm → operator |
| `CrawlEmailLinkPreview` | `crawl-email-link-preview` Lambda | none — `setLinkOutcome` write | — (nothing to /queue) |
| `GET /inbox/:id` | `inbox.page.ts` `GET /:id` | none (read model) | per-card poll |
| `GET /inbox/:id/links/:ordinal/card` | `inbox.page.ts` poll route | none (read model) | self until terminal |
| `GET /inbox` | `inbox.page.ts` `GET /` | none (read model) | — |

### Wire format

```
CrawlEmailLinkPreview
  name:        "crawl-email-link-preview"
  source:      "hutch.inbox"
  detailType:  "CrawlEmailLinkPreview"
  detail:      { userId, receivedAtMessageId, ordinal, url }   (all strings)
```

### Storage — `hutch-inbox-email-links`

```
PK  userLinkGroup = `${userId}#${receivedAtMessageId}`   (all links of one email colocate)
SK  ordinal       = "0000".."1999"  (link rows)  |  "meta"  (reserved per-email summary)
link row:  url, status (pending|crawled|failed), title?, excerpt?, siteName?, imageUrl?, failureReason?
meta row:  truncated   (always written once extraction finishes — its presence is the "extraction ran" barrier the detail view polls against)
```

One partition Query answers every read (Articles tab, per-card poll, list/header
badge) — no GSI, no scan. Kept forever (no TTL); re-derivable from the raw `.eml`.
Deletion protection + PITR guard the cache.
