# The shared failures consumer drops the email filter route

Snapshot of the uncommitted working tree over `c5f048768` (`main`), whose 2026-11-02 subject is **feat(save-link): give the email filter queue its own dead-letter queue**. Generated 2026-11-02.

Since the previous commit, the email filter queue and the triaged rule's target dead-letter into `filter-email-links-dlq`, so no new filter message reaches the shared failures queue. The shared queue read empty in both accounts. The shared consumer's filter route and its handler are deleted now, and the filter handler is the only publisher of the failed fact.

- **One publisher.** The filter handler publishes `EmailLinksFilterFailedEvent` on its final receive. Nothing else publishes it.
- **The other routes stay.** The shared consumer still routes every crawl and submit queue that dead-letters into it.
- **The queue name stays.** The source-queue table still names the filter queue, because every key in it is required.

Only the consumer Lambda's code changes.

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

## 1. Where a filter failure goes

The first failure retries. The second publishes the failed fact and fails the record, and the message moves to its own dead-letter queue, where it waits to be redriven. The shared failures consumer no longer has a filter route.

![Where a filter failure goes](diagrams/filter-failure-route.svg)

[BPMN image](diagrams-bpmn/filter-failure-route.png) · [Editable BPMN](diagrams-bpmn/filter-failure-route.bpmn)

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
    H -- "failed, receive 2" --> M["Publish the failed fact, then fail the record"]:::system
    M --> X(("EmailLinksFilterFailedEvent")):::event
    Q -- "out of receives" --> N[("filter-email-links-dlq")]:::dlq
    T -- "rule cannot deliver" --> N
    N --> A["filter-email-links-dlq-alarm"]:::system
    S[("save-link-failures-dlq")]:::dlq --> C["Shared failures consumer: crawl and submit routes only"]:::new
```

</details>

---

## Command → System → Event(s) reference

| Command or event | System | Emits | Triggers next |
|---|---|---|---|
| `EmailLinksTriagedEvent` | filter-email-links Lambda | `EmailLinksFilteredEvent`, or `EmailLinksFilterFailedEvent` on the final receive | `FileArticleIntoReadlistCommand` per kept link |
| Message out of receives | `filter-email-links-dlq` | none | `filter-email-links-dlq-alarm` |
| Message from a crawl or submit queue | Shared failures consumer | That queue's failure handling | Unchanged |
