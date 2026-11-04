# A private item is released when its owner dequeues it

Snapshot of the uncommitted working tree over `1088d9c6a` (`main`), whose 2026-11-05 subject is **feat(hutch): withhold a private item on /view and its polls**. Generated 2026-11-05.

`LinkDequeuedEvent` gains its second subscriber. A reader who removes a link from their last readlist still publishes the same fact, and the inbox still retracts its "saved" mark for every URL. A new rule passes only private item URLs (the reserved upload host) to a new `media-release` queue and Lambda, which releases the item when the reader who dequeued it is its owner:

- **Owner check.** The Lambda reads the article row's owner. Another reader holding the URL changes nothing. A row that is already gone lets every step run, so a retry after a partial release finishes the job.
- **Release steps, in order.** Purge the item's stored content, delete the staged original under `pending/<uploadId>/original` in the media bucket, delete the article row, then delete every user-article link for the URL, in the default and readlist partitions.
- **Failure.** A step that throws fails the record; the queue retries it and then dead-letters it, and the DLQ alarm emails the alert address.

The hutch stack now names the media bucket in its configuration, and the Lambda's grants cover deleting only under that bucket's `pending/` prefix.

---

## Legend

Amber marks what this change adds. Everything else is existing infrastructure shown for context.

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
    P{{"Policy / reaction"}}:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    N["Added by this change"]:::new
```

</details>

---

## Every LinkDequeued flow

The readlist delete publishes the fact once the reader's last save of the URL is gone. The bus carries it to two rules: `inbox-record-link-dequeued` with no filter, and the new `hutch-media-release`, filtered to URLs starting `https://uploads.readplace.invalid/`.

![Every LinkDequeued flow](diagrams/link-dequeued-fan-out.svg)

[BPMN image](diagrams-bpmn/link-dequeued-fan-out.png) · [Editable BPMN](diagrams-bpmn/link-dequeued-fan-out.bpmn)

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

    U["Reader deletes an item from a readlist"]:::command --> W["Readlist delete: drop the reader's row"]:::system
    W --> P{{"Any other save of this URL by the reader?"}}:::policy
    P -- "yes" --> X["No event"]:::system
    P -- "no" --> E(("LinkDequeuedEvent: url, userId")):::event
    E --> B["Shared event bus"]:::system
    B -- "every URL" --> IQ[("inbox-record-link-dequeued queue")]:::queue
    IQ --> IL["Inbox record-link Lambda: retract the saved mark"]:::system
    IL --> IS[("Inbox email links")]:::store
    IQ -. "exhausted" .-> IDLQ[("inbox-record-link-dequeued DLQ")]:::dlq
    B -- "private item host only" --> MQ[("media-release queue")]:::new
    MQ --> ML["media-release Lambda"]:::new
    MQ -. "exhausted" .-> MDLQ[("media-release DLQ + alarm email")]:::new
```

</details>

---

## Releasing the private item

![Releasing the private item](diagrams/media-release-handler.svg)

[BPMN image](diagrams-bpmn/media-release-handler.png) · [Editable BPMN](diagrams-bpmn/media-release-handler.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    E(("LinkDequeuedEvent for a private item URL")):::event --> L["media-release Lambda: parse the detail"]:::new
    L --> O[("Articles table: read the row's owner")]:::store
    O --> P{{"Owner is another reader?"}}:::new
    P -- "yes" --> N["not-owner: nothing deleted, logged"]:::new
    P -- "no, or the row is gone" --> S1["1. Purge the item's stored content"]:::new
    S1 --> C[("Content bucket: content/ objects")]:::store
    S1 --> S2["2. Delete the staged original"]:::new
    S2 --> M[("Media bucket: pending/uploadId/original")]:::store
    S2 --> S3["3. Delete the article row"]:::new
    S3 --> A[("Articles table")]:::store
    S3 --> S4["4. Delete every user-article link for the URL"]:::new
    S4 --> UA[("User-articles table, url index, default and readlist rows")]:::store
    S4 --> R["released, logged"]:::new
    S1 & S2 & S3 & S4 -. "throws" .-> F["Record fails: SQS retries, then dead-letters"]:::queue
```

</details>

---

## Command → System → Event(s) reference

| Command or event | Detail | System | Emits | Triggers next |
|---|---|---|---|---|
| Reader deletes an item from a readlist | readlist, article id | hutch readlist delete | `LinkDequeuedEvent` when no other save of the URL by that reader remains | both rules below |
| `LinkDequeuedEvent` (rule `inbox-record-link-dequeued`) | `url`, `userId` | inbox record-link Lambda | nothing | retracts the link's saved mark in the inbox |
| `LinkDequeuedEvent` (rule `hutch-media-release`, new) | `url` with the private item host prefix, `userId` | `media-release` Lambda (new) | nothing | owner: purge content, delete the staged original, the article row and every user-article link; another reader: nothing |
