# The email filter gets its own dead-letter queue

Snapshot of the uncommitted working tree over `c8e198a68` (`main`), whose 2026-11-02 subject is **PLAN-3: readlist actions and the unlisted /developers page (#1250)**. Generated 2026-11-02.

A filter message that ran out of receives moved to the shared failures queue, and its consumer published the failure and deleted the message. There was nothing left to redrive once the cause was fixed. The queue and the triaged rule's target now dead-letter into `filter-email-links-dlq`, which nothing consumes, so a redrive can replace the failed decision.

- **Failed messages stay.** The handler already publishes the failed fact on the final receive, so nothing needs to consume the new queue. The message waits there to be redriven.
- **The rule's own failures move too.** The triaged rule's target pointed its dead-letter config at the same shared queue. It now points at the new one, which needs a queue policy that lets EventBridge send to it.
- **The shared consumer gets no new messages.** Its filter route stays until messages already in the shared queue drain. A later commit removes the route.
- **An alarm emails on the first dead letter.** The new queue has its own topic, email subscription and alarm.

Created in each account: the queue, topic, subscription, alarm and queue policy. Updated in place: the filter queue's redrive policy and the rule target's dead-letter config. No Lambda code changes.

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

The first failure retries. The second publishes the failed fact and fails the record, and the message moves to its own dead-letter queue. A delivery failure at the rule goes to the same queue, and the alarm emails on the first message.

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
    Q -- "out of receives" --> N[("filter-email-links-dlq")]:::new
    T -- "rule cannot deliver" --> N
    N --> A["filter-email-links-dlq-alarm, emails the topic"]:::new
```

</details>

---

## 2. Healing after the fix

Once the cause is fixed, someone reads the readlist's purpose and the account's write access, then redrives the message to the source queue. The handler decides again under today's purpose, and a decided result replaces the failed row.

![Healing after the fix](diagrams/filter-redrive.svg)

[BPMN image](diagrams-bpmn/filter-redrive.png) · [Editable BPMN](diagrams-bpmn/filter-redrive.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    N[("filter-email-links-dlq")]:::new -- "redrive" --> Q[("filter-email-links queue")]:::queue --> H["filter-email-links Lambda"]:::system
    H --> D(("EmailLinksFilteredEvent")):::event --> I["Inbox recorder"]:::system
    I --> W[("Email links table: readlist result row, failed replaced by decided")]:::store
    W --> P["Email page: the count line"]:::system
```

</details>

---

## Command → System → Event(s) reference

| Command or event | System | Emits | Triggers next |
|---|---|---|---|
| `EmailLinksTriagedEvent` | filter-email-links Lambda | `EmailLinksFilteredEvent`, or `EmailLinksFilterFailedEvent` on the final receive | `FileArticleIntoReadlistCommand` per kept link |
| Message out of receives | `filter-email-links-dlq` | none | `filter-email-links-dlq-alarm` |
| Delivery failure at the triaged rule | `filter-email-links-dlq` | none | `filter-email-links-dlq-alarm` |
| Redrive of a kept message | filter-email-links Lambda | `EmailLinksFilteredEvent` | A decided row, replacing the failed one |
