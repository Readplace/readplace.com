# Next read on open: the worker router stops running Next read on save

Snapshot of the uncommitted working tree over `af99460ff` (`main`), whose 2026-11-04 subject is **ci(android): stop calling the Play publish job until the app exists in Play Console**

This is the second push of the Next-read-on-open change. The first push moved the Next read request to the reader open: opening an article publishes `ComputeRelatedPassesCommand` once per row, and no save asks for Next read explicitly. A manual save that created the row still published `QueueEntryCreatedEvent`, and the worker router still ran Next read on it. This push trims the router so that event runs Past reads alone.

- **Next read runs only on `ComputeRelatedPassesCommand`.** The router sends a `QueueEntryCreatedEvent` record only to the Past reads pass.
- **Past reads is unchanged.** It still takes `QueueEntryCreatedEvent`, `ComputeRelatedPassesCommand` and `ComputeRelatedPastReadsCommand`.
- **The recompute pass is unchanged.** `CanonicalContentChangedEvent` still goes only to the pass that replaces a skipped Next read.
- **The Next read pass parses one detail shape.** It reads the `ComputeRelatedPassesCommand` detail alone; the union with the `QueueEntryCreatedEvent` detail is gone.

No infrastructure changes. The `compute-related-articles` subscription, queue, DLQ and Lambda are as they were, and `QueueEntryCreatedEvent` still reaches the queue for Past reads.

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

Unchanged by this change. Only a manual save that creates the row publishes anything related, and that event now precomputes Already read alone. Every other save leaves the related passes to the reader open.

![What a save asks for](diagrams/save-asks-for-past-reads.svg)

[BPMN image](diagrams-bpmn/save-asks-for-past-reads.png) · [Editable BPMN](diagrams-bpmn/save-asks-for-past-reads.bpmn)

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
    AUTO["Automatic save<br/>email link, bulk import"]:::ui
    SAVE["Save the link"]:::system
    ROW[("Default-list user-article row")]:::store
    LQ(("LinkQueuedEvent")):::event
    GATE{{"Manual save that created the row?"}}:::policy
    QEC(("QueueEntryCreatedEvent")):::event
    STOP["No related request<br/>left to the reader open"]:::policy

    TAP --> SAVE
    AUTO --> SAVE
    SAVE --> ROW
    SAVE --> LQ
    SAVE --> GATE
    GATE -->|"yes"| QEC
    GATE -->|"no"| STOP
```

</details>

---

## 2. What opening the article asks for

Unchanged by this change. The reader page fires the hidden load form on open. The topic-reads route decides between both passes and Past reads alone from the row's related state. This is now the only request that runs Next read for a saved row.

![What opening the article asks for](diagrams/reader-open-asks-for-passes.svg)

[BPMN image](diagrams-bpmn/reader-open-asks-for-passes.png) · [Editable BPMN](diagrams-bpmn/reader-open-asks-for-passes.bpmn)

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

    OPEN["Reader opens the article"]:::ui
    FORM["Hidden load form<br/>POST topic-reads"]:::ui
    GATES["Lock and write-access gates"]:::policy
    ROUTE["Topic-reads route"]:::system
    REQ["requestRelatedPasses"]:::system
    READ[("Default-list user-article row<br/>related state, relatedPassesRequestedAt")]:::store
    DECIDE{{"Saved, Next read unsettled<br/>and not stamped?"}}:::policy
    PASSES["ComputeRelatedPassesCommand"]:::command
    MARK["markRelatedPassesRequested<br/>stamps relatedPassesRequestedAt"]:::system
    PAST["ComputeRelatedPastReadsCommand<br/>with the source readlist"]:::command
    POLL["Related slot polls every 3 s"]:::ui
    CARD["Next read card shown"]:::ui

    OPEN --> FORM
    OPEN --> POLL
    FORM --> GATES
    GATES --> ROUTE
    ROUTE --> REQ
    REQ --> READ
    READ --> DECIDE
    DECIDE -->|"yes"| PASSES
    PASSES --> MARK
    MARK --> READ
    DECIDE -->|"no"| PAST
    POLL -->|"related status landed"| CARD
```

</details>

---

---

## 3. How the requests reach the passes

Four detail types still share one queue. The router now sends a `QueueEntryCreatedEvent` record to Past reads alone, and runs Next read only for `ComputeRelatedPassesCommand`.

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
    PASSES["ComputeRelatedPassesCommand"]:::command
    PAST["ComputeRelatedPastReadsCommand"]:::command
    CCC(("CanonicalContentChangedEvent")):::event
    Q[("compute-related-articles queue<br/>batch size 1")]:::queue
    DLQ[("compute-related-articles DLQ")]:::dlq
    ROUTER["compute-related-passes router"]:::system
    QECR{{"QueueEntryCreated<br/>past reads only"}}:::new
    PASSESR{{"ComputeRelatedPasses<br/>to Next read"}}:::new
    NR["Next read pass<br/>parses ComputeRelatedPasses only"]:::new
    PR["Past reads pass"]:::system
    RE["Recompute a skipped Next read"]:::system
    ROW[("Default-list user-article row<br/>relatedStatus, pastReadsComputedAt")]:::store

    QEC --> Q
    PASSES --> Q
    PAST --> Q
    CCC --> Q
    Q --> ROUTER
    Q -->|"out of receives"| DLQ
    ROUTER -->|"QueueEntryCreated"| QECR
    QECR --> PR
    ROUTER -->|"ComputeRelatedPasses"| PASSESR
    PASSESR --> NR
    ROUTER -->|"ComputeRelatedPasses, ComputeRelatedPastReads"| PR
    ROUTER -->|"CanonicalContentChanged"| RE
    NR --> ROW
    PR --> ROW
    RE --> ROW

    linkStyle 6,7,8,9 stroke:#a0660b,stroke-width:3px
```

</details>

---

## Command → System → Event(s) reference

| Command or event | System | Emits | Next |
|---|---|---|---|
| Manual save, row newly created | Save path | `LinkQueuedEvent`, `QueueEntryCreatedEvent` | Past reads pass only |
| Manual save, existing row | Save path | `LinkQueuedEvent` | Nothing related until the reader opens it |
| Automatic save | Save path | `LinkQueuedEvent` | Nothing related until the reader opens it |
| Reader open, row saved, Next read unsettled, not stamped | Topic-reads route | `ComputeRelatedPassesCommand`, then stamps `relatedPassesRequestedAt` | Next read and Past reads passes |
| Reader open, row stamped or Next read settled | Topic-reads route | `ComputeRelatedPastReadsCommand` with the source readlist | Past reads pass only |
| Reader open, row not saved | Topic-reads route | `ComputeRelatedPastReadsCommand` | Past reads pass only |
| `ComputeRelatedPassesCommand` | compute-related-articles Lambda | Related rows | Next read and Past reads passes |
| `ComputeRelatedPastReadsCommand` | compute-related-articles Lambda | Related rows | Past reads pass only |
| `QueueEntryCreatedEvent` | compute-related-articles Lambda | Related rows | Past reads pass only (no longer Next read) |
| `CanonicalContentChangedEvent` | compute-related-articles Lambda | Related rows | Replaces a skipped Next read |
| Related slot poll | Reader | Next read card once the related status lands | Stops polling |
