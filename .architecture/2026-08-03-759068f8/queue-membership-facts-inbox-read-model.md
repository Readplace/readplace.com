# Queue-Membership Facts — LinkDequeued Closes the Inbox Read-Model Loop — Event Storming

**Base commit:** `759068f8` &nbsp;•&nbsp; **Commit date:** 2026-08-03 &nbsp;•&nbsp; **Generated:** 2026-08-03 &nbsp;•&nbsp; **Branch:** `main`
**Subject:** `feat: bind inbox save buttons to live queue membership`

Until this commit the inbox's saved-link read model was **append-only**: a link once accepted into the reader's queue read "Saved" forever, even after the reader deleted the article, and the Skipped tab's rows hardcoded "Save to queue" and never changed state at all. This snapshot documents the fact that ends a row's claim — and the complete current state of all three queue-membership flows that share one subscriber:

- **`LinkDequeuedEvent { url, userId }` — a new irreversible fact, the inverse of `LinkQueuedEvent`.** Published by a new `initDeleteArticleFromQueue` orchestrator in `@packages/save-article`, which both hutch delete surfaces (`POST /queue/:id/delete` and `POST /queue/:id/remove-my-copy`) now route through: resolve the row's URL by reader hash id, delete the per-user queue row, then announce the deletion. The fact is published **even when the row was already gone** — the row may have been deleted by an earlier attempt whose publish failed after the delete committed, and the retry of that request is the only chance to re-announce it. The consumer retracts idempotently, so a duplicate fact is harmless while a suppressed one leaves the link reading as saved for good.
- **`url` is the deleted row's own key: the canonical URL after alias resolution** — not the URL a save was submitted with (which is what `LinkQueuedEvent` carries). The two differ only for a save of an adopted terminal URL; accepted rather than closed with a second key, because no such stale row has been observed (Evidence Over Speculation).
- **Two deliberate non-publishers.** Marking an article read publishes nothing — a read article is still in the queue, so its inbox button keeps reading "Save again". Account deletion publishes nothing either: the hutch delete-account Lambda calls the store's `deleteAllByUserId` and drops the whole partition directly.
- **The subscriber becomes a dispatcher.** The existing inbox `record-link-queued` Lambda now routes on the envelope's `detail-type` across an explicit three-entry table: `LinkQueued` → unconditional upsert, `LinkQueueFailed` → conditional put (an accepted save outranks a failure), `LinkDequeued` → **delete the row**, restoring the absence that means "not saved" rather than recording a third state. A detail-type outside the table fails the record to the DLQ rather than defaulting — defaulting is how a deletion would be recorded as a save.
- **A third SQS queue + DLQ (`inbox-record-link-dequeued`)** feeds the same Lambda, because `eventBus.subscribe` provisions one queue policy per call — one rule per queue, all converging on one handler. The rule name is explicit for the same reason every inbox rule's is: EventBridge `PutRule` is an upsert, and a colliding default name would silently retarget someone else's rule.
- **Both email-detail tabs now share one save-button view model.** In the queue → "Save again" (check icon, muted style, still clickable — re-saving is the same POST, landing on the same upsert every re-save lands on: `savedAt` bump + read→unread resurface). Absent or failed → "Save to queue". The Skipped tab's excluded rows render from the same model, so saving a skipped link — which doubles as the reader's verdict that the classifier was wrong, logged as classifier-audit feedback — now flips its button like any kept card's. The per-card poll fragment reads the save state **before** computing its ETag, so a card whose membership changed after the reader's last poll can never revalidate stale.
- **The IAM boundary holds in the same one direction as before.** No inbox role reads or writes the queue tables — the new grant on the inbox subscriber is `DeleteItem` on the inbox's own read-model table. Membership state still arrives as save-side facts, never as a cross-boundary read.

---

## Legend

New/changed pieces carry the amber **new** highlight (`fill:#ffd24c`, `stroke:#a0660b`, 3 px stroke); everything else is pre-existing infrastructure shown for context.

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

## 1. The accept-terminal fact and its failure twin (unchanged, shown complete)

Every authenticated save surface routes through the shared accept phase `initSaveArticleFromUrl` in `@packages/save-article`: resolve canonical identity, upsert the global article row and the per-user queue row, resurface a read article as unread — then publish `LinkQueuedEvent` with the URL **as submitted**, captured before canonical resolution. It fires on every freshness branch, including the skip that writes the per-user row and publishes nothing else, so a duplicate save announces itself exactly like a first save.

The failure twin comes off the `submit-link` DLQ: an accept-phase throw (DynamoDB/EventBridge blip) retries up to 3 receives, and exhaustion hands the dead letter to the `submit-link-dlq` handler, which publishes `LinkQueueFailedEvent` and mutates no article row — the row either does not exist or belongs to another saver's in-flight crawl. The fact means "the command gave up", **not** "nothing was queued": the accept phase writes the queue row first and several calls after it can still throw, which is why the read model lets an accepted save outrank a failure.

![Accept fact and its failure twin](diagrams/accept-fact-and-failure-twin.svg)

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

    subgraph HutchWeb["hutch web Lambda (SSR)"]
        Bar["POST /queue/save<br/>(web save bar)"]:::command
        Siren["POST /queue<br/>Siren save-article<br/>(extension + iOS app)"]:::command
        Bulk["POST /queue/save-articles<br/>(extension bulk save)"]:::command
        Tier0["POST /queue/save-content<br/>(tier-0 capture bytes)"]:::command
        Import["import session commit"]:::command
        MCP["MCP save_link tool"]:::command
    end

    subgraph SubmitProducers["SubmitLinkCommand producers"]
        InboxAuto["inbox extract-email-links Lambda<br/>auto-submit per kept saveable link<br/>(origin=receive only)"]:::policy
        InboxBtn["inbox save button<br/>POST /inbox/:id/links/:ordinal/save"]:::command
    end

    SLC["SubmitLinkCommand<br/>url, userId"]:::command
    InboxAuto --> SLC
    InboxBtn --> SLC
    SQ[("SQS submit-link<br/>visibility 480 s, maxReceiveCount 3")]:::queue
    SLC -->|"EventBridge rule"| SQ
    Submit["save-link submit-link Lambda<br/>1769 MB / 240 s — guards, freshness,<br/>then in-process tier-1 crawl"]:::system
    SQ --> Submit

    Accept["shared accept phase<br/>initSaveArticleFromUrl<br/>(@packages/save-article)<br/>resolveCanonicalIdentity → upsert global stub<br/>+ per-user queue row + savedAt bump<br/>+ read→unread resurface"]:::system
    Bar --> Accept
    Siren --> Accept
    Bulk --> Accept
    Tier0 --> Accept
    Import --> Accept
    MCP --> Accept
    Submit --> Accept

    Tables[("hutch-articles /<br/>hutch-user-articles")]:::store
    Accept --> Tables

    LQ["LinkQueuedEvent<br/>url (as submitted), userId<br/>fires on EVERY freshness branch,<br/>duplicates included"]:::event
    Accept --> LQ

    Enrich["crawl / enrichment chain<br/>(TierContentExtracted → selector → summary;<br/>unchanged, see earlier snapshots)"]:::system
    Accept -.-> Enrich

    SDLQ[("submit-link DLQ<br/>+ depth alarm → SNS email")]:::dlq
    SQ -.->|"accept-phase throw ×3"| SDLQ
    DlqHandler["submit-link-dlq Lambda<br/>publish-only — mutates no article row;<br/>no-userId dead letters log + alarm only"]:::policy
    SDLQ --> DlqHandler
    LQF["LinkQueueFailedEvent<br/>url, userId,<br/>reason=accept-retries-exhausted,<br/>receiveCount"]:::event
    DlqHandler --> LQF
```

</details>

---

## 2. NEW — the retraction fact: deleting a queue row announces itself

`initDeleteArticleFromQueue` is the delete-side counterpart of the shared accept phase, and both hutch delete surfaces route through it. The URL is resolved **before** the delete (it is the row's canonical key — the thing being deleted); the publish happens **after** the delete commits, and unconditionally — even when `deleteArticle` reports the row was already gone, because that is exactly the retried-request case whose first publish may have failed.

`/remove-my-copy` additionally hands content erasure to save-link via the pre-existing `RemoveMyContentCommand` (tier-0 capture + authored snapshots + re-select / re-crawl / purge — that chain is unchanged and documented in the removal snapshot's lineage; here it is a boundary).

![The retraction fact](diagrams/dequeue-fact.svg)

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

    subgraph HutchWeb["hutch web Lambda (SSR) — guardless deletion rights (dualAuth only)"]
        Del["POST /queue/:id/delete<br/>(queue card delete)"]:::command
        RMC["POST /queue/:id/remove-my-copy<br/>(reader: erase my saved copy)"]:::command
        Read["POST /queue/:id/status<br/>(mark as read)"]:::command
    end

    Orchestrator["initDeleteArticleFromQueue<br/>(@packages/save-article)<br/>findArticleUrlById → deleteArticle<br/>→ publish (even when row already gone:<br/>re-announce on retried delete)"]:::new
    Del --> Orchestrator
    RMC --> Orchestrator

    Unknown["unknown hash id →<br/>no row, no publish, 303"]:::system
    Orchestrator -.-> Unknown

    UserArticles[("hutch-user-articles<br/>DeleteItem (per-user queue row)")]:::store
    Orchestrator --> UserArticles

    LDQ["LinkDequeuedEvent<br/>url (canonical row key), userId"]:::new
    Orchestrator --> LDQ

    RemoveCmd["RemoveMyContentCommand<br/>url, userId (no versionMinuteId)"]:::command
    RMC -->|"after the dequeue publish"| RemoveCmd
    Removal["save-link content-removal chain<br/>(unchanged — boundary)"]:::system
    RemoveCmd --> Removal

    NoFact1["publishes NOTHING —<br/>a read article is still in the queue;<br/>its inbox button keeps reading Save again"]:::system
    Read -.-> NoFact1

    DelAcct["DeleteAccountCommand →<br/>hutch delete-account Lambda"]:::policy
    Partition["deleteAllByUserId —<br/>drops the whole saved-links partition<br/>directly, no fact published"]:::system
    DelAcct -.-> Partition
```

</details>

---

## 3. One subscriber, three queues — the read model stays a pure function of the facts

All three facts cross the platform-stack EventBridge bus and land on the **same** inbox Lambda through three separate SQS queues — one rule per queue because each `eventBus.subscribe` provisions the queue's single physical policy. The handler dispatches on the envelope's `detail-type`; the write each fact maps to encodes the model's precedence rules. Every DLQ is alarm-only by design: the writes are single-row puts/deletes, so exhausting three receives means the datastore itself was unavailable — and a malformed URL or an unrouted detail-type is a producer contract violation worth paging on, never a record to skip or default.

![Read-model subscriber](diagrams/read-model-subscriber.svg)

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

    LQ["LinkQueuedEvent<br/>(save accepted)"]:::event
    LQF["LinkQueueFailedEvent<br/>(accept retries exhausted)"]:::event
    LDQ["LinkDequeuedEvent<br/>(queue row deleted)"]:::new

    Q1[("SQS inbox-record-link-queued<br/>visibility 90 s, maxReceiveCount 3")]:::queue
    Q2[("SQS inbox-record-link-queue-failed<br/>visibility 90 s, maxReceiveCount 3")]:::queue
    Q3[("SQS inbox-record-link-dequeued<br/>visibility 90 s, maxReceiveCount 3")]:::new

    LQ -->|"rule inbox-record-link-queued"| Q1
    LQF -->|"rule inbox-record-link-queue-failed"| Q2
    LDQ -->|"rule inbox-record-link-dequeued (NEW)"| Q3

    Handler["inbox record-link-queued Lambda<br/>256 MB / 30 s, batchSize 1<br/>dispatch on detail-type —<br/>unknown type or unparseable URL<br/>fails the record (never defaults)"]:::policy
    Q1 --> Handler
    Q2 --> Handler
    Q3 --> Handler

    W1["markLinkSaved<br/>unconditional PutItem —<br/>re-published facts and re-saves<br/>converge on the same row"]:::system
    W2["markLinkSaveFailed<br/>conditional PutItem<br/>(attribute_not_exists OR state <> saved)<br/>— an accepted save outranks a failure"]:::system
    W3["retractLinkSaved<br/>DeleteItem — absence IS the<br/>not-saved state; idempotent<br/>under redelivery"]:::new

    Handler -->|"LinkQueued"| W1
    Handler -->|"LinkQueueFailed"| W2
    Handler -->|"LinkDequeued"| W3

    Table[("hutch-inbox-saved-links<br/>PK userId, SK sha256(normalized url)<br/>state: saved | failed — no third state;<br/>row carries the raw url for the console")]:::store
    W1 --> Table
    W2 --> Table
    W3 --> Table

    D1[("DLQ + alarm → SNS email<br/>(alarm-only: single-row writes —<br/>exhaustion means DynamoDB was down,<br/>or a producer broke its contract)")]:::dlq
    Q1 -.-> D1
    Q2 -.-> D1
    Q3 -.->|"NEW third DLQ"| D1

    DelAcct["hutch delete-account Lambda<br/>deleteAllByUserId (partition drop,<br/>bypasses the fact stream)"]:::policy
    DelAcct -.-> Table
```

</details>

---

## 4. The read side — both tabs render live membership, and the loop closes

The inbox web Lambda resolves a whole page of buttons in one `BatchGetItem` (its only grant on the table). Both email-detail tabs — the Articles tab's link cards **and** the Skipped tab's excluded rows — now derive their button from the same shared view model, so the four states collapse to two renderings: `saved` → "Save again", anything else → "Save to queue". A URL that cannot be normalized is skipped rather than failing the page, and the sort key is a SHA-256 of the normalized URL because ESP wrapper URLs routinely exceed DynamoDB's 1024-byte key cap — stored raw, one such link would 500 the whole tab.

Clicking either button posts the same save route, which publishes `SubmitLinkCommand` — and the loop closes through diagram 1's accept phase back into diagram 3's read model. Saving a *skipped* link additionally logs the reader's implicit classifier verdict.

![Read side and the closed loop](diagrams/read-side-closed-loop.svg)

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

    subgraph InboxWeb["inbox web Lambda (same API Gateway, /inbox routes)"]
        Detail["GET /inbox/:id<br/>(email detail — view /<br/>articles / skipped tabs)"]:::command
        More["GET /inbox/:id/articles/more<br/>(next page of cards)"]:::command
        Card["GET /inbox/:id/links/:ordinal/card<br/>(3 s pending-card poll —<br/>save state read BEFORE the ETag,<br/>so membership is inside the validator)"]:::command
    end

    Lookup["findSavedLinks — one BatchGetItem<br/>per page of cards; unparseable URLs<br/>skipped, never a page failure"]:::system
    Detail --> Lookup
    More --> Lookup
    Card --> Lookup

    Table[("hutch-inbox-saved-links<br/>(inbox web grant: BatchGetItem only)")]:::store
    Lookup --> Table

    VM["shared save-button view model<br/>toInboxSaveButtonViewModel —<br/>both tabs render from it"]:::new
    Lookup --> VM

    Saved["state=saved →<br/>Save again (check icon,<br/>muted, still clickable)"]:::system
    Unsaved["absent or failed →<br/>Save to queue"]:::system
    VM --> Saved
    VM --> Unsaved

    SkippedTab["Skipped tab excluded rows<br/>now live — same model,<br/>previously hardcoded"]:::new
    VM --> SkippedTab

    SaveBtn["POST /inbox/:id/links/:ordinal/save<br/>requireNotLocked + requireWriteAccess<br/>404: bad ordinal / missing row /<br/>unsaveable URL"]:::command
    Saved -->|"re-save: same POST"| SaveBtn
    Unsaved --> SaveBtn
    SkippedTab --> SaveBtn

    Verdict["skipped link saved →<br/>classifier-audit feedback line<br/>(should-be-included)"]:::system
    SaveBtn -.-> Verdict

    SLC["SubmitLinkCommand<br/>stored URL (utm-stripped only<br/>when already resolved) —<br/>the save pipeline owns redirects"]:::command
    SaveBtn --> SLC

    Loop["→ diagram 1: submit-link accept phase<br/>→ LinkQueuedEvent → diagram 3:<br/>markLinkSaved → next render says Save again"]:::event
    SLC --> Loop

    Redirect["303 back to the link's own tab<br/>with a saved confirmation notice"]:::system
    SaveBtn --> Redirect
```

</details>

---

## Command → System → Event(s) reference table

| Command / trigger | System (handler) | Event(s) emitted | Next command(s) triggered |
|---|---|---|---|
| `POST /queue/save` (save bar), `POST /queue` (Siren save-article, extension + iOS), `POST /queue/save-articles` (bulk), `POST /queue/save-content` (tier-0 bytes), import commit, MCP `save_link` | hutch web Lambda → shared accept phase (`initSaveArticleFromUrl`) | **`LinkQueuedEvent`** (every branch, duplicates included); `LinkSaved` on new/refreshed content (enrichment chain, unchanged) | — (facts only; crawl chain continues out of band) |
| `SubmitLinkCommand` (from inbox extract-email-links auto-submit, or the inbox save button) | save-link `submit-link` Lambda (SQS, visibility 480 s, maxReceiveCount 3) → same shared accept phase, then in-process tier-1 crawl | **`LinkQueuedEvent`**; `TierContentExtractedEvent` / `SimpleCrawlUnsupportedEvent` (enrichment, unchanged) | selector → summary chain (unchanged) |
| `SubmitLinkCommand` dead-letter (accept retries exhausted) | `submit-link-dlq` Lambda (publish-only; no row mutation) | **`LinkQueueFailedEvent`** `{url, userId, reason, receiveCount}` (only when the command carried a `userId`) | — (DLQ depth alarm stays wired alongside) |
| **`POST /queue/:id/delete`** | hutch web Lambda → **`initDeleteArticleFromQueue`** (NEW): resolve URL → delete per-user row → publish, even when the row was already gone | **`LinkDequeuedEvent`** `{url (canonical row key), userId}` (NEW) | — |
| **`POST /queue/:id/remove-my-copy`** | same as `/delete`, then hand content erasure to save-link | **`LinkDequeuedEvent`** (NEW), then `RemoveMyContentCommand` | save-link content-removal chain (unchanged, boundary) |
| `POST /queue/:id/status` (mark as read) | hutch web Lambda | — deliberately none (a read article is still in the queue) | — |
| `DeleteAccountCommand` | hutch delete-account Lambda | — none for this model; calls `deleteAllByUserId` (drops the saved-links partition directly) | — |
| `LinkQueuedEvent` | inbox `record-link-queued` Lambda via SQS `inbox-record-link-queued` (rule `inbox-record-link-queued`) | — (store-only: unconditional `PutItem` `state=saved`) | — |
| `LinkQueueFailedEvent` | same Lambda via SQS `inbox-record-link-queue-failed` (rule `inbox-record-link-queue-failed`) | — (store-only: conditional `PutItem` `state=failed`; an accepted save outranks it) | — |
| **`LinkDequeuedEvent`** | same Lambda via **NEW** SQS `inbox-record-link-dequeued` + DLQ (rule `inbox-record-link-dequeued`) | — (store-only: **`DeleteItem`** — absence is the not-saved state) | — |
| `GET /inbox/:id` (+ panel fragments, `/articles/more`, per-card poll) | inbox web Lambda: `findSavedLinks` `BatchGetItem` → shared save-button view model (both tabs) | — (read only; save state sits inside the card poll's ETag) | reader click → `POST /inbox/:id/links/:ordinal/save` |
| `POST /inbox/:id/links/:ordinal/save` | inbox web Lambda (write gates; 404 for bad ordinal / missing row / unsaveable URL; skipped-link saves also log classifier feedback) | — (publishes a command, not a fact) | `SubmitLinkCommand` → loop back to the accept phase |

**Wire formats** (deployment contracts): `LinkQueuedEvent` = `hutch.save-article` / `LinkQueued`; `LinkQueueFailedEvent` = `hutch.save-link` / `LinkQueueFailed`; **`LinkDequeuedEvent` = `hutch.save-article` / `LinkDequeued` (NEW)**. All three ride the shared platform-stack EventBridge bus.
