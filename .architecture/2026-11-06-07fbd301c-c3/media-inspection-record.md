# An upload's inspection is recorded on its session

Snapshot of the uncommitted working tree over `07fbd301c` (`main`), whose 2026-11-06 subject is **fix(hutch): shrink the EPUB image budget as the body grows**. Generated 2026-11-06.

A new `record-media-inspection` Lambda takes the inspection events declared in the previous snapshot off the bus and writes the verdict onto the upload session row. Nothing publishes those events yet, so the new rules match nothing until the inspector lands.

- **`record-media-inspection` queue and Lambda.** EventBridge rules `media-inspected-rule` and `media-rejected-rule` route `MediaInspectedEvent` and `MediaRejectedEvent` to an SQS queue (30-second visibility, batch size 1) with its own dead-letter queue and alert email. The Lambda moves a row from `inspecting` to `ready` with the book's facts, or to `rejected` with the reason and notice. A redelivery that finds the row no longer `inspecting` is logged and acknowledged.
- **Upload session table, guest rows.** The existing media-upload-sessions table gains rows with no `userId`: created `staged`, marked `inspecting` with the stored ETag, then `ready` or `rejected`. A reader claims a `ready` guest row by writing their `userId` on it, which sets it back to `staged` for the existing commit. Every write is conditional on the row's status. The Lambda holds `dynamodb:UpdateItem` on that table only.
- **Web app.** The production providers gain the guest-session functions and an EventBridge publisher for `MediaUploadStagedEvent`. No route calls them yet.

No table, index or existing rule changes. Deploying creates one Lambda, two queues, two rules and a queue policy.

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

## Recording an inspection

An inspection's verdict reaches the session row through its own queue. The dashed lines are the inspector's publishes, which a later change adds.

![Recording an inspection](diagrams/record-inspection.svg)

[BPMN image](diagrams-bpmn/record-inspection.png) · [Editable BPMN](diagrams-bpmn/record-inspection.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e6b8,stroke:#2e7d32,color:#000
    classDef queue   fill:#d9d9d9,stroke:#555,color:#000
    classDef dlq     fill:#f4a6a6,stroke:#a00,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    I["Inspector (later change)"]:::system
    I -.-> OK(("MediaInspectedEvent")):::event
    I -.-> NO(("MediaRejectedEvent")):::event
    OK --> Q[["record-media-inspection queue"]]:::new
    NO --> Q
    Q --> L["record-media-inspection Lambda"]:::new
    Q -.->|on failure| DLQ[["record-media-inspection DLQ"]]:::new
    L -->|inspecting to ready or rejected| T[("media-upload-sessions table")]:::store
```

</details>

---

## A guest upload's session

The states a guest row moves through. Each arrow is a write conditioned on the state it leaves.

![A guest upload's session](diagrams/guest-session.svg)

[BPMN image](diagrams-bpmn/guest-session.png) · [Editable BPMN](diagrams-bpmn/guest-session.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef store   fill:#b8e6b8,stroke:#2e7d32,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    S["staged, no owner"]:::new --> IN["inspecting, ETag stored"]:::new
    IN --> R["ready, facts"]:::new
    IN --> X["rejected, reason and notice"]:::new
    R -->|reader claims| C["staged, owned"]:::system
    C --> COMMIT["existing commit"]:::system
```

</details>
