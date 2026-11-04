# Metered legs on view: an automatic save waits for a reader before it spends

Snapshot of the uncommitted working tree over `814fb0f06` (`main`), whose 2026-11-05 subject is **refactor(save-link): run Next read only on ComputeRelatedPasses, not on QueueEntryCreated**

An automatic save (an email link, a bulk import) used to run every paid leg of the pipeline as soon as it landed: the render ladder, the comprehensive crawl, the content judge and the summary. Most automatic saves are never opened. This change defers those metered legs until a reader looks at the article, and makes sure each leg runs at most once per input when they do.

- **An automatic save marks its row deferred.** The submit handler's pending write stamps `meteredLegsDeferredSince` when the save trigger is automatic, and removes it when the save is manual.
- **Every metered leg claims a ledger slot first.** The render legs, the comprehensive crawl, the content judge and the summary each make a conditional claim on the article row, keyed by leg and input hash. A deferred row refuses the claim, so the leg parks the row: the crawl as `awaiting-reader` (or `failed{blocked, edge-block}` when the free crawl saw block evidence), the summary as `skipped{awaiting-reader}`. A granted claim runs the leg and settles it with its outcome, or releases it when nothing was committed. A claim held by another record is retried; a settled claim with the same input replays its outcome without paying again.
- **Viewing the article resumes it.** The readlist HTML listing, the Siren listing, the reader open, the reader poll after a device capture gave up, and the queue digest each check the rows they show. A row that a reader could resolve is claimed with one conditional update that flips its axes back to pending and clears the deferral, and only the request that won the claim publishes `ResolveArticleOnViewCommand`. Bots and prefetches claim nothing; a blocked row viewed from a device that can capture is left to the device first.
- **The command rides the submit-link queue.** One EventBridge rule now carries both `SubmitLinkCommand` and `ResolveArticleOnViewCommand` to the same queue and Lambda, whose router sends each detail type to its own handler. No new Lambda, queue, DLQ, environment variable or Pulumi config.
- **A dead letter fails the pending axis.** The shared failures DLQ consumer routes a dead-lettered resolution to a new branch that marks the still-pending crawl or summary exhausted, and always fails the record so the message stays redrivable.

---

## Legend

Amber marks what this change adds or changes. Everything else is existing infrastructure shown for context.

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
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P["Policy / reaction"]:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    U["Client action"]:::ui
    N["Added or changed by this change"]:::new
```

</details>

---

## 1. Where the two commands come from and how they reach the submit-link Lambda

Every producer of `SubmitLinkCommand` is unchanged. `ResolveArticleOnViewCommand` is new; it is published only by the hutch web tier and the queue digest after they win a claim. One rule carries both detail types to the submit-link queue, and the Lambda routes by detail type.

![Where the two commands come from and how they reach the submit-link Lambda](diagrams/submit-link-queue-routing.svg)

[BPMN image](diagrams-bpmn/submit-link-queue-routing.png) · [Editable BPMN](diagrams-bpmn/submit-link-queue-routing.bpmn)

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
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    subgraph SUBMITTERS["SubmitLinkCommand producers"]
        SB["Queue save bar, extension and app saves<br/>manual"]:::ui
        RS["Re-save from the readlist<br/>manual"]:::ui
        IM["Import commit<br/>automatic"]:::ui
        IX["Inbox link extractor<br/>automatic"]:::ui
        IW["Inbox web: save a kept link"]:::ui
        AG["Article aggregate effect dispatcher"]:::system
    end

    SLC["SubmitLinkCommand"]:::command
    RAV["ResolveArticleOnViewCommand<br/>url, saveAttemptId, axes, surface"]:::new
    TRIG["Hutch view triggers<br/>see section 2"]:::new

    BUS[("EventBridge bus")]:::queue
    RULE["Rule submit-link-command<br/>subscribeAll: SubmitLinkCommand + ResolveArticleOnViewCommand"]:::new
    Q[("submit-link queue<br/>visibility 480 s, batch 1")]:::queue
    L["submit-link Lambda<br/>router by detail type"]:::new
    SH["Submit handler<br/>accept phase then tier-1 crawl"]:::system
    RH["Resolve-article-on-view handler<br/>see section 3"]:::new
    DLQ[("Shared save-link failures DLQ<br/>after max receives")]:::dlq
    DH["Failures DLQ consumer<br/>routes by source queue then detail type"]:::system
    SUBDLQ["Submission branch"]:::system
    LQF(("LinkQueueFailedEvent")):::event
    RESDLQ["Resolution branch<br/>crawl pending: markCrawlExhausted<br/>else summary pending: markSummaryExhausted<br/>always fails the record"]:::new
    ROW[("Article row")]:::store

    SB --> SLC
    RS --> SLC
    IM --> SLC
    IX --> SLC
    IW --> SLC
    AG --> SLC
    TRIG --> RAV
    SLC --> BUS
    RAV --> BUS
    BUS --> RULE
    RULE --> Q
    Q --> L
    L -->|"SubmitLinkCommand"| SH
    L -->|"ResolveArticleOnViewCommand"| RH
    Q -->|"receives exhausted"| DLQ
    DLQ --> DH
    DH -->|"SubmitLinkCommand"| SUBDLQ
    SUBDLQ --> LQF
    DH -->|"ResolveArticleOnViewCommand"| RESDLQ
    RESDLQ --> ROW
```

</details>

---

## 2. Viewing an article claims it and publishes the command

Five surfaces call the same request. Each decides per row what a reader could resolve, claims the row with one conditional write, and publishes only for the rows it claimed. The claimed state is overlaid on the page, so the card or reader renders pending at once and polls.

![Viewing an article claims it and publishes the command](diagrams/view-claims-and-publishes.svg)

[BPMN image](diagrams-bpmn/view-claims-and-publishes.png) · [Editable BPMN](diagrams-bpmn/view-claims-and-publishes.bpmn)

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
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    HTML["GET /queue<br/>surface readlist-html"]:::new
    SIREN["Siren GET /queue<br/>surface readlist-siren"]:::new
    READER["Reader open /queue/:id/view<br/>surface reader"]:::new
    GAVEUP["Reader poll after device capture gave up<br/>surface reader-capture-gave-up"]:::new
    DIGEST["Queue digest Lambda<br/>surface queue-digest, up to 10 per run"]:::new

    BOT{{"Bot user agent or prefetch?"}}:::new
    SKIP["Render rows as loaded<br/>publish nothing"]:::ui
    NEED{{"needsResolutionOnView<br/>webmail, not-found, robots, content-too-large: none<br/>blocked and viewer can capture: device-first<br/>failed or unsupported crawl: crawl-and-summary<br/>ready crawl, summary failed or skipped awaiting-reader or ai-unavailable: summary"}}:::new
    CLAIM["claimResolutionOnView<br/>conditional UpdateItem"]:::new
    ROW[("Article row<br/>crawl and summary status, meteredLegsDeferredSince")]:::store
    WON{{"Claimed?"}}:::new
    PUB["Publish ResolveArticleOnViewCommand<br/>a publish error is logged"]:::new
    RAV["ResolveArticleOnViewCommand"]:::new
    LOST["Lost the race: read the current crawl and summary"]:::new
    OVERLAY["overlayResolution<br/>card or reader renders pending and polls"]:::new

    HTML --> BOT
    SIREN --> BOT
    READER --> BOT
    BOT -->|"yes"| SKIP
    BOT -->|"no"| NEED
    GAVEUP --> NEED
    DIGEST --> NEED
    NEED -->|"none or device-first"| SKIP
    NEED -->|"crawl-and-summary or summary"| CLAIM
    CLAIM -->|"crawl-and-summary: crawl failed or unsupported<br/>summary: crawl ready and summary resumable<br/>sets axes pending, removes meteredLegsDeferredSince"| ROW
    CLAIM --> WON
    WON -->|"yes"| PUB
    PUB --> RAV
    WON -->|"no"| LOST
    PUB --> OVERLAY
    LOST --> OVERLAY
```

</details>

---

## 3. The resolve-article-on-view handler

The handler runs inside the submit-link Lambda. It resolves only a row whose requested axis is still pending, so a redelivered or stale command changes nothing.

![The resolve-article-on-view handler](diagrams/resolve-article-on-view-handler.svg)

[BPMN image](diagrams-bpmn/resolve-article-on-view-handler.png) · [Editable BPMN](diagrams-bpmn/resolve-article-on-view-handler.bpmn)

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
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    RAV["ResolveArticleOnViewCommand"]:::new
    H["Resolve-article-on-view handler"]:::new
    LOAD[("Article aggregate<br/>loadArticle")]:::store
    PEND{{"Requested axis still pending?"}}:::new
    ACK["Ack: row moved on or missing"]:::new
    AX{{"axes"}}:::new
    MSP["markSummaryPending"]:::new
    GS["generate-summary effect<br/>generate-summary queue"]:::queue
    RUN["runCrawlFromTier1<br/>same free tier-1 crawl as a submit, recrawl false"]:::new
    TCE(("TierContentExtractedEvent")):::event
    SCU(("SimpleCrawlUnsupportedEvent<br/>deferred to render or comprehensive")):::event
    CLS["ClassifiedCrawlError: markCrawlExhausted in-process, ack"]:::new
    ERR["Any other error: record fails, SQS retries, then DLQ"]:::dlq
    SEL["select-most-complete-content"]:::system
    PAID["render-crawl / comprehensive-crawl"]:::system

    RAV --> H
    H --> LOAD
    LOAD --> PEND
    PEND -->|"no"| ACK
    PEND -->|"yes"| AX
    AX -->|"summary"| MSP
    MSP --> GS
    AX -->|"crawl-and-summary"| RUN
    RUN -->|"tier-1 source written"| TCE
    RUN -->|"deferred"| SCU
    RUN -->|"terminal or crawl failure"| CLS
    RUN --> ERR
    TCE --> SEL
    SCU --> PAID
```

</details>

---

## 4. The ledger gates on every metered leg

A save sets or clears the deferral; each metered leg claims its ledger slot on the article row before it spends. The view claim in section 2 is what removes the deferral, so the next claim is granted.

![The ledger gates on every metered leg](diagrams/metered-leg-ledger-gates.svg)

[BPMN image](diagrams-bpmn/metered-leg-ledger-gates.png) · [Editable BPMN](diagrams-bpmn/metered-leg-ledger-gates.bpmn)

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
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    SUB["Submit handler: markCrawlPending"]:::system
    TRIG{{"saveTrigger"}}:::new
    DEF["Set meteredLegsDeferredSince"]:::new
    CLR["Remove meteredLegsDeferredSince"]:::new
    ROW[("Article row<br/>per-leg ledger and claim attributes")]:::store

    RENDER["render-crawl handler<br/>residential-per-gb, web-unlocker fetch and render"]:::system
    COMP["comprehensive-crawl handler"]:::system
    JUDGE["select-most-complete-content<br/>content judge"]:::system
    SUMM["generate-summary handler"]:::system

    CLAIM["claimMeteredLeg<br/>refused while deferred; one live claim; same input hash is settled"]:::new
    G{{"Claim result"}}:::new
    RUNLEG["Run the paid leg"]:::system
    SETTLE["settleMeteredLeg: record outcome, drop claim"]:::new
    REL["releaseMeteredLeg: nothing committed, drop claim"]:::new
    PARKC["Crawl parked<br/>markCrawlAwaitingReader, or failed blocked edge-block with block evidence"]:::new
    PARKS["Summary parked<br/>markSummarySkipped awaiting-reader"]:::new
    RETRY["In flight elsewhere: record fails, SQS retries"]:::new
    REPLAY["Settled: replay the recorded outcome, ack"]:::new
    VIEW["View claim in section 2<br/>removes the deferral"]:::new

    SUB --> TRIG
    TRIG -->|"automatic"| DEF
    TRIG -->|"manual"| CLR
    DEF --> ROW
    CLR --> ROW

    RENDER --> CLAIM
    COMP --> CLAIM
    JUDGE --> CLAIM
    SUMM --> CLAIM
    CLAIM --> ROW
    CLAIM --> G
    G -->|"granted"| RUNLEG
    RUNLEG -->|"committed"| SETTLE
    RUNLEG -->|"not committed or threw"| REL
    G -->|"deferred: render, comprehensive, judge"| PARKC
    G -->|"deferred: summary"| PARKS
    G -->|"in-flight"| RETRY
    G -->|"settled"| REPLAY
    PARKC --> VIEW
    PARKS --> VIEW
    VIEW --> ROW
```

</details>

---

## Command → System → Event(s) reference

| Command / event | System that handles it | Emits | Triggers next |
|---|---|---|---|
| `SubmitLinkCommand` | submit-link Lambda, submit handler | Accept-phase rows; `TierContentExtractedEvent`, `SimpleCrawlUnsupportedEvent`, `StaleCheckRequestedEvent`, or an in-process crawl failure | select-most-complete-content; render-crawl or comprehensive-crawl; the stale-check pipeline |
| `ResolveArticleOnViewCommand` (new) | submit-link Lambda, resolve-article-on-view handler | Crawl axis: `TierContentExtractedEvent` or `SimpleCrawlUnsupportedEvent`, or `markCrawlExhausted`. Summary axis: `markSummaryPending` with its generate-summary effect | select-most-complete-content; render-crawl or comprehensive-crawl; generate-summary |
| Dead-lettered `SubmitLinkCommand` | save-link failures DLQ consumer, submission branch | `LinkQueueFailedEvent` | The saved-link read model |
| Dead-lettered `ResolveArticleOnViewCommand` (new) | save-link failures DLQ consumer, resolution branch | `markCrawlExhausted` or `markSummaryExhausted` on the pending axis; the record always fails | None; the message stays for a redrive |
| `TierContentExtractedEvent` | select-most-complete-content, content-judge leg gated by the ledger (changed) | `LinkSaved` and `CrawlArticleCompleted`, or `markCrawlAwaitingReader` when deferred with nothing selected | generate-summary |
| `SimpleCrawlUnsupportedEvent` → `RenderCrawlCommand` / `ComprehensiveCrawlCommand` | render-crawl and comprehensive-crawl, each paid leg gated by the ledger (changed) | `TierContentExtractedEvent`, or `markCrawlAwaitingReader` / `failed{blocked, edge-block}` when deferred | select-most-complete-content |
| generate-summary queue message | generate-summary handler, summary leg gated by the ledger (changed) | Ready summary, or `skipped{awaiting-reader}` when deferred | None |
| View of a parked row (new) | Readlist HTML and Siren listing, reader open, reader gave-up poll, queue digest | `ResolveArticleOnViewCommand` for each claimed row | The resolve-article-on-view handler |
