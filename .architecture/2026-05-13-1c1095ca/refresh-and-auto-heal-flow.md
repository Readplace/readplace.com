# Refresh Tier-Selection & Summary Auto-Heal Flow — Event Storming

**Commit:** `1c1095ca` &nbsp;•&nbsp; **Commit date:** 2026-05-13 &nbsp;•&nbsp; **Generated:** 2026-05-13 &nbsp;•&nbsp; **Branch:** `claude/harden-article-aggregate-bqGgo`
**Subject:** `refactor(hutch): exhaustive switch over crawl.status in renderReaderSlot`

A point-in-time map of the **refresh tier-selection pipeline** and the **summary auto-heal** mechanism. The previous snapshot ([`98f2e47`](../2026-05-01-98f2e47/recrawl-and-auto-heal-flow.md)) described `RefreshArticleContentCommand` as an in-place metadata update. That description is now obsolete: refresh now writes a tier-1 source and runs the full selector so a prior tier-0 winner is preserved.

What is new in this snapshot:

- **`RefreshContentExtractedEvent`** — a new event published by the `refresh-article-content` handler after it writes the freshly-fetched HTML as `sources/tier-1.html`. A new `refresh-content-extracted` Lambda subscribes to it and runs the Deepseek selector across all available tier sources (same shape as the recrawl path's `recrawl-content-extracted` handler). The selector result drives `promoteTierToCanonical` only when the winner tier differs from the existing canonical, and then calls `refreshContent` to update metadata + freshness timestamps. This means a tier-0 winner from the extension no longer silently flips to tier-1 on refresh.
- **Summary auto-heal** — the stale-check handler now loads the article after its freshness check and calls `decideSummaryAutoHeal`. When the summary is `failed` and the retry budget allows (3 attempts, then 24h cool-off), it dispatches `incrementSummaryAutoHealAttempt` which flips `summaryStatus` back to `pending` and emits a `GenerateSummaryCommand` effect. The crawl axis stays operator-only (admin recrawl).

> Snapshots are historical. Any file path referenced below may be renamed, moved, or deleted in the future. Treat as an artefact, not a live guide.

---

## Legend

![Legend](diagrams/legend.svg)

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

</details>

---

## Refresh tier-selection flow — stale article to fresh canonical

When `refreshArticleIfStale` returns `action=refreshed`, the stale-check handler publishes `RefreshArticleContentCommand` with the fetched HTML payload. The refresh handler writes the HTML as a tier-1 source and publishes the new `RefreshContentExtractedEvent`. The downstream selector Lambda lists all available tier sources, runs the Deepseek contest when competition exists, promotes the winner to canonical, and calls the `refreshContent` domain transition to update metadata and freshness timestamps.

![Refresh tier-selection flow](diagrams/refresh-tier-selection-flow.svg)

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
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    %% Entry: stale-check decides to refresh
    SCE[StaleCheckRequestedEvent<br/>url]:::event
    Bus{{EventBridge default-bus}}:::system
    SCE --> Bus
    QSCE[(stale-check-requested<br/>vis 60s)]:::queue
    Bus --> QSCE
    SCWorker[stale-check-requested Lambda<br/>refreshArticleIfStale]:::system
    QSCE --> SCWorker

    Origin[Origin HTTP/2 fetch<br/>conditional GET etag/lastModified]:::system
    SCWorker <--> Origin

    Decision{action}:::policy
    SCWorker --> Decision
    Decision -- "304 unchanged" --> UFT[UpdateFetchTimestampCommand<br/>bookkeeping only]:::command
    Decision -- "new / reprime" --> SAL[SaveAnonymousLinkCommand<br/>re-prime crawl pipeline]:::command
    Decision -- "skip" --> Noop[no-op]:::policy

    %% Step 1: publish RefreshArticleContentCommand with HTML payload
    RAC[RefreshArticleContentCommand<br/>url, html, metadata,<br/>etag, lastModified, contentFetchedAt]:::command
    Decision -- "200 refreshed" --> RAC
    RAC --> Bus
    QRAC[(refresh-article-content<br/>vis 60s)]:::queue
    Bus --> QRAC

    %% Step 2: write tier-1 source + publish RefreshContentExtractedEvent
    RACWorker[refresh-article-content Lambda<br/>putTierSource tier-1 + publishEvent]:::new
    QRAC --> RACWorker
    S3Tier1[(S3 articles/&lt;id&gt;/sources/tier-1.html<br/>+ tier-1.metadata.json)]:::store
    RACWorker -- putTierSource --> S3Tier1

    RFCE[RefreshContentExtractedEvent<br/>url, etag, lastModified,<br/>contentFetchedAt]:::new
    RACWorker -.publish.-> RFCE
    RFCE --> Bus

    %% Step 3: selector runs across all tier sources
    QRFCE[(refresh-content-extracted<br/>vis 90s)]:::new
    Bus --> QRFCE
    RFCEWorker[refresh-content-extracted Lambda<br/>list sources, Deepseek if competition,<br/>promote winner, refreshContent transition]:::new
    QRFCE --> RFCEWorker

    S3Tier0[(S3 articles/&lt;id&gt;/sources/tier-0.html<br/>+ sidecar; preserved across refreshes)]:::store
    RFCEWorker <-- listAvailableTierSources --> S3Tier0
    RFCEWorker <-- listAvailableTierSources --> S3Tier1

    %% Canonical promotion only when winner !== existing tier
    S3Canon[(S3 content/&lt;id&gt;/content.html<br/>canonical bytes)]:::store
    RFCEWorker -- "promoteTierToCanonical<br/>only if winner !== existingTier" --> S3Canon

    %% refreshContent domain transition (metadata + freshness)
    Articles[(DynamoDB articles<br/>metadata, etag, lastModified,<br/>contentFetchedAt, contentSourceTier)]:::store
    RFCEWorker -- "refreshContent transition<br/>updates metadata + freshness" --> Articles

    %% Tie handling: keep existing canonical tier
    TieNote[Tie on refresh: keep existing canonical tier<br/>default tier-1 if no prior canonical]:::policy
    RFCEWorker -. tie handling .-> TieNote
```

</details>

---

## Summary auto-heal — bounded retry from stale-check

After `refreshArticleIfStale` completes, the stale-check handler loads the full article and calls `decideSummaryAutoHeal`. When the summary is in a `failed` state and the retry budget permits (≤ 3 attempts, with a 24h cool-off after exhaustion), `incrementSummaryAutoHealAttempt` flips `summaryStatus` back to `pending` and emits a `GenerateSummaryCommand` effect via the effect dispatcher. The crawl axis does not auto-heal — only the admin recrawl path can reprime a failed crawl.

![Summary auto-heal flow](diagrams/summary-auto-heal-flow.svg)

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
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    %% Entry: stale-check after freshness check
    SCWorker[stale-check-requested Lambda<br/>after refreshArticleIfStale]:::system

    %% Load article + decide
    Load[loadArticle<br/>full article aggregate]:::new
    SCWorker --> Load
    Articles[(DynamoDB articles<br/>summaryStatus, summaryAutoHeal)]:::store
    Load <--> Articles

    Decide{decideSummaryAutoHeal}:::new
    Load --> Decide

    %% Decision branches
    Decide -- "skip<br/>not failed, or budget exhausted<br/>and cooloff not elapsed" --> NoHeal[no-op]:::policy
    Decide -- "reprime<br/>summary=failed AND<br/>attempts &lt; 3 OR 24h elapsed" --> Heal[incrementSummaryAutoHealAttempt<br/>flips summaryStatus=pending<br/>bumps attempts + lastAttemptAt]:::new

    %% Transition persists + dispatches effect
    Heal -- "transitionAndPersist" --> Articles
    GSC[GenerateSummaryCommand<br/>dispatched via effect dispatcher<br/>direct SQS send]:::command
    Heal -. "effect: DispatchGenerateSummary" .-> GSC
    QGS[(generate-summary<br/>shared queue)]:::queue
    GSC --> QGS

    %% Summary pipeline re-runs
    GSWorker[generate-summary Lambda<br/>Deepseek json_schema call]:::system
    QGS --> GSWorker
    GSWorker --> Articles

    %% Budget exhaustion
    Budget[Budget: 3 attempts<br/>then 24h cool-off before<br/>next attempt allowed]:::policy
    Decide -. constraint .-> Budget
```

</details>

---

## Command → System → Event(s) reference

| Command / Event | Handler / system | Emits / writes | Triggers next |
|---|---|---|---|
| `StaleCheckRequestedEvent` | `stale-check-requested` Lambda | `refreshArticleIfStale` decides action; summary auto-heal via `decideSummaryAutoHeal` + `incrementSummaryAutoHealAttempt` | `RefreshArticleContentCommand` (200), `UpdateFetchTimestampCommand` (304), `SaveAnonymousLinkCommand` (new/reprime), or `GenerateSummaryCommand` (auto-heal) |
| `RefreshArticleContentCommand` | `refresh-article-content` Lambda | Writes `sources/tier-1.html` + sidecar via `putTierSource` | Publishes `RefreshContentExtractedEvent` |
| `RefreshContentExtractedEvent` (**new**) | `refresh-content-extracted` Lambda | `listAvailableTierSources`; runs Deepseek selector if competition, short-circuits on a single tier; `promoteTierToCanonical` (S3 CopyObject + Dynamo SET `contentSourceTier`) only when winner differs from existing; `refreshContent` transition (metadata + freshness) | (terminal — no downstream event) |
| `decideSummaryAutoHeal` (**new**, in-process) | `stale-check-requested` Lambda, after freshness check | Reads `summaryAutoHeal` from article; returns `reprime` or `skip` | `incrementSummaryAutoHealAttempt` → `GenerateSummaryCommand` (via effect dispatcher) |
| `incrementSummaryAutoHealAttempt` (**new**, transition) | Domain aggregate transition | Flips `summaryStatus=pending`, bumps `summaryAutoHeal.attempts`, sets `summaryAutoHeal.lastAttemptAt` | Effect: `DispatchGenerateSummary` → `generate-summary` Lambda |

---

## Why refresh needs the selector step

Before this change, `RefreshArticleContentCommand` updated metadata in-place — the freshly-fetched HTML **always** became the canonical content. If an article had a tier-0 winner (extension-captured DOM, often strictly better for paywalled or JS-rendered sites), a stale-check refresh would silently overwrite it with the server-side tier-1 fetch. By routing through the selector, refresh gets the same tier-preservation semantics as the user-save and recrawl paths: tier-0 stays tier-0 unless tier-1 genuinely wins the Deepseek contest.
