# Own dead-letter queues for the judge and summary queues

Snapshot of the uncommitted working tree over `27cbb47b6` (`main`), whose 2026-11-02 subject is **docs: link the rescan that replaced the canary tracking snapshot**. Generated 2026-11-02.

A dead letter on the three judge queues or the summary queue used to land in the shared failures queue, whose consumer marked the article failed and deleted the message, so nothing was left to redrive. The failed mark now happens in the live handler on the final receive, and each of the four queues keeps its dead letters in a queue of its own.

- **Four own dead-letter queues.** `select-most-complete-content`, `reselect-after-removal`, `recrawl-content-extracted` and `generate-summary` each gain a dead-letter queue with 14-day retention, a topic, an email subscription and an alarm. Nothing consumes these queues: a message waits there until an operator redrives it.
- **The rule's own failed delivery goes the same way.** The three event rules that feed the judge queues point their dead-letter target at the new queue, with a queue policy that lets the rule send to it. `GenerateSummaryCommand` is sent directly by its producers, so it has no rule and no policy.
- **The final receive marks the row.** On the third receive the handler persists the failed mark and still fails the record, so the reader sees the failed state at once and the message moves to the dead-letter queue.
- **The refresh queue is not one of the four.** It already has its own dead-letter queue, and its handler keeps the row on the final receive.
- **Four routes leave the shared consumer.** The routes and their handlers go in a later commit, once these queues have stopped feeding the shared queue and it has drained. Until then the routes stay and receive nothing new.

Queue names and receive counts do not change. No Lambda code or environment changes with the queues.

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
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P["Policy / reaction"]:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    N["Added or changed by this change"]:::new
```

</details>

---

## 1. The judge queues

A crawl, save or removal publishes an event; a rule routes it to the queue, and the shared selection handler runs the judge. A failed delivery from the rule and a message out of receives both reach the same own dead-letter queue.

![The judge queues](diagrams/judge-queues.svg)

[BPMN image](diagrams-bpmn/judge-queues.png) · [Editable BPMN](diagrams-bpmn/judge-queues.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    E1(("TierContentExtractedEvent")):::event --> R1["tier-content-extracted rule"]:::system --> Q1[("select-most-complete-content queue")]:::queue
    E2(("ReselectAfterRemovalEvent")):::event --> R2["reselect-after-removal rule"]:::system --> Q2[("reselect-after-removal queue")]:::queue
    E3(("RecrawlContentExtractedEvent")):::event --> R3["recrawl-content-extracted rule"]:::system --> Q3[("recrawl-content-extracted queue")]:::queue

    Q1 --> H1["select-most-complete-content Lambda"]:::system
    Q2 --> H2["reselect-after-removal Lambda"]:::system
    Q3 --> H3["recrawl-content-extracted Lambda"]:::system

    H1 --> W["Judge the candidates and commit the winner"]:::system
    H2 --> W
    H3 --> W
    W --> A[("Articles table and content bucket")]:::store
    W --> C["GenerateSummaryCommand"]:::command

    H1 -- "failed, receive 3" --> M["Persist the failed crawl mark, then fail the record"]:::new
    H2 -- "failed, receive 3" --> M
    H3 -- "failed, receive 3" --> M
    M --> A

    Q1 -- "out of receives" --> D1[("select-most-complete-content-dlq")]:::new
    Q2 -- "out of receives" --> D2[("reselect-after-removal-dlq")]:::new
    Q3 -- "out of receives" --> D3[("recrawl-content-extracted-dlq")]:::new
    R1 -- "delivery failed" --> D1
    R2 -- "delivery failed" --> D2
    R3 -- "delivery failed" --> D3
```

</details>

---

## 2. The summary queue

Producers send `GenerateSummaryCommand` straight to the queue, so no rule or queue policy is involved.

![The summary queue](diagrams/summary-queue.svg)

[BPMN image](diagrams-bpmn/summary-queue.png) · [Editable BPMN](diagrams-bpmn/summary-queue.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    C["GenerateSummaryCommand"]:::command --> Q[("generate-summary queue")]:::queue --> H["generate-summary Lambda"]:::system
    H -- "summary written" --> A[("Articles table")]:::store
    H -- "declined, final receive" --> S["Mark the summary skipped"]:::system --> A
    H -- "failed, final receive" --> M["Persist the failed summary mark, then fail the record"]:::new --> A
    Q -- "out of receives" --> D[("generate-summary-dlq")]:::new
```

</details>

---

## 3. The alert and the redrive

The first message into an own dead-letter queue raises its alarm and emails the owner. Nothing reads the queue until the cause is fixed and the owner starts a redrive, which sends the message back to its source queue.

![The alert and the redrive](diagrams/alert-and-redrive.svg)

[BPMN image](diagrams-bpmn/alert-and-redrive.png) · [Editable BPMN](diagrams-bpmn/alert-and-redrive.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    D[("Own dead-letter queue, 14-day retention")]:::new --> AL["Queue alarm"]:::new --> T["Topic"]:::new --> EM["Email subscription"]:::new
    EM --> O["Owner fixes the cause"]:::policy --> RD["Console redrive"]:::policy --> Q[("Source queue")]:::queue --> H["Live handler"]:::system
```

</details>

---

## 4. What leaves the shared consumer

The four routes are shown amber because the next commit removes them. The router fails any record whose source has no route, so they stay until the shared queue reads empty in both accounts. The crawl routes and the email-filter route stay.

![What leaves the shared consumer](diagrams/shared-consumer.svg)

[BPMN image](diagrams-bpmn/shared-consumer.png) · [Editable BPMN](diagrams-bpmn/shared-consumer.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    O[("Crawl and filter source queues")]:::queue --> F[("save-link-failures-dlq")]:::dlq --> C["Shared consumer router"]:::system
    C --> K["Crawl routes and the email-filter route stay"]:::system
    C -.-> R1["select-most-complete-content route"]:::new
    C -.-> R2["reselect-after-removal route"]:::new
    C -.-> R3["recrawl-content-extracted route"]:::new
    C -.-> R4["generate-summary route"]:::new
```

</details>

---

## Command → System → Event(s) reference

| Trigger | System | Emits or writes | On failure |
|---|---|---|---|
| `TierContentExtractedEvent` | `select-most-complete-content` Lambda | Canonical content, article row, `GenerateSummaryCommand` | Failed crawl mark on receive 3, then `select-most-complete-content-dlq` |
| `ReselectAfterRemovalEvent` | `reselect-after-removal` Lambda | Canonical content, article row, `GenerateSummaryCommand` | Failed crawl mark on receive 3, then `reselect-after-removal-dlq` |
| `RecrawlContentExtractedEvent` | `recrawl-content-extracted` Lambda | Canonical content, article row, `GenerateSummaryCommand` | Failed crawl mark on receive 3, then `recrawl-content-extracted-dlq` |
| `GenerateSummaryCommand` | `generate-summary` Lambda | Summary on the article row | Failed summary mark on the final receive, then `generate-summary-dlq` |
| Message in an own dead-letter queue | Queue alarm, topic, email subscription | Email to the owner | The message waits up to 14 days for a redrive |
