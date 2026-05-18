# Cross-Lambda Comprehensive Crawl Split — Event Storming

**Base commit:** `a44a728` &nbsp;•&nbsp; **Commit date:** 2026-05-18 &nbsp;•&nbsp; **Generated:** 2026-05-18 &nbsp;•&nbsp; **Branch:** `claude/split-crawl-paths-XTNnX`
**Subject:** `feat(@packages/check-failed-articles): exclude browser-internal scheme URLs from canary (#345)` (this snapshot reflects the working-tree state after the comprehensive-crawl split lands)

A point-in-time map of the new comprehensive-crawl split: the PDF / heavy crawl path is lifted out of the simple-only save-link / save-anonymous-link / recrawl-link-initiated Lambdas into a dedicated `comprehensive-crawl-command` Lambda fed by a new EventBridge command (`ComprehensiveCrawlCommand`). Save-link Lambdas no longer hold a concurrency slot during PDF extraction — they dispatch and return.

What is new in this snapshot:

- **`ComprehensiveCrawlCommand`** — new EventBridge command (`source: "hutch.save-link"`, `detailType: "ComprehensiveCrawlCommand"`, detail: `{ url, userId?, recrawl? }`). Published by `save-link-work` whenever `simpleCrawl` returns `unsupported`. The downstream Lambda branches on `recrawl` to emit either `TierContentExtractedEvent` (default save path) or `RecrawlContentExtractedEvent` (admin recrawl path).
- **`comprehensive-crawl-command` Lambda** — new Lambda with its own SQS queue, DLQ, and EventBridge subscription. Holds the mupdf + DeepInfra deps that previously lived on the three save-link Lambdas. Runs the comprehensive crawl, parses the resulting HTML, writes a tier-1 source, and emits the appropriate downstream event itself.
- **`comprehensive-crawl-dlq` Lambda** — mirrors `save-link-dlq`: flips `crawlStatus="exhausted"` and emits `CrawlArticleFailedEvent` when the comprehensive Lambda exhausts its `maxReceiveCount`.
- **`tier-1-deferred` `SaveLinkWorkResult`** — new return variant. `saveLinkWork` writes `crawlStage="comprehensive-fetching"`, dispatches the command, and returns. The caller logs and does **not** publish `TierContentExtractedEvent` — the comprehensive Lambda owns that emission.
- **Simple-only save-link Lambdas** — `save-link-command`, `save-anonymous-link-command`, `recrawl-link-initiated` all drop their mupdf / OpenAI / `DEEPINFRA_API_KEY` dependency footprints. Memory shrinks from 2048→512 MB, timeout from 600→240 s, SQS visibility from 1200→480 s. PDFs no longer compete with HTML for these Lambdas' concurrency.

> Snapshots are historical. Any file path referenced below may be renamed, moved, or deleted in the future. Treat as an artefact, not a live guide.

---

## Legend

```mermaid
flowchart LR
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    C[Command]:::command
    S[System / aggregate]:::system
    E[Event]:::event
    P[Policy / reaction]:::policy
    R[Read model / store]:::store
    Q[(Queue)]:::queue
    D[(DLQ)]:::dlq
    N[New in this snapshot]:::new
```

---

## End-to-end flow — every entry path through the new dispatch boundary

The three callers below all share the same `saveLinkWork` worker. When the simple crawl bails on a non-HTML content type, `saveLinkWork` writes a `comprehensive-fetching` stage marker, publishes `ComprehensiveCrawlCommand`, and returns `"tier-1-deferred"`. The save-link Lambda releases its SQS message and frees its concurrency slot immediately — the comprehensive Lambda picks up the command on its own queue.

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    %% Callers
    UserSave[POST /save / /queue]:::policy
    AnonView[GET /view of anonymous URL]:::policy
    AdminRecrawl[POST /admin/recrawl]:::policy

    SLC[SaveLinkCommand]:::command
    SALC[SaveAnonymousLinkCommand]:::command
    RLI[RecrawlLinkInitiatedEvent]:::command

    UserSave --> SLC
    AnonView --> SALC
    AdminRecrawl --> RLI

    %% Caller Lambdas (simple-only)
    SLCWorker[save-link-command Lambda<br/>simple-only crawl<br/>512 MB / 240 s]:::system
    SALCWorker[save-anonymous-link-command Lambda<br/>simple-only crawl<br/>512 MB / 240 s]:::system
    RLIWorker[recrawl-link-initiated Lambda<br/>simple-only crawl<br/>512 MB / 240 s]:::system

    SLC --> SLQueue[(save-link-command queue<br/>vis 480 s)]:::queue --> SLCWorker
    SALC --> SALQueue[(save-anonymous-link-command queue<br/>vis 480 s)]:::queue --> SALCWorker
    RLI --> RLIQueue[(recrawl-link-initiated queue<br/>vis 480 s)]:::queue --> RLIWorker

    %% Worker logic
    SLCWorker -->|simpleCrawl fetched<br/>+ readability + media + S3<br/>tier-1 source written| TCEx[TierContentExtractedEvent<br/>url, tier=tier-1, userId]:::event
    SALCWorker -->|simpleCrawl fetched| TCEx2[TierContentExtractedEvent<br/>url, tier=tier-1]:::event
    RLIWorker -->|simpleCrawl fetched| RCEx[RecrawlContentExtractedEvent<br/>url]:::event

    %% Unsupported → dispatch new command
    SLCWorker -.->|simpleCrawl unsupported<br/>markCrawlStage comprehensive-fetching<br/>dispatch + return tier-1-deferred| CCC[ComprehensiveCrawlCommand<br/>url, userId]:::new
    SALCWorker -.->|simpleCrawl unsupported| CCCAnon[ComprehensiveCrawlCommand<br/>url]:::new
    RLIWorker -.->|simpleCrawl unsupported| CCCRecrawl[ComprehensiveCrawlCommand<br/>url, recrawl=true]:::new

    %% Comprehensive Lambda + queue + DLQ
    CCQueue[(comprehensive-crawl-command queue<br/>vis 1200 s)]:::new
    CCC --> CCQueue
    CCCAnon --> CCQueue
    CCCRecrawl --> CCQueue

    CCWorker[comprehensive-crawl-command Lambda<br/>simple+comprehensive crawl<br/>mupdf + DeepInfra<br/>2048 MB / 600 s]:::new
    CCQueue --> CCWorker

    %% Worker logic
    CCWorker -->|comprehensiveCrawl fetched<br/>+ readability + media + S3<br/>tier-1 source written<br/>recrawl=false| TCEx3[TierContentExtractedEvent<br/>url, tier=tier-1, userId]:::event
    CCWorker -->|comprehensiveCrawl fetched<br/>recrawl=true| RCEx2[RecrawlContentExtractedEvent<br/>url]:::event
    CCWorker -->|comprehensiveCrawl unsupported<br/>e.g. scanned PDF, OCR empty<br/>markCrawlUnsupported| Terminal[(article row<br/>crawlStatus=unsupported)]:::store

    %% DLQ
    CCQueue -. exhausted retries .-> CCDLQ[(comprehensive-crawl-command DLQ)]:::dlq
    CCDLQ --> CCDLQLambda[comprehensive-crawl-dlq Lambda<br/>markCrawlExhausted]:::new
    CCDLQLambda --> CAFE[CrawlArticleFailedEvent]:::event

    %% Downstream consumers - unchanged
    TCEx --> Sel[select-most-complete-content Lambda]:::system
    TCEx2 --> Sel
    TCEx3 --> Sel
    RCEx --> RSel[recrawl-content-extracted Lambda]:::system
    RCEx2 --> RSel
```

---

## What the save-link Lambda used to do — for contrast

Before this snapshot, all three Lambdas (`save-link-command`, `save-anonymous-link-command`, `recrawl-link-initiated`) carried the full mupdf + DeepInfra dependency footprint. On a PDF save, the Lambda would:

1. Fetch the URL via simple crawl
2. See `unsupported`, fall through to in-process comprehensive crawl
3. Run mupdf rasterisation per page (~9 MB pixmap each)
4. Submit per-page images to DeepInfra vision-OCR (~ 30 s+ for a dense paper)
5. Hold the SQS message visible the whole time (1200 s visibility timeout, 2048 MB memory)
6. Write the tier-1 source and emit `TierContentExtractedEvent`

The cost: a single PDF tied up one Lambda concurrency slot for tens of seconds, and the 2048 MB / 600 s / mupdf footprint was paid even by HTML-only saves that never touched the OCR path.

After this snapshot, the same Lambda:

1. Fetches the URL via simple crawl
2. Sees `unsupported`, writes `comprehensive-fetching` stage marker, dispatches `ComprehensiveCrawlCommand`, returns immediately
3. The Lambda's concurrency slot is free at t+1s — the comprehensive Lambda owns the remaining ~5 minutes of work on its own queue and concurrency budget

---

## Worker decision matrix

| Caller | `simpleCrawl` result | `saveLinkWork` returns | Side effects | Downstream emission |
|---|---|---|---|---|
| `save-link-command` | `fetched` | `tier-1-written` | parse + media + S3 + DDB | `TierContentExtractedEvent` (with userId) |
| `save-link-command` | `unsupported` | `tier-1-deferred` | `markCrawlStage` + dispatch `ComprehensiveCrawlCommand` | (deferred — comprehensive Lambda emits) |
| `save-link-command` | `failed` / `not-modified` | throws | `logParseError` + emit tier-1 failure outcome | (record routed to batchItemFailures) |
| `save-anonymous-link-command` | `fetched` | `tier-1-written` | parse + media + S3 + DDB | `TierContentExtractedEvent` (no userId) |
| `save-anonymous-link-command` | `unsupported` | `tier-1-deferred` | dispatch `ComprehensiveCrawlCommand` | (deferred) |
| `recrawl-link-initiated` | `fetched` | `tier-1-written` | parse + media + S3 + DDB | `RecrawlContentExtractedEvent` |
| `recrawl-link-initiated` | `unsupported` | `tier-1-deferred` | dispatch `ComprehensiveCrawlCommand` (recrawl=true) | (deferred — comprehensive Lambda emits `RecrawlContentExtractedEvent`) |

Comprehensive Lambda's own matrix:

| Command | `comprehensiveCrawl` result | Side effects | Downstream emission |
|---|---|---|---|
| `ComprehensiveCrawlCommand` (recrawl=false) | `fetched` | parse + media + S3 + DDB; `markCrawlStage` progression | `TierContentExtractedEvent` (with optional userId) |
| `ComprehensiveCrawlCommand` (recrawl=true) | `fetched` | parse + media + S3 + DDB | `RecrawlContentExtractedEvent` |
| any | `unsupported` (e.g. PDF too large, OCR empty, non-PDF body) | `markCrawlUnsupported` | (terminal — no downstream emit) |
| any | `failed` | throws | (record routed to batchItemFailures → SQS retry → DLQ) |
| any | parse error | `markCrawlFailed` + throws | (record routed to batchItemFailures → SQS retry → DLQ) |

---

## Command → System → Event reference

| Command / Event | Handler | Side effects | Emits |
|---|---|---|---|
| `SaveLinkCommand` (url, userId) | `save-link-command` Lambda (simple-only) | Simple crawl → if fetched: write tier-1 source. If unsupported: dispatch `ComprehensiveCrawlCommand`. | `TierContentExtractedEvent` on `tier-1-written`; `ComprehensiveCrawlCommand` (url, userId) on `tier-1-deferred` |
| `SaveAnonymousLinkCommand` (url) | `save-anonymous-link-command` Lambda (simple-only) | Same shape, no userId. | `TierContentExtractedEvent` or `ComprehensiveCrawlCommand` (url) |
| `RecrawlLinkInitiatedEvent` (url) | `recrawl-link-initiated` Lambda (simple-only) | Same shape; uses `recrawl=true` for the deferred dispatch. | `RecrawlContentExtractedEvent` or `ComprehensiveCrawlCommand` (url, recrawl=true) |
| **`ComprehensiveCrawlCommand` (url, userId?, recrawl?)** | **`comprehensive-crawl-command` Lambda** | mupdf rasterise + DeepInfra OCR → tier-1 source. On unsupported: `markCrawlUnsupported`. On recrawl flag: emit RecrawlContentExtractedEvent; else TierContentExtractedEvent. | `TierContentExtractedEvent` or `RecrawlContentExtractedEvent` |
| `ComprehensiveCrawlCommand` DLQ message | `comprehensive-crawl-dlq` Lambda | `transitionAndPersist(markCrawlExhausted)` | `CrawlArticleFailedEvent` |
| `TierContentExtractedEvent` | `select-most-complete-content` Lambda (unchanged) | Selector contest over tier sources; promote winner to canonical | `LinkSavedEvent` / `AnonymousLinkSavedEvent` (on canonical change); `CrawlArticleCompletedEvent` |
| `RecrawlContentExtractedEvent` | `recrawl-content-extracted` Lambda (unchanged) | Same as selector but always dispatches `GenerateSummaryCommand` | `LinkSavedEvent` / `RecrawlCompletedEvent` |

---

## Trust boundary

The comprehensive Lambda is a separate trust + capacity domain:

- **IAM**: its own role with DynamoDB UpdateItem, S3 PutObject on the content bucket, EventBridge `events:PutEvents`. The publisher save-link Lambdas only need EventBridge publish (already had it).
- **Capacity**: its own reserved concurrency and SQS queue depth. A PDF flood cannot starve HTML saves.
- **Dependencies**: mupdf (`external: ["mupdf"]`), OpenAI client, `DEEPINFRA_API_KEY` env var — all moved off the save-link Lambdas.
- **Failure domain**: its own DLQ + SNS alarm + email subscription. PDF extraction failures don't pollute the save-link DLQ alarm signal.

---

## Risks / open items

1. **Wire-format is forever.** `source: "hutch.save-link"` + `detailType: "ComprehensiveCrawlCommand"` are stored in the deployed EventBridge rule. Renaming later requires coordinated redeploy of publisher + subscriber.
2. **DLQ email subscription requires manual confirmation.** First `pulumi up` creates an unconfirmed SNS subscription. The DLQ alarm will not page until the operator confirms.
3. **stale-check Lambda is unchanged** — it still runs comprehensive crawl in-process for stale-refresh. Future work could route through `ComprehensiveCrawlCommand` for consistency, but stale-check's semantics (re-extract on freshness check) differ enough that this snapshot leaves it alone.
4. **Deploy ordering.** Pulumi creates the new Lambda + queue + EventBridge rule before save-link's code rolls; the EventBridge rule is in place before any save-link Lambda dispatches the new command, so no events are dropped in the deploy gap.
