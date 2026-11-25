# Automatically mark unread Gmail imports as read

Captured from the feature branch working tree over base commit `79e3a0c33`. The previous behavior is recorded in the [Gmail import labelling snapshot](../2026-10-27-b918eea/gmail-import-labelling.md).

## Legend

Blue is a command, yellow is a system, orange is an event, purple is a policy, green is a store, gray is a queue, and pink is a dead-letter queue. Amber outlines highlight changed behavior. Dashed outlines show retired wiring.

## Forwarded mail and explicit unread imports

![Gmail import paths](diagrams/import-paths.svg)

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
    FORWARD[SES receives a forwarded newsletter]:::evt --> RECEIVE[Inbox receive queue and Lambda]:::queue
    RECEIVE --> ROUTE{Active sender and destination?}:::policy
    ROUTE -->|No| HOLD[Hold or skip mail]:::store
    ROUTE -->|Yes| IDENTITY[Resolve inbox identity and record forwarded origin]:::sys
    CLICK[POST Import unread messages for one sender]:::cmd --> JOB[Create job with the selected destinations]:::store
    JOB --> READ{Read scope granted?}:::policy
    READ -->|No| WAIT[Awaiting permission]:::store
    READ -->|Yes| START[StartGmailHistoryImport]:::cmd
    WAIT -->|Google grants access| START
    START --> PAGES[History import queue and Lambda]:::queue
    PAGES -->|Page processed| PAGES
    PAGES -->|Retries exhausted| DLQ[Shared Gmail import DLQ]:::dlq
    PAGES -->|Unread within 30 days and sender matches| FETCH[GmailHistoryImportMessageFetched]:::evt
    FETCH --> INBOX[Inbox import queue and Lambda]:::queue
    INBOX -->|Verify current job, sender and destinations| IDENTITY
    INBOX --> OUTCOME[GmailHistoryImportMessageIngested]:::evt
    OUTCOME --> COUNTS[Outcome queue and Lambda settle the job counts]:::store
    IDENTITY --> NEW{Canonical inbox email exists?}:::policy
    NEW -->|Yes| DUP[Reuse one inbox email and add the job and Gmail message origin]:::new
    NEW -->|No| ACCEPT[EmailReceived]:::evt
    ACCEPT --> EXTRACT[Extract email output selection and dispatch saves]:::sys
    EXTRACT --> SELECTED[EmailOutputsSelected]:::evt
    EXTRACT --> SAVE[Save selected links, issue, or both in All and file into chosen readlists]:::sys
    SAVE --> SAVED[EmailOutputSavedToAll after durable save]:::evt
    SELECTED --> COMPLETION[Inbox completion queue and Lambda]:::queue
    SAVED --> COMPLETION
    COMPLETION --> ALL{Every selected output saved in All?}:::policy
    DUP --> ALL
    ALL -->|Yes| MARK[MarkGmailEmailImported per recorded origin]:::cmd
    ALL -->|Incomplete| STOP[Wait for remaining save facts]:::store
```

</details>

## Gmail updates and reconnect

![Gmail update and reconnect](diagrams/gmail-update.svg)

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
    classDef retired fill:#fff,stroke:#a83434,stroke-dasharray:5 4
    MARK[MarkGmailEmailImported]:::cmd --> BUS[EventBridge subscription]:::policy
    BUS --> QUEUE[Gmail message updates queue and Lambda]:::queue
    QUEUE --> MAPPED{Sender actively mapped to a destination?}:::new
    MAPPED -->|No| SKIP[Discard pending update and acknowledge]:::sys
    MAPPED -->|Yes| CLAIM[Lease pending update by origin, with job and message for explicit imports]:::new
    CLAIM -->|Already settled| ACK[Acknowledge without polling Gmail]:::sys
    CLAIM -->|Pending| GRANT{Connected account and modify grant verified?}:::policy
    GRANT -->|No| DEFER[GmailEmailUpdateDeferred, retain pending]:::evt
    GRANT -->|Yes| LOCATE[Locate by Gmail ID or verified forwarded Message-ID and sender]:::sys
    LOCATE -->|Missing or ambiguous| FAIL[GmailEmailUpdateFailed]:::evt
    LOCATE --> STATUS{Read current labels from the original}:::new
    STATUS -->|Already read| SETTLE[Settle without writing to Gmail]:::new
    STATUS -->|Unread| WRITE[Find or create label, then add it and remove UNREAD in one modify call]:::new
    WRITE --> EVENT[GmailEmailMarkedImported]:::evt
    QUEUE -->|Repeated failures| DLQ[Shared Gmail import DLQ settles pending failures]:::dlq
    CONNECT[Connect or reconnect Gmail from settings]:::cmd --> GOOGLE[Google OAuth requests gmail.modify]:::new
    GOOGLE -->|Granted and account matches| RESUME[GmailModifyPermissionGranted]:::evt
    GOOGLE -->|Narrower grant| LIMITED[Imports can continue with read access]:::new
    RESUME --> BUS
    QUEUE -->|Permission grant event| PENDING[Publish commands for pending updates on this account]:::sys
    PENDING --> MARK
    OLD[Retired historical marking worker, queue, rules and dedicated permissions]:::retired
    DLQ -.->|Already dead-lettered historical work| OLD
```

</details>

The worker checks an original again when reconnect resumes it. Gmail's modify request changes only the import label and UNREAD. Disconnect still deletes the reader's shared import partition, including pending updates and any historical worker rows. Removing the historical queue and subscriptions stops that work at rollout. The shared DLQ acknowledges old deliveries from that queue. Rollout does not scan Gmail.

## Command → system → event reference

| Command or input | System | Outcome and next step |
|---|---|---|
| Forwarded message | Inbox receive Lambda | Resolves the sender, destinations and email identity. Accepted mail emits `EmailReceived`. Duplicate input records its origin against the canonical email. |
| Import unread messages | Web route | Creates a sender-scoped history job. Read access publishes `StartGmailHistoryImport`. |
| `StartGmailHistoryImport` and page continuation | History import Lambda | Fetches unread messages in the job window, stages the raw mail and emits `GmailHistoryImportMessageFetched`. |
| `GmailHistoryImportMessageFetched` | Inbox import Lambda | Accepted mail emits `EmailReceived`. An existing email adds an explicit job and message origin. `GmailHistoryImportMessageIngested` settles the history job's message outcome. |
| `EmailReceived` | Inbox extract Lambda | Freezes selected outputs and emits `EmailOutputsSelected`. Dispatches `SubmitLink` and `SaveEmailIssue` as applicable. |
| `SubmitLink` and `SaveEmailIssue` | Save-link workers | Durable saves emit `EmailOutputSavedToAll`. |
| `EmailOutputsSelected`, `EmailOutputSavedToAll`, or duplicate Gmail origin | Inbox completion | Publishes `MarkGmailEmailImported` after the selected outputs are saved. |
| `MarkGmailEmailImported` | Gmail message update Lambda | Settles an already-read original silently. A successful Gmail write emits `GmailEmailMarkedImported`. Permission or account problems emit `GmailEmailUpdateDeferred`. Terminal failures emit `GmailEmailUpdateFailed`. |
| Google OAuth callback | Web route | Stores the grant and resumes eligible imports. A verified modify grant emits `GmailModifyPermissionGranted`. |
| `GmailModifyPermissionGranted` | Gmail message update Lambda | Reads pending updates for the granted account and republishes their `MarkGmailEmailImported` commands. |
| Disconnect Gmail | Filter rewrite Lambda | Revokes access and deletes the reader's shared import partition. |
