# Newsletter Links Removal: links, issues and every readlist copy

Captured at commit `1903644` on branch `rp/adoring-pascal-to5b8f`. The removal now takes a chosen newsletter's links and its issues out of All and every readlist, hides each issue's email from the Inbox, and deletes what a removal left behind once its 30 days pass.

## Legend

Blue is a command, yellow is a system, orange is an event, purple is a policy, green is a store, gray is a queue, and pink is a dead-letter queue. Gold marks what this snapshot adds.

## Count, remove and restore

![Count, remove and restore](diagrams/remove-and-restore.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef cmd fill:#a6d8ff,stroke:#1e6fb8
    classDef sys fill:#fff2a8,stroke:#a08a00
    classDef evt fill:#ffb976,stroke:#a85800
    classDef policy fill:#d6b8ff,stroke:#6b3fb0
    classDef store fill:#b8e8c5,stroke:#2f7a45
    classDef queue fill:#e8e8e8,stroke:#666
    classDef dlq fill:#f8c8c8,stroke:#a83434
    classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px
    PAGE[Inbox: Newsletter Links Removal page]:::cmd --> COUNT[RunSavedLinksJobCommand count]:::cmd
    PAGE -->|popup confirmed| REMOVE[RunSavedLinksJobCommand remove]:::cmd
    PAGE -->|Restore removed links| RESTORE[RunSavedLinksJobCommand restore]:::cmd
    COUNT --> Q[user-data-jobs queue and Lambda]:::queue
    REMOVE --> Q
    RESTORE --> Q
    Q -->|12th receive| DLQ[user-data-jobs-dlq]:::dlq
    Q --> COUNTER[Count links, issues by sender and held rows]:::sys
    COUNTER --> JOBROW[Saved-links job row]:::store
    Q --> LINKS[Hold each chosen link with its readlist copies]:::sys
    LINKS --> ALL[All and readlist partitions]:::store
    LINKS --> HOLD[Removed-links hold partition]:::store
    LINKS --> ISSUES[Hold each chosen issue and mark its email]:::new
    ISSUES --> SCHEDULE[Create removed-issues schedule at run start plus 30 days and an hour]:::new
    ISSUES --> HOLD
    ISSUES --> EMAILS[Inbox email rows]:::store
    LINKS --> DEQ[LinkDequeued]:::evt
    Q --> BACK[Restore held links and issues to All and live readlists]:::sys
    BACK --> CLEAR[Clear the mark on each chosen email]:::new
    CLEAR --> EMAILS
    BACK --> QUEUED[LinkQueued]:::evt
    Q --> DONE[SavedLinksJobCompleted or SavedLinksJobFailed]:::evt
```

</details>

## Purge after 30 days

![Purge after 30 days](diagrams/purge.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef cmd fill:#a6d8ff,stroke:#1e6fb8
    classDef sys fill:#fff2a8,stroke:#a08a00
    classDef evt fill:#ffb976,stroke:#a85800
    classDef policy fill:#d6b8ff,stroke:#6b3fb0
    classDef store fill:#b8e8c5,stroke:#2f7a45
    classDef queue fill:#e8e8e8,stroke:#666
    classDef dlq fill:#f8c8c8,stroke:#a83434
    classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px
    SCHED[EventBridge Scheduler one-off]:::new --> PURGE[PurgeRemovedNewsletterIssuesCommand]:::new
    PURGE --> Q[user-data-jobs queue and Lambda]:::queue
    Q -->|12th receive| DLQ[user-data-jobs-dlq]:::dlq
    Q --> DUE{Email marked 30 days ago?}:::policy
    DUE -->|No| KEEP[Leave the email]:::store
    DUE -->|Yes| INALL{Issue back in All?}:::policy
    INALL -->|Yes| SHOW[Clear the mark]:::sys
    INALL -->|No| DELETE[Delete raw and rendered copies, images, link and identity rows, the issue content with a tombstone, then the email row]:::new
    SHOW --> EMAILS[Inbox email rows]:::store
    DELETE --> EMAILS
    DELETE --> S3[Raw-email and content buckets]:::store
    DELETE --> PURGED[RemovedNewsletterIssuesPurged]:::new
```

</details>

## Command → System → Event(s)

| Command | System | Event(s) | Next command(s) |
|---|---|---|---|
| `RunSavedLinksJobCommand` (count) | Saved-links job handler: counts links, issues by sender with read and highlighted skips, and held links and issues | `SavedLinksJobCompleted` or `SavedLinksJobFailed` | None |
| `RunSavedLinksJobCommand` (remove) | Holds chosen links with their readlist copies, then each chosen issue, and marks each chosen email removed | `LinkDequeued` per held row, `SavedLinksJobCompleted` or `SavedLinksJobFailed` | A scheduled `PurgeRemovedNewsletterIssuesCommand` |
| `RunSavedLinksJobCommand` (restore) | Restores held links and issues to All and each live readlist, then clears chosen emails' marks | `LinkQueued` per restored row, `SavedLinksJobCompleted` or `SavedLinksJobFailed` | None |
| `PurgeRemovedNewsletterIssuesCommand` | Purge handler: shows again an email whose issue is back in All; deletes everything stored for every other email marked 30 days ago | `RemovedNewsletterIssuesPurged` | None |
