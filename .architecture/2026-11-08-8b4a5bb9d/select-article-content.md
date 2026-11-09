# Content selection is serialised per article through one FIFO queue

Snapshot of the uncommitted working tree over `8b4a5bb9d` (`work-tmp`, recorded for branch `rp/optimistic-fermat-y7zhyn`), whose 2026-11-08 subject is **Merge remote-tracking branch 'origin/main' into work-tmp**. Generated 2026-11-08. The serialisation path (command, FIFO queue, worker Lambda, route switch) is at the base commit; the uncommitted change makes the forward route take its work id from the ingress EventBridge event id, validated, instead of the ingress SQS message id, and parses `SELECTION_ROUTE` through a schema. Nothing on the new path runs in production yet: every ingress Lambda is deployed with `SELECTION_ROUTE = "select"`, and the worker's event-source mapping is disabled.

Four facts ask for content selection on an article: `TierContentExtractedEvent` (a save or tier-0 capture wrote a tier source), `RecrawlContentExtractedEvent` (an operator recrawl), `RefreshContentExtractedEvent` (a stale-check refresh) and `ReselectAfterRemovalEvent` (a reader's capture was erased and the shared copy must be re-chosen). Each is subscribed by its own EventBridge rule onto its own standard SQS queue and Lambda: select-most-complete-content, recrawl-content-extracted, refresh-content-extracted and reselect-after-removal. Those four ran selection concurrently, so two selections for the same article could race on the row's selection snapshot and the judge's ledger.

- **New: `SelectArticleContentCommand`.** A discriminated union on `sourceKind` (`tier-content-extracted`, `recrawl-content-extracted`, `refresh-content-extracted`, `reselect-after-removal`) carrying a `workId` and the ingress event's detail, parsed by that event's own schema.
- **New: `select-article-content` FIFO queue.** Visibility 1,800 s, `maxReceiveCount` 3, its own FIFO DLQ and a depth alarm that emails the alert address. `MessageGroupId` is the sha256 of the article's resource unique id (the same grouping the generate-summary FIFO queue uses), so selections for one article run one at a time in arrival order while different articles run in parallel. `MessageDeduplicationId` is sha256(`sourceKind:workId`).
- **Two routes on each ingress Lambda.** `SELECTION_ROUTE = "select"` (deployed) keeps selecting in place exactly as before. `"forward"` parses the EventBridge envelope (`id` must be non-empty), builds the command through the source kind's policy (which validates the detail), and sends it to the FIFO queue; a malformed body or a send failure fails the ingress record, which retries on its own queue and dead-letters into its own DLQ. Nothing is marked on that path.
- **Uncommitted: work id = ingress EventBridge event id.** A re-forward of the same event (an ingress redelivery, a redrive of the ingress DLQ) now carries the same work id and so the same deduplication id, and the FIFO queue drops it inside the five-minute dedupe window. Two distinct events for the same URL with identical bodies get different ids. A reselect's `saveAttemptId` is derived from the work id, so a reselect forwarded twice judges once.
- **New: select-article-content worker Lambda.** 3,008 MB, 300 s timeout, batch size 1, `GetItem`/`UpdateItem` on the articles table, read/write on the content bucket, send on the generate-summary queues, publish on the bus. It parses the command, picks the source kind's policy, and runs the same preparation, judge and commit as the in-place route with mode `save` (tier, reselect), `recrawl` or `refresh`. Its judge claim is keyed by the FIFO message id with a 360 s TTL; a claim held by another owner raises an **ownership anomaly** instead of asserting, and a redelivery of the same FIFO message is granted its own claim back.
- **Outcomes.** `promoteTier` (save, reselect) publishes `CanonicalContentChangedEvent` when the canonical tier or body changed, otherwise dispatches generate-summary only to retry a summary failed by a crawl failure, and always publishes `CrawlArticleCompletedEvent`. `recrawlPromoteTier` publishes `CanonicalContentChangedEvent` and `RecrawlCompletedEvent`; `recrawlTieKeptCanonical` dispatches generate-summary and publishes `RecrawlCompletedEvent`. `refreshContent` publishes `CanonicalContentChangedEvent` when the body changed. Nothing readable commits `markNoReadableArticle` (crawl failed, summary skipped, `CrawlArticleCompletedEvent`) unless the original URL is a YouTube video whose oEmbed card can be committed instead; a deferred judge commits `markCrawlAwaitingReader`; a refused refresh (purged, unsupported, row newer) writes nothing. A committed body change records a crawl version. Effects leave through the Lambda effect dispatcher: events to EventBridge, generate-summary to the generate-summary FIFO queue grouped per article.
- **Failure and dead letters.** A failed record waits out the 1,800 s visibility and blocks every later selection for that article in its group. On the third receive a source kind whose policy is `mark-crawl-exhausted` (tier, recrawl, reselect) commits `markCrawlExhausted`, publishing `CrawlArticleFailedEvent`; `keep-row` (refresh) marks nothing. An ownership anomaly marks nothing on any receive, so its dead letter leaves the row `pending`. A record that fails to parse has no URL and marks nothing. After three receives the message lands in the FIFO DLQ, which nothing consumes.

Infra wiring: the FIFO queue and DLQ exist, each ingress Lambda holds `SELECTION_ROUTE` plus the FIFO queue URL and send permission, and the worker has its own own-capture-failed metric filter feeding the shared alarm topic. `SELECTION_FIFO_PROCESSING_ENABLED = false` leaves its event-source mapping disabled.

---

## Legend

Thick green marks what the serialisation path adds: the command, the FIFO queue and its DLQ, the forward route and the worker. Everything else is existing infrastructure shown for context.

![Legend](diagrams/legend.svg)

[BPMN image](diagrams-bpmn/legend.png) · [Editable BPMN](diagrams-bpmn/legend.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P{"Policy / decision"}:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    N["Added by the serialisation path"]:::new
```

</details>

---

## Ingress: four facts, two routes

Each ingress Lambda reads `SELECTION_ROUTE` at start. `select` is today's deployed value; `forward` sends a `SelectArticleContentCommand` to the FIFO queue, whose worker mapping is disabled.

![Ingress: four facts, two routes](diagrams/ingress-routes.svg)

[BPMN image](diagrams-bpmn/ingress-routes.png) · [Editable BPMN](diagrams-bpmn/ingress-routes.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    TCE(("TierContentExtractedEvent")):::event
    RCE(("RecrawlContentExtractedEvent")):::event
    FCE(("RefreshContentExtractedEvent")):::event
    RAR(("ReselectAfterRemovalEvent")):::event
    BUS["EventBridge bus<br/>one rule per event"]:::system

    TQ[("select-most-complete-content queue<br/>300 s visibility")]:::queue
    RQ[("recrawl-content-extracted queue")]:::queue
    FQ[("refresh-content-extracted queue")]:::queue
    XQ[("reselect-after-removal queue")]:::queue
    IDLQ[("each ingress queue's own -dlq<br/>3 receives, alarm emails")]:::dlq

    ING["ingress Lambda<br/>one per queue"]:::system
    ROUTE{"SELECTION_ROUTE"}:::new

    SEL["select in place<br/>prepare, judge, commit<br/>same work as the worker"]:::system
    OUT["outcomes and effects<br/>see worker diagram"]:::system

    ENV{"EventBridge envelope<br/>id non-empty, detail parses<br/>for the source kind"}:::new
    FAIL["log [tag] forward failed<br/>record fails, nothing marked"]:::system
    CMD["SelectArticleContentCommand<br/>sourceKind, workId = event id, detail"]:::new
    GRP{"MessageGroupId = sha256 article id<br/>DedupId = sha256 sourceKind:workId"}:::new
    FIFO[("select-article-content-q.fifo<br/>1,800 s visibility, maxReceiveCount 3")]:::new
    ESM{"event-source mapping<br/>SELECTION_FIFO_PROCESSING_ENABLED = false"}:::new
    WORK["select-article-content worker Lambda"]:::new

    TCE --> BUS
    RCE --> BUS
    FCE --> BUS
    RAR --> BUS
    BUS --> TQ
    BUS --> RQ
    BUS --> FQ
    BUS --> XQ
    TQ --> ING
    RQ --> ING
    FQ --> ING
    XQ --> ING
    ING --> ROUTE
    ROUTE -- "select (deployed)" --> SEL --> OUT
    ROUTE -- forward --> ENV
    ENV -- invalid or send fails --> FAIL
    FAIL -. retry, then after 3 receives .-> IDLQ
    ENV -- valid --> CMD --> GRP --> FIFO
    FIFO -. same dedup id within 5 min dropped .-> FIFO
    FIFO --> ESM
    ESM -- when enabled --> WORK
```

</details>

---

## The worker: one selection per article at a time

![The worker: one selection per article at a time](diagrams/worker-outcomes.svg)

[BPMN image](diagrams-bpmn/worker-outcomes.png) · [Editable BPMN](diagrams-bpmn/worker-outcomes.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    FIFO[("select-article-content-q.fifo<br/>one in flight per article group")]:::new
    WORK["select-article-content worker<br/>parse command, pick policy by sourceKind"]:::new
    POL{"source policy<br/>tier, reselect: mode save<br/>recrawl: mode recrawl<br/>refresh: mode refresh"}:::new
    PREP["prepare selection<br/>list tier sources, read row"]:::system
    ART[("articles table")]:::store
    CB[("content bucket<br/>tier sources + canonical")]:::store
    REF{"refresh refusal<br/>purged, unsupported, row newer"}:::policy
    REFLOG["log [RefreshContentExtracted] refused<br/>no write"]:::system
    JUDGE{"judge under ledger<br/>claim = FIFO message id, TTL 360 s<br/>DeepSeek when needed"}:::policy
    ANOM["ownership anomaly<br/>another owner holds the claim<br/>record fails, nothing marked"]:::new
    DS["DeepSeek content judge"]:::system

    PT["promoteTier<br/>save, reselect"]:::system
    RPT["recrawlPromoteTier"]:::system
    RTK["recrawlTieKeptCanonical"]:::system
    RC["refreshContent"]:::system
    NR["markNoReadableArticle<br/>crawl failed, summary skipped"]:::system
    VID["YouTube oEmbed card<br/>video-card-fallback"]:::system
    AW["markCrawlAwaitingReader<br/>judge deferred"]:::system
    VER["record crawl version<br/>when the body changed"]:::system

    DISP["Lambda effect dispatcher"]:::system
    CCC(("CanonicalContentChangedEvent")):::event
    CAC(("CrawlArticleCompletedEvent")):::event
    RCD(("RecrawlCompletedEvent")):::event
    GS["GenerateSummaryCommand"]:::command
    GSQ[("generate-summary.fifo<br/>grouped per article")]:::queue

    FIFO --> WORK --> POL --> PREP
    PREP -- reads --> ART
    PREP -- lists --> CB
    PREP --> REF
    REF -- refused --> REFLOG
    REF -- admitted --> JUDGE
    JUDGE -- calls --> DS
    JUDGE -- claim held elsewhere --> ANOM
    JUDGE -- "winner, mode save" --> PT
    JUDGE -- "winner, mode recrawl" --> RPT
    JUDGE -- "canonical retained, mode recrawl" --> RTK
    JUDGE -- "winner, mode refresh" --> RC
    JUDGE -- nothing readable --> VID
    VID -- card committed --> PT
    VID -- not a video or oEmbed refused --> NR
    JUDGE -- deferred to reader --> AW
    PT -- writes canonical --> CB
    PT --> VER
    RPT --> VER
    RC --> VER
    PT --> DISP
    RPT --> DISP
    RTK --> DISP
    RC --> DISP
    NR --> DISP
    DISP -- tier or body changed --> CCC
    DISP -- every promote, no readable --> CAC
    DISP -- recrawl --> RCD
    DISP -- tie kept, or retry crawl-failed summary --> GS --> GSQ
```

</details>

---

## Failure, final receive and dead letters

![Failure, final receive and dead letters](diagrams/failure-dead-letters.svg)

[BPMN image](diagrams-bpmn/failure-dead-letters.png) · [Editable BPMN](diagrams-bpmn/failure-dead-letters.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    FIFO[("select-article-content-q.fifo")]:::new
    WORK["select-article-content worker"]:::new
    ERR{"why did the record fail?"}:::policy
    PARSE["command does not parse<br/>no URL, nothing marked"]:::system
    ANOM["ownership anomaly<br/>nothing marked on any receive"]:::new
    FAILED["log [tag] record failed<br/>deepseek-call-failed line on a provider error"]:::system
    WAIT["batch item failure<br/>retry after 1,800 s<br/>later selections for the article wait"]:::system
    RC{"receive count >= 3?"}:::policy
    EXH{"policy onExhaustion"}:::new
    MCE["markCrawlExhausted<br/>tier, recrawl, reselect"]:::system
    CAF(("CrawlArticleFailedEvent")):::event
    KEEP["keep-row<br/>refresh: reader keeps current content"]:::system
    ART[("articles table")]:::store
    FDLQ[("select-article-content-dlq.fifo<br/>no consumer, kept for redrive")]:::new
    ALARM["DLQ depth alarm<br/>emails the alert address"]:::system

    FIFO --> WORK --> ERR
    ERR -- bad body --> PARSE --> WAIT
    ERR -- judge claim held --> ANOM --> WAIT
    ERR -- other error --> FAILED --> RC
    RC -- no --> WAIT
    RC -- yes --> EXH
    EXH -- mark-crawl-exhausted --> MCE
    MCE -- writes crawl exhausted --> ART
    MCE --> CAF
    EXH -- keep-row --> KEEP
    MCE --> WAIT
    KEEP --> WAIT
    WAIT -. after 3 receives .-> FDLQ --> ALARM
```

</details>

---

## Command → System → Event(s) reference

| Command / event | System that handles it | Event(s) / effects emitted | Next command(s) triggered |
|---|---|---|---|
| `TierContentExtractedEvent` | select-most-complete-content queue + Lambda | `select`: as `promoteTier` / `markNoReadableArticle` below. `forward`: `SelectArticleContentCommand` (`tier-content-extracted`) | `SelectArticleContentCommand` on forward |
| `RecrawlContentExtractedEvent` | recrawl-content-extracted queue + Lambda | `select`: as `recrawlPromoteTier` / `recrawlTieKeptCanonical` below. `forward`: `SelectArticleContentCommand` (`recrawl-content-extracted`) | `SelectArticleContentCommand` on forward |
| `RefreshContentExtractedEvent` | refresh-content-extracted queue + Lambda | `select`: as `refreshContent` below, or a logged refusal. `forward`: `SelectArticleContentCommand` (`refresh-content-extracted`) | `SelectArticleContentCommand` on forward |
| `ReselectAfterRemovalEvent` | reselect-after-removal queue + Lambda | `select`: as `promoteTier` below. `forward`: `SelectArticleContentCommand` (`reselect-after-removal`) | `SelectArticleContentCommand` on forward |
| **`SelectArticleContentCommand`** (new) | select-article-content FIFO queue (group = article, dedup = sha256 `sourceKind:workId`) → select-article-content worker (mapping disabled) | Per mode, the transitions below | As below |
| `promoteTier` (save, reselect) | worker or in-place ingress Lambda | `CanonicalContentChangedEvent` when the tier or body changed; `CrawlArticleCompletedEvent` always | `GenerateSummaryCommand` only to retry a crawl-failed summary; `CanonicalContentChangedEvent` drives summary regeneration and highlight re-anchoring |
| `recrawlPromoteTier` | worker or in-place ingress Lambda | `CanonicalContentChangedEvent`, `RecrawlCompletedEvent` | via `CanonicalContentChangedEvent` |
| `recrawlTieKeptCanonical` | worker or in-place ingress Lambda | `RecrawlCompletedEvent` | `GenerateSummaryCommand` |
| `refreshContent` | worker or in-place ingress Lambda | `CanonicalContentChangedEvent` when the body changed | via `CanonicalContentChangedEvent` |
| `markNoReadableArticle` | worker or in-place ingress Lambda | `CrawlArticleCompletedEvent` (crawl failed, summary skipped) | — |
| `markCrawlAwaitingReader` | worker or in-place ingress Lambda | none | — |
| Refresh refusal | worker or in-place ingress Lambda | none; logs `[RefreshContentExtracted] refused` | — |
| Ownership anomaly | worker only | none; record fails, nothing marked | redelivery after 1,800 s, then FIFO DLQ |
| Final receive, `mark-crawl-exhausted` | worker or in-place ingress Lambda | `markCrawlExhausted` → `CrawlArticleFailedEvent` | — |
| Final receive, `keep-row` (refresh) | worker or in-place ingress Lambda | none | — |
| `GenerateSummaryCommand` | generate-summary FIFO queue (worker dispatch) | out of scope here | — |
| select-article-content FIFO DLQ | no consumer; depth alarm emails | — | operator redrive |
