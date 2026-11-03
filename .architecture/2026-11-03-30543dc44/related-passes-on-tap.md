# Related passes on tap: a save of an automatically queued link now runs them

Snapshot of the uncommitted working tree over `30543dc44` (`main`), whose 2026-11-03 subject is **fix(hutch): quote the inbox name on the Stop sending button**

Automatic saves skip Next read and Past reads, to save two DeepSeek calls per link. When a reader later tapped save on a link an automatic save had already queued, nothing asked for those passes, because the only trigger needed a newly created row. This change asks on the tap.

- **Only a manual save asks.** Automatic saves still run no related pass.
- **A row asks at most once.** A request stamps `relatedPassesRequestedAt` on the reader's default-list row, so tapping again publishes nothing. Deleting the row removes the stamp, so a later re-save asks again.
- **A new command covers a row that already exists.** `ComputeRelatedPassesCommand` runs both passes on an existing row. A newly created row still publishes `QueueEntryCreatedEvent`, and an existing row whose Next read has settled publishes `ComputeRelatedPastReadsCommand`.
- **A row with both passes settled asks for nothing.**
- **The router treats the new command like the event.** Both reach the Next read pass and the Past reads pass. A failed record is retried whole, because both passes are idempotent.

The Pulumi change is one more detail type on the `compute-related-articles` subscription. The queue, its DLQ and the Lambda stay.

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

## 1. What a save asks for

The decision runs after the save, on the reader's row. An automatic save leaves the row without a stamp, so the tap that follows still asks.

![What a save asks for](diagrams/save-asks-for-passes.svg)

[BPMN image](diagrams-bpmn/save-asks-for-passes.png) · [Editable BPMN](diagrams-bpmn/save-asks-for-passes.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    TAP["Reader taps save"]:::ui
    AUTO["Automatic save"]:::ui
    SAVE["Save the link"]:::system
    ROW[("Default-list user-article row")]:::store
    NONE["No related pass requested"]:::system
    GATE{{"requestMissingRelatedPasses<br/>manual saves only"}}:::new
    REQ{{"Row saved and not yet stamped?"}}:::new
    BOTH{{"Both passes settled?"}}:::new
    NEXT{{"Next read settled?"}}:::new
    CREATED{{"Row created by this save?"}}:::policy
    PAST["ComputeRelatedPastReadsCommand"]:::command
    QEC(("QueueEntryCreatedEvent")):::event
    PASSES["ComputeRelatedPassesCommand"]:::new
    MARK["markRelatedPassesRequested<br/>stamps relatedPassesRequestedAt"]:::new
    STOP["Nothing published"]:::system

    TAP --> SAVE
    AUTO --> SAVE
    SAVE --> ROW
    AUTO -.-> NONE
    TAP --> GATE
    GATE --> REQ
    REQ -->|"no"| STOP
    REQ -->|"yes"| BOTH
    BOTH -->|"yes"| STOP
    BOTH -->|"no"| NEXT
    NEXT -->|"yes"| PAST
    NEXT -->|"no"| CREATED
    CREATED -->|"yes"| QEC
    CREATED -->|"no"| PASSES
    PAST --> MARK
    QEC --> MARK
    PASSES --> MARK
    MARK --> ROW
```

</details>

---

## 2. How the requests reach the passes

Four detail types share one queue. The router sends each record to the passes it needs.

![How the requests reach the passes](diagrams/compute-related-routing.svg)

[BPMN image](diagrams-bpmn/compute-related-routing.png) · [Editable BPMN](diagrams-bpmn/compute-related-routing.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    QEC(("QueueEntryCreatedEvent")):::event
    PASSES["ComputeRelatedPassesCommand"]:::new
    PAST["ComputeRelatedPastReadsCommand"]:::command
    CCC(("CanonicalContentChangedEvent")):::event
    Q[("compute-related-articles queue<br/>batch size 1")]:::queue
    DLQ[("compute-related-articles DLQ")]:::dlq
    ROUTER["compute-related-passes router"]:::new
    NR["Next read pass"]:::system
    PR["Past reads pass"]:::system
    RE["Recompute a skipped Next read"]:::system
    ROW[("Default-list user-article row<br/>relatedStatus, pastReadsComputedAt")]:::store

    QEC --> Q
    PASSES --> Q
    PAST --> Q
    CCC --> Q
    Q --> ROUTER
    Q -->|"out of receives"| DLQ
    ROUTER -->|"QueueEntryCreated, ComputeRelatedPasses"| NR
    ROUTER -->|"QueueEntryCreated, ComputeRelatedPasses, ComputeRelatedPastReads"| PR
    ROUTER -->|"CanonicalContentChanged"| RE
    NR --> ROW
    PR --> ROW
    RE --> ROW
```

</details>

---

## Command → System → Event(s) reference

| Command or event | System | Emits | Next |
|---|---|---|---|
| Manual save, row newly created | Save path | `QueueEntryCreatedEvent`, stamps `relatedPassesRequestedAt` | Next read and Past reads passes |
| Manual save, existing row, no stamp, Next read not settled | Save path | `ComputeRelatedPassesCommand`, stamps `relatedPassesRequestedAt` | Next read and Past reads passes |
| Manual save, existing row, no stamp, Next read settled, Past reads not settled | Save path | `ComputeRelatedPastReadsCommand`, stamps `relatedPassesRequestedAt` | Past reads pass only |
| Manual save, row stamped or both passes settled | Save path | Nothing | Stops |
| Automatic save | Save path | Nothing related | Row stays unstamped until a tap |
| `ComputeRelatedPassesCommand` | compute-related-articles Lambda | Related rows | Next read and Past reads passes |
| `ComputeRelatedPastReadsCommand` | compute-related-articles Lambda | Related rows | Past reads pass only |
| `QueueEntryCreatedEvent` | compute-related-articles Lambda | Related rows | Next read and Past reads passes |
| `CanonicalContentChangedEvent` | compute-related-articles Lambda | Related rows | Replaces a skipped Next read |
