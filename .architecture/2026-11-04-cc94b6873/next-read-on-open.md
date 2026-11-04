# Next read on open: the reader asks for it, the save no longer does

Snapshot of the uncommitted working tree over `cc94b6873` (`main`), whose 2026-11-04 subject is **fix(hutch): name the apps in the privacy policy and list deletion steps publicly**

Next read used to be requested at save time, and only by a manual save. An automatic save (an email link, a bulk import) asked for nothing, so opening such an article in the reader polled for a Next read card that never came. This change moves the Next read request to the reader open, the same request Already read already used.

- **No save asks for Next read explicitly.** A manual save that creates the row still publishes `QueueEntryCreatedEvent`, which precomputes Already read; until the worker router is trimmed in the next push, the worker also runs Next read on that event. An existing row and every automatic save publish nothing related.
- **Opening the article asks.** The hidden load form on the reader posts the topic-reads request, behind the same lock and write-access gates. When the row is saved, Next read has not settled and the row is not stamped, it publishes `ComputeRelatedPassesCommand` and then stamps `relatedPassesRequestedAt`. Otherwise it publishes `ComputeRelatedPastReadsCommand`, carrying the source readlist as before.
- **Publish before stamp.** A failed publish leaves the row unstamped, so the next open asks again.
- **The card arrives through the existing poll.** The reader already polls the related slot every 3 seconds until the row's related status lands, so the card appears without a reload.
- **The stamp now means Next read was requested.** Rows stamped by the earlier save-time request had Next read requested or settled, so they take the Past reads branch.

No infrastructure changes. The `compute-related-articles` subscription, queue, DLQ, Lambda and router are as they were.

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

Only a manual save that creates the row publishes anything related, and that event precomputes Already read. Every other save leaves the related passes to the reader open.

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
    GATE{{"Manual save that created the row?"}}:::new
    QEC(("QueueEntryCreatedEvent")):::event
    STOP["No related request<br/>left to the reader open"]:::new

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

The reader page fires the hidden load form on open. The topic-reads route decides between both passes and Past reads alone from the row's related state.

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
    REQ["requestRelatedPasses"]:::new
    READ[("Default-list user-article row<br/>related state, relatedPassesRequestedAt")]:::store
    DECIDE{{"Saved, Next read unsettled<br/>and not stamped?"}}:::new
    PASSES["ComputeRelatedPassesCommand"]:::command
    MARK["markRelatedPassesRequested<br/>stamps relatedPassesRequestedAt"]:::new
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

## 3. How the requests reach the passes

Unchanged by this change. Four detail types share one queue, and the router sends each record to the passes it needs.

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
| Manual save, row newly created | Save path | `LinkQueuedEvent`, `QueueEntryCreatedEvent` | Next read and Past reads passes |
| Manual save, existing row | Save path | `LinkQueuedEvent` | Nothing related until the reader opens it |
| Automatic save | Save path | `LinkQueuedEvent` | Nothing related until the reader opens it |
| Reader open, row saved, Next read unsettled, not stamped | Topic-reads route | `ComputeRelatedPassesCommand`, then stamps `relatedPassesRequestedAt` | Next read and Past reads passes |
| Reader open, row stamped or Next read settled | Topic-reads route | `ComputeRelatedPastReadsCommand` with the source readlist | Past reads pass only |
| Reader open, row not saved | Topic-reads route | `ComputeRelatedPastReadsCommand` | Past reads pass only |
| `ComputeRelatedPassesCommand` | compute-related-articles Lambda | Related rows | Next read and Past reads passes |
| `ComputeRelatedPastReadsCommand` | compute-related-articles Lambda | Related rows | Past reads pass only |
| `QueueEntryCreatedEvent` | compute-related-articles Lambda | Related rows | Next read and Past reads passes |
| `CanonicalContentChangedEvent` | compute-related-articles Lambda | Related rows | Replaces a skipped Next read |
| Related slot poll | Reader | Next read card once the related status lands | Stops polling |
