# A failed media upload is settled on its card

Snapshot of the uncommitted working tree over `c2228541f` (`main`), whose 2026-11-05 subject is **feat(hutch): provision the media upload sessions table and pending grant**. Generated 2026-11-05.

`MediaProcessingFailedEvent` gains its first subscriber. Nothing in this tree publishes the event yet; the media processing stage that does lands in a later change. A new rule sends every such fact to a new `settle-media-failure` queue and Lambda, which settles the failure in two places:

- **The private item row.** The Lambda marks the item's article row failed, records a `processing-failed` reason carrying the notice, and stores the notice on the row. The write is conditional on the row having an owner, so a row that is gone or is not a private item answers `not-found`, which is logged and acknowledged.
- **The upload session.** The Lambda moves the upload session from `committed` to `failed` with one conditional update. A session in any other state answers `not-committed`, which is logged and acknowledged.
- **Failure.** A malformed message or a step that throws fails the record; the queue retries it and then dead-letters it, and the DLQ alarm emails the alert address.

The reader sees the result on the next read: the readlist card shows the notice with an "Upload again" link to the upload page (tracked as a queue-card, failed-card link), and the reader poll renders the processing-failed state with the same notice and link.

The upload sessions table gets its DynamoDB store in this change. Every session transition is one conditional update; a new session expires 24 hours after it is created, and a lookup by another user finds nothing.

---

## Legend

Amber marks what this change adds. Everything else is existing infrastructure shown for context.

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
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P{{"Policy / reaction"}}:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    N["Added by this change"]:::new
```

</details>

---

## Settling the failure

The bus carries `MediaProcessingFailedEvent` (source `hutch.media`) to the new rule with no filter. The Lambda takes one message at a time.

![Settling the failure](diagrams/settle-media-failure.svg)

[BPMN image](diagrams-bpmn/settle-media-failure.png) · [Editable BPMN](diagrams-bpmn/settle-media-failure.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    E(("MediaProcessingFailedEvent: uploadId, url, reason, notice")):::event --> B["Shared event bus"]:::system
    B --> Q[("settle-media-failure queue")]:::new
    Q --> L["settle-media-failure Lambda: parse the detail"]:::new
    Q -. "exhausted" .-> D[("settle-media-failure DLQ + alarm email")]:::new
    L --> R1["1. Record the private item failure"]:::new
    R1 --> A[("Articles table: crawlStatus failed, processing-failed reason, processingNotice")]:::store
    R1 --> P1{{"Row has an owner?"}}:::new
    P1 -- "no" --> NF["not-found, logged"]:::new
    P1 -- "yes" --> OK1["recorded"]:::new
    NF --> R2["2. Fail the upload session"]:::new
    OK1 --> R2
    R2 --> S[("Media upload sessions table: committed to failed")]:::store
    R2 --> P2{{"Session is committed?"}}:::new
    P2 -- "no" --> NC["not-committed, logged"]:::new
    P2 -- "yes" --> OK2["failed, logged"]:::new
    L -. "malformed" .-> F["Record fails: SQS retries, then dead-letters"]:::queue
    R1 -. "throws" .-> F
    R2 -. "throws" .-> F
```

</details>

---

## Reading the failed item

![Reading the failed item](diagrams/failed-card-read.svg)

[BPMN image](diagrams-bpmn/failed-card-read.png) · [Editable BPMN](diagrams-bpmn/failed-card-read.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    A[("Articles table: processingNotice")]:::store
    U1["Reader opens the readlist"]:::command --> RL["Readlist page"]:::system
    RL --> A
    RL --> C["Card: notice + Upload again link to the upload page"]:::new
    U2["Reader poll for the item"]:::command --> RP["Reader slot"]:::system
    RP --> A
    RP --> F["processing-failed state: notice + Upload again"]:::new
```

</details>

---

## Command → System → Event(s) reference

| Command or event | Detail | System | Emits | Triggers next |
|---|---|---|---|---|
| `MediaProcessingFailedEvent` (rule for `settle-media-failure`, new) | `uploadId`, `kind`, `url`, `saveAttemptId`, `attempt`, `reason`, `notice` | `settle-media-failure` Lambda (new) | nothing | marks the private item row failed with the notice, then moves the upload session from committed to failed |
| Reader opens the readlist | readlist | hutch readlist page | nothing | renders the stored notice on the card with an "Upload again" link |
| Reader poll for the item | article id | hutch reader slot | nothing | renders the processing-failed state with the notice and "Upload again" |
