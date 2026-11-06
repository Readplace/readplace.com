# A staged book is inspected with ranged reads

Snapshot of the uncommitted working tree over `615c1094a` (detached, on top of `main`), whose subject is **wip s04-c9**. Generated 2026-11-06.

The media-book stack gains an inspector for an upload that has been staged but not yet committed. It reads only the EPUB's end record, its central directory and a few small entries from the stored original, never the whole file, and publishes the verdict the session consumer from the previous snapshot records. Nothing publishes `MediaUploadStagedEvent` yet, so the new rule matches nothing until the logged-out upload lands.

- **`media-book-inspect-book` queue and Lambda.** An EventBridge rule routes `MediaUploadStagedEvent` for books to an SQS queue (240-second visibility, two receives, batch size 1). The Lambda (1024 MB, 120-second timeout) reads byte ranges of the pending original under the ETag the event carries, so a replaced or deleted original is refused as gone. It publishes `MediaInspectedEvent` with the book's title, authors and section titles, or `MediaRejectedEvent` with a reason and notice for a DRM-locked book, a file that is not an EPUB, or bytes that are gone. It holds read access to the pending prefix only.
- **Shared media-book dead-letter queue.** The inspector's exhausted messages land in the existing `media-book-failures` dead-letter queue. Its router gains an inspect-book route that publishes `MediaRejectedEvent` with the processing-exhausted reason, so a poison file ends on a refusal rather than a page that keeps polling.

No table, bucket or existing rule changes. Deploying creates one Lambda, one queue, one rule and a queue policy.

---

## Legend

Amber marks what this change adds. Everything else is existing infrastructure shown for context.

![Legend](diagrams/legend.svg)

[BPMN image](diagrams-bpmn/legend.png) · [Editable BPMN](diagrams-bpmn/legend.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e6b8,stroke:#2e7d32,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    S["System / aggregate"]:::system
    E(("Event")):::event
    D[("Data store")]:::store
    N(("Added by this change")):::new
```

</details>

---

## Inspecting a staged book

The dashed line from the web app is the staging publish, which a later change turns on.

![Inspecting a staged book](diagrams/inspect-book.svg)

[BPMN image](diagrams-bpmn/inspect-book.png) · [Editable BPMN](diagrams-bpmn/inspect-book.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e6b8,stroke:#2e7d32,color:#000
    classDef queue   fill:#d9d9d9,stroke:#555,color:#000
    classDef dlq     fill:#f4a6a6,stroke:#a00,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    W["Web app (later change)"]:::system
    W -.-> ST(("MediaUploadStagedEvent")):::event
    ST --> Q[["media-book-inspect-book queue"]]:::new
    Q --> L["inspect-book Lambda"]:::new
    B[("media bucket, pending original")]:::store -->|ranged reads| L
    L --> OK(("MediaInspectedEvent")):::event
    L --> NO(("MediaRejectedEvent")):::event
    OK --> R["record-media-inspection"]:::system
    NO --> R
    Q -.->|after two receives| DLQ[["media-book-failures DLQ"]]:::dlq
    DLQ --> DR["media-book-failures router"]:::system
    DR -->|processing exhausted| NO2(("MediaRejectedEvent")):::new
```

</details>
