# The email filter marks a failed decision on its last receive

Snapshot of the uncommitted working tree over `c8d116bc3` (`main`), whose 2026-11-02 subject is **docs: say why a DeepSeek dead letter is kept and how to redrive it**. Generated 2026-11-02.

When the filter ran out of receives, the only thing that told the reader the decision had failed was the shared failures queue's consumer, which published the failure and deleted the message. The live handler now publishes the failure on its final receive, and a later decision can replace a failed result.

- **The final receive publishes the failure.** On the second receive the filter handler publishes `EmailLinksFilterFailedEvent` and still fails the record. It reads the ids from the record body loosely, so a record with a malformed ordinal still marks the decision failed.
- **Decided replaces failed.** The result row used to be write-once. A decided write may now replace a failed row, and any write over a decided row stays a duplicate that the recorder ignores.
- **The shared consumer is still a second publisher.** The filter queue still dead-letters into the shared failures queue until a later commit, so the same failure is published a second time. Writing failed over failed is harmless.

No queue, rule or Lambda configuration changes.

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

## 1. The filter's receives

The triage rule delivers each routed email to the filter queue. A decision files the kept links and announces the result. A failure on the first receive only retries. A failure on the second also publishes the failed fact, and the message then moves to the shared failures queue, whose consumer publishes the same fact again.

![The filter's receives](diagrams/filter-receives.svg)

[BPMN image](diagrams-bpmn/filter-receives.png) · [Editable BPMN](diagrams-bpmn/filter-receives.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    T(("EmailLinksTriagedEvent")):::event --> Q[("filter-email-links queue")]:::queue --> H["filter-email-links Lambda"]:::system
    H -- "decided" --> F["FileArticleIntoReadlistCommand, per kept link"]:::command
    H -- "decided" --> D(("EmailLinksFilteredEvent")):::event
    H -- "failed, receive 1" --> R["Fail the record so the queue retries"]:::system --> Q
    H -- "failed, receive 2" --> M["Publish the failed fact, then fail the record"]:::new
    M --> X(("EmailLinksFilterFailedEvent")):::event
    Q -- "out of receives" --> S[("save-link-failures-dlq")]:::dlq --> C["Shared failures consumer"]:::system --> X
```

</details>

---

## 2. The result row

The inbox recorder writes each fact to the email's result row for that readlist. A decided fact replaces a failed row, and a fact arriving after a decided one changes nothing.

![The result row](diagrams/result-row.svg)

[BPMN image](diagrams-bpmn/result-row.png) · [Editable BPMN](diagrams-bpmn/result-row.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    D(("EmailLinksFilteredEvent")):::event --> H["Inbox recorder"]:::system
    X(("EmailLinksFilterFailedEvent")):::event --> H
    H --> C{"Row absent or decision is failed"}:::new
    C -- "yes" --> W[("Email links table: readlist result row")]:::store
    C -- "no" --> K["Duplicate, ignored"]:::system
    W --> P["Email page: the count line, or the failed line"]:::system
```

</details>

---

## Command → System → Event(s) reference

| Command or event | System | Emits | Triggers next |
|---|---|---|---|
| `EmailLinksTriagedEvent` | filter-email-links Lambda | `EmailLinksFilteredEvent`, or `EmailLinksFilterFailedEvent` on the final receive | `FileArticleIntoReadlistCommand` per kept link |
| `EmailLinksFilterFailedEvent` | Inbox recorder | none | A failed row, unless a decided one exists |
| `EmailLinksFilteredEvent` | Inbox recorder | none | A decided row, replacing a failed one |
| Message out of receives | Shared failures consumer | `EmailLinksFilterFailedEvent` | The same failed write, harmless |
