# Media upload events are declared

Snapshot of the uncommitted working tree over `1403d332c` (`main`), whose 2026-11-04 subject is **feat(@packages/hutch-infra-components): filter subscriptions by detail**. Generated 2026-11-04.

The shared event catalogue gains its first two `hutch.media` events. This is the complete current state of media upload messaging: nothing publishes either event and no rule subscribes to it, so the bus routes nothing new.

- **`MediaUploadCommittedEvent`.** Declares that a reader's upload is committed and ready to process. Its `attempt` is part of the detail so a later retry can republish without changing a key.
- **`MediaProcessingFailedEvent`.** Declares that a commit's processing ended in failure, with a reason from the media contracts and the notice the reader will see.

Every Lambda bundle that imports the catalogue now carries the media contracts, so a deploy updates Lambda code in place. No rule, queue or table changes.

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
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    S["System / aggregate"]:::system
    E(("Event")):::event
    N(("Added by this change")):::new
```

</details>

---

## Declared events

Both events are declared and unwired: the dashed lines show the bus they will travel on once a later change publishes them.

![Declared events](diagrams/declared-events.svg)

[BPMN image](diagrams-bpmn/declared-events.png) · [Editable BPMN](diagrams-bpmn/declared-events.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    M["Media contracts: upload id, private item URL, kind name, failure reason"]:::system
    M --> C(("MediaUploadCommittedEvent")):::new
    M --> F(("MediaProcessingFailedEvent")):::new
    C -. "declared, unwired" .-> B["Shared event bus, source hutch.media"]:::system
    F -. "declared, unwired" .-> B
```

</details>

---

## Command → System → Event(s) reference

| Command or event | Detail | System | Emits | Triggers next |
|---|---|---|---|---|
| `MediaUploadCommittedEvent` | `uploadId`, `kind`, `url`, `userId`, `saveAttemptId`, `etag`, `attempt` | none yet | nothing | none; no rule subscribes |
| `MediaProcessingFailedEvent` | `uploadId`, `kind`, `url`, `saveAttemptId`, `attempt`, `reason`, `notice` | none yet | nothing | none; no rule subscribes |
