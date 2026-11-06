# A logged-out book upload is staged for review

Snapshot of the uncommitted working tree over `be1020cea` (detached, on top of `main`), whose subject is **wip s03-c4**. Generated 2026-11-06.

The web app now publishes `MediaUploadStagedEvent`. A visitor who is not signed in can upload a book. When the upload is received, the web app marks the session inspecting and publishes the staged event. The media-book inspector from the previous snapshot then reads the book. The review page polls the session until it records the verdict. The book is saved to a queue only after the visitor signs up and commits the review. That commit publishes `MediaUploadCommittedEvent`, just as a signed-in upload does.

- **Staging publish turned on.** A received upload from a logged-out session marks the session inspecting and publishes `MediaUploadStagedEvent` with the upload id, kind, media type, file name, size, ETag and staged time. A second `received` on a session that is already inspecting publishes nothing. A signed-in upload still commits directly and publishes `MediaUploadCommittedEvent`.
- **Commit after signup.** The anonymous review's commit route claims the session for the signed-in reader, saves the item and publishes `MediaUploadCommittedEvent` once.

No queue, rule, Lambda, table or bucket changes. The web app already publishes to the event bus, so deploying changes only its code.

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

## Staging a logged-out book for review

![Staging a logged-out book for review](diagrams/stage-for-review.svg)

[BPMN image](diagrams-bpmn/stage-for-review.png) · [Editable BPMN](diagrams-bpmn/stage-for-review.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e6b8,stroke:#2e7d32,color:#000
    classDef queue   fill:#d9d9d9,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    W["Web app, logged-out upload received"]:::new
    S[("media upload session table")]:::store
    W -->|mark inspecting| S
    W --> ST(("MediaUploadStagedEvent")):::new
    ST --> Q[["media-book-inspect-book queue"]]:::queue
    Q --> L["inspect-book Lambda"]:::system
    L --> V(("MediaInspectedEvent or MediaRejectedEvent")):::event
    V --> R["record-media-inspection"]:::system
    R --> S
    P["Web app, review page poll"]:::new
    S --> P
    P --> C["Web app, commit after signup"]:::new
    C --> CM(("MediaUploadCommittedEvent")):::event
```

</details>
