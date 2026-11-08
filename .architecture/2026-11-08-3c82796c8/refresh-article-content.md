# A stale article's refresh is admitted only while it still applies

Snapshot of the uncommitted working tree over `3c82796c8` (`main`), whose 2026-11-08 subject is **fix(save-link): refuse a redriven refresh when the article row has moved on**. Generated 2026-11-08. The admission gate and the new skipped event are uncommitted and not deployed.

A reader opening `/view` on a saved article publishes `StaleCheckRequestedEvent`. The stale-check Lambda decides whether the row is due for a refresh; when the conditional GET returns a new body, it stages the fetched HTML (and its evaluation representation) under the `refresh-html/` prefix of the pending-HTML bucket and publishes `RefreshArticleContentCommand`. The refresh-article-content Lambda writes that HTML as a tier-1 source and publishes `RefreshContentExtractedEvent`, and the refresh-content-extracted Lambda runs content selection across every tier source and commits the winner through the `refreshContent` transition.

- **Stale-check outcomes.** A missing row republishes `SaveAnonymousLinkCommand`. A row inside its TTL, in a terminal crawl state, still on its first save, or answering 404 is a no-op. An unresolved identity, a failed or blocked fetch, or a terminally unsupported body publishes `UpdateFetchTimestampCommand` as a backoff, as does a 304 (`unchanged`). A deferrable non-HTML body marks the stage `comprehensive-fetching` and emits `SimpleCrawlUnsupportedEvent` with `refresh=true`; the comprehensive crawl then publishes `RefreshContentExtractedEvent` itself. A new HTML body publishes `RefreshArticleContentCommand`.
- **New: admission gate.** Before touching S3, the refresh-article-content handler reads the article row with a consistent `GetItem` projecting `purgedAt`, `contentFetchedAt`, `savedAt` and `crawlStatus`, and skips the message when the row is **purged**, **unsupported**, or **superseded** — the row's `contentFetchedAt` is at or after the message's, or the row has no fetch clock and its `savedAt` is later than the message's. A missing row is admitted.
- **New: staged HTML expired.** The pending-HTML bucket expires staged objects after a day, so a late redrive can find them gone. A `NoSuchKey` on either representation now returns `undefined` and the handler skips with `staged-html-expired` instead of failing the record.
- **New: `RefreshArticleContentSkippedEvent`.** Every skip publishes `refresh-article-content-skipped` with the URL, attempt id, the message's `contentFetchedAt` and the reason, and logs `[RefreshArticleContent] skipped`. Nothing subscribes to it yet.
- **Admitted.** The handler resolves the original URL through the canonical alias row, asserts the message's source original still has the article's identity, writes the tier-1 source to the content bucket and publishes `RefreshContentExtractedEvent`.
- **Refusal at commit.** The refresh-content-extracted consumer loads the aggregate and refuses a purged row, an unsupported row, or a row whose fetch clock (or `savedAt`) is newer than the event (`row-newer`), logging `[RefreshContentExtracted] refused` with no write and no judge call. Otherwise selection runs and `refreshContent` writes metadata and freshness, re-primes the summary and publishes `CanonicalContentChangedEvent` when the canonical body changed, flips a failed crawl to ready, and records a crawl version.
- **Dead letters.** Each of the three queues dead-letters into its own `-dlq` after three receives and its alarm emails the alert address. None marks the row: stale-check and refresh-article-content have no row mutator, and refresh-content-extracted uses `keep-row`, so the reader keeps the current content and a redrive is safe at any time.

No Pulumi change: the refresh-article-content Lambda already had `GetItem` on the articles table and its table name, for the canonical alias read.

---

## Legend

Thick green marks what the uncommitted change adds: the admission gate and the new skipped event. Everything else is existing infrastructure shown for context.

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
    Q[["Queue"]]:::queue
    D[["DLQ"]]:::dlq
    N{"Added by this change"}:::new
```

</details>

---

## The refresh flow end to end

![The refresh flow end to end](diagrams/refresh-flow.svg)

[BPMN image](diagrams-bpmn/refresh-flow.png) · [Editable BPMN](diagrams-bpmn/refresh-flow.bpmn)

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

    VIEW["/view page (hutch web Lambda)"]:::system
    SCR(("StaleCheckRequestedEvent")):::event
    SCQ[["stale-check-requested queue"]]:::queue
    SCDLQ[["stale-check-requested-dlq<br/>3 receives, alarm emails"]]:::dlq
    SC["stale-check-requested Lambda"]:::system
    SCP{"freshness + crawl status<br/>conditional GET"}:::policy
    ART[("articles table")]:::store
    PH[("pending-html bucket<br/>refresh-html/ prefix, 1-day expiry")]:::store
    SAL["SaveAnonymousLinkCommand"]:::command
    UFT["UpdateFetchTimestampCommand"]:::command
    SCU(("SimpleCrawlUnsupportedEvent<br/>refresh=true")):::event
    COMP["comprehensive crawl chain"]:::system
    RAC["RefreshArticleContentCommand"]:::command
    RACQ[["refresh-article-content queue"]]:::queue
    RACDLQ[["refresh-article-content-dlq<br/>3 receives, alarm emails"]]:::dlq
    RA["refresh-article-content Lambda"]:::system
    GATE{"admission gate<br/>purged / unsupported / superseded"}:::new
    READ{"staged HTML present?"}:::new
    SKIP(("RefreshArticleContentSkippedEvent<br/>no subscribers")):::new
    CB[("content bucket<br/>tier sources + canonical")]:::store
    RCE(("RefreshContentExtractedEvent")):::event
    RCEQ[["refresh-content-extracted queue"]]:::queue
    RCEDLQ[["refresh-content-extracted-dlq<br/>3 receives, alarm emails, keep-row"]]:::dlq
    RC["refresh-content-extracted Lambda"]:::system
    REF{"refresh refusal<br/>purged / unsupported / row-newer"}:::policy
    LOG["log [RefreshContentExtracted] refused"]:::system
    SEL{"content selection<br/>DeepSeek judge when needed"}:::policy
    AGG["refreshContent transition"]:::system
    CCC(("CanonicalContentChangedEvent")):::event
    GS["GenerateSummaryCommand<br/>generate-summary queue"]:::command

    VIEW --> SCR --> SCQ --> SC
    SCQ -. after 3 receives .-> SCDLQ
    SC --> SCP
    SCP -- reads --> ART
    SCP -- row missing --> SAL
    SCP -- 304 / backoff --> UFT
    SCP -- non-HTML, deferrable --> SCU --> COMP --> RCE
    SCP -- new body: stage HTML --> PH
    SCP -- new body --> RAC
    RAC --> RACQ --> RA
    RACQ -. after 3 receives .-> RACDLQ
    RA --> GATE
    GATE -- consistent GetItem --> ART
    GATE -- skip --> SKIP
    GATE -- admit --> READ
    READ -- GetObject --> PH
    READ -- NoSuchKey: staged-html-expired --> SKIP
    READ -- present: write tier-1 source --> CB
    READ -- present --> RCE
    RCE --> RCEQ --> RC
    RCEQ -. after 3 receives .-> RCEDLQ
    RC --> REF
    REF -- refused --> LOG
    REF -- admitted --> SEL
    SEL -- reads tier sources --> CB
    SEL -- winner --> AGG
    AGG -- canonical write --> CB
    AGG -- metadata, freshness, summary, crawl --> ART
    AGG -- canonical changed --> CCC
    AGG -- summary pending --> GS
```

</details>

---

## The refresh-article-content admission

![The refresh-article-content admission](diagrams/refresh-admission.svg)

[BPMN image](diagrams-bpmn/refresh-admission.png) · [Editable BPMN](diagrams-bpmn/refresh-admission.bpmn)

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

    RAC["RefreshArticleContentCommand<br/>url, saveAttemptId, contentFetchedAt"]:::command
    RA["refresh-article-content Lambda"]:::system
    ROW[("articles row, consistent read<br/>purgedAt, contentFetchedAt, savedAt, crawlStatus")]:::new
    G0{"row exists?"}:::new
    G1{"purgedAt set?"}:::new
    G2{"crawlStatus unsupported?"}:::new
    G3{"row contentFetchedAt set?"}:::new
    G4{"row contentFetchedAt >= message's?"}:::new
    G5{"savedAt > message's contentFetchedAt?"}:::new
    SKIP(("RefreshArticleContentSkippedEvent<br/>purged / unsupported / superseded / staged-html-expired")):::new
    ID{"source original matches<br/>canonical identity? (assert)"}:::policy
    ALIAS[("articles table<br/>canonical alias row")]:::store
    PH[("pending-html bucket<br/>html + evaluation html")]:::store
    H{"both representations present?"}:::new
    CB[("content bucket<br/>tier-1 source")]:::store
    RCE(("RefreshContentExtractedEvent")):::event
    FAIL["record failed, SQS retry"]:::system
    DLQ[["refresh-article-content-dlq"]]:::dlq

    RAC --> RA --> ROW --> G0
    G0 -- no --> ID
    G0 -- yes --> G1
    G1 -- yes: purged --> SKIP
    G1 -- no --> G2
    G2 -- yes: unsupported --> SKIP
    G2 -- no --> G3
    G3 -- yes --> G4
    G4 -- yes: superseded --> SKIP
    G4 -- no --> ID
    G3 -- no --> G5
    G5 -- yes: superseded --> SKIP
    G5 -- no --> ID
    ID -- reads --> ALIAS
    ID -- mismatch --> FAIL
    ID -- match --> H
    H -- reads --> PH
    H -- NoSuchKey: staged-html-expired --> SKIP
    H -- yes --> CB --> RCE
    FAIL -. after 3 receives .-> DLQ
```

</details>

---

## Command → System → Event(s) reference

| Command / event | Handled by | Emits | Next command(s) |
|---|---|---|---|
| `StaleCheckRequestedEvent` (from the `/view` page) | stale-check-requested Lambda via its queue (own DLQ, no row mutator) | `RefreshArticleContentCommand`, `UpdateFetchTimestampCommand`, `SaveAnonymousLinkCommand`, `SimpleCrawlUnsupportedEvent` (`refresh=true`), or nothing | as emitted |
| `RefreshArticleContentCommand` | refresh-article-content Lambda via its queue (own DLQ, no row mutator) | **New:** `RefreshArticleContentSkippedEvent` on purged, unsupported, superseded or staged-html-expired; otherwise `RefreshContentExtractedEvent` after writing the tier-1 source | none on skip |
| `RefreshArticleContentSkippedEvent` (**new**) | nothing subscribes | none | none |
| `SimpleCrawlUnsupportedEvent` with `refresh=true` | policy → comprehensive crawl chain | `RefreshContentExtractedEvent` | as below |
| `RefreshContentExtractedEvent` | refresh-content-extracted Lambda via its queue (own DLQ, `keep-row`) | nothing on refusal (`[RefreshContentExtracted] refused`); on commit, `CanonicalContentChangedEvent` when the canonical body changed | `GenerateSummaryCommand` when the summary is re-primed |
| `CanonicalContentChangedEvent` | canonical-content-changed, compute-related-articles and reanchor-highlights consumers | (outside this snapshot) | (outside this snapshot) |
| `UpdateFetchTimestampCommand` | update-fetch-timestamp Lambda | none (advances the row's freshness clock) | none |
| `SaveAnonymousLinkCommand` | save-anonymous-link pipeline | (outside this snapshot) | (outside this snapshot) |
