# Remove newsletter links and Restore run as a saved-links job

Snapshot of commit `d0bdf3230` (`main`), whose 2026-11-20 subject is **feat: run Remove newsletter links and Restore as a saved-links job**. Generated 2026-11-20. The snapshot reads the code at that commit, not the working tree.

A reader's request to remove their unread newsletter links from All, or to bring them back, runs as one background job per reader. `RunSavedLinksJobCommand` (source `hutch.api`) carries the user id, the job id, the request time and the job: `remove` with a cutoff and the senders (`all` or `chosen` sender emails), or `restore` with the senders. EventBridge routes it, through the same rule as `DeleteAccountCommand` and `ExportUserDataCommand`, to the `user-data-jobs` queue (visibility 900 s, DLQ after 12 receives, email alarm), and the user-data-jobs Lambda dispatches it by detail type to the saved-links-job handler.

**No producer yet.** At this commit nothing publishes the command: a `git grep RunSavedLinksJobCommand` finds only the catalogue, the Pulumi subscription, the Lambda's composition root and the handler. The job-row store already offers `requestSavedLinksJob` (claims the row when none exists or the last job ended) and `withdrawSavedLinksJob` (drops a job still `requested`), but no web route calls them yet.

The handler:

1. **Reads the job row** (`readplace:saved-links-job/<userId>` in the reader's user-articles partition). A missing row, a row naming another job, or a `completed` job is stale: the message is acknowledged and nothing runs.
2. **Starts.** It records progress (state `running`, conditional on the same job id and not `completed`), seeding the count it keeps across receives (`held` for remove, `restored` for restore). A job whose state was not `requested` is a **resume**.
3. **Runs the action** in chunks of 10, recording progress on the row after each chunk. A progress write that finds the row moved on stops the run without finishing it.
4. **Finishes** the row `completed` with the counts and publishes `SavedLinksJobCompleted`.
5. **Fails.** Any error is rethrown so SQS redelivers. On the 12th receive the handler first finishes the row `failed` and, if that write landed, publishes `SavedLinksJobFailed`; the message then goes to the DLQ.

**Remove** moves each matching newsletter link out of All into a hold row in the reader's `<userId>#removed` partition, keyed by job id and a hash of the stored key, carrying `removedAt` and `expiresAt` (30 days later, epoch seconds). A link is chosen only when it came from email, matches the senders, was saved at or before the cutoff, is unread, was never hand-picked, viewed, opened as a summary, highlighted or opened in a readlist, was not restored after the cutoff, and is not a newsletter issue row. The move is a transaction (Put the hold row, Delete the All row under the same conditions), so a row that changed between read and write is counted `changed`. For each held link whose URL has no other copy among the reader's saves, it publishes `LinkDequeued`.

**Restore** reads the live hold rows, keeps those removed at or before the request time from the chosen senders (the earliest per link), and writes each back to All with `restoredAt` in a transaction (Put the All row only if absent, Delete the hold row). A link whose shared article was purged is `unrestorable`; one already in All is `already-in-all`. Each restored link publishes `LinkQueued`.

**Resume.** A receive that resumes a started job republishes the facts for the rows an earlier receive already moved, then carries on: remove republishes `LinkDequeued` for this job's hold rows (where no copy remains) and seeds `held` with their number; restore republishes `LinkQueued` for All rows restored since the request and seeds `restored`. A failed receive therefore loses no fact.

**Purge.** DynamoDB TTL on `expiresAt`, newly enabled on the user-articles table, deletes a hold row once its 30 days end. Readers of the hold partition also skip a row past its `expiresAt` before TTL catches up.

Pulumi: the user-data-jobs EventBridge rule gains `RunSavedLinksJobCommand`; the Lambda gains `PutItem` and `ConditionCheckItem` on user-articles; the queue's `maxReceiveCount` (12) now comes from a constant the handler shares. `SavedLinksJobCompleted` and `SavedLinksJobFailed` (source `hutch.saved-links-job`) have no subscriber yet. `LinkDequeued` already reaches the inbox `record-link-dequeued` consumer and, for private media items only, the `media-release` consumer; `LinkQueued` already reaches the inbox `record-link-queued` consumer.

---

## Legend

Gold with a thick border (`:::new`) marks what this commit adds or re-wires. Everything else is existing infrastructure shown for context.

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
    S["System / handler"]:::system
    E["Event"]:::event
    P["Policy / decision"]:::policy
    R[("Store")]:::store
    Q[["Queue"]]:::queue
    D[["DLQ"]]:::dlq
    N["New in this commit"]:::new
```

</details>

---

## End-to-end flow

![End-to-end flow](diagrams/end-to-end-flow.svg)

[BPMN image](diagrams-bpmn/end-to-end-flow.png) · [Editable BPMN](diagrams-bpmn/end-to-end-flow.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    NOPROD["No producer yet: no web route publishes the command at this commit"]:::policy
    CMD["RunSavedLinksJobCommand<br/>source hutch.api<br/>userId, jobId, requestedAt, job remove or restore"]:::new
    NOPROD -.-> CMD
    RULE["EventBridge rule user-data-jobs<br/>DeleteAccountCommand, ExportUserDataCommand,<br/>RunSavedLinksJobCommand"]:::new
    Q[["user-data-jobs queue<br/>visibility 900 s, batch 1"]]:::queue
    DLQ[["user-data-jobs-dlq<br/>maxReceiveCount 12, email alarm"]]:::dlq
    L["user-data-jobs Lambda<br/>handle by detail type"]:::system
    H["saved-links-job handler"]:::new
    JOB[("job row in user-articles<br/>readplace:saved-links-job/userId<br/>state, counts, finishedAt")]:::store

    CMD --> RULE --> Q --> L --> H
    Q -. "12th receive fails" .-> DLQ
    H --> FIND{"job row names this job<br/>and is not completed?"}:::policy
    FIND -- "no" --> ACK["acknowledge, log stale job"]:::policy
    FIND -- "yes" --> START["record progress: state running<br/>seed held or restored count<br/>resumed when state was not requested"]:::new
    JOB <--> FIND
    START --> JOB
    START --> ACT{"job.action"}:::policy
    ACT -- "remove" --> REM["remove runner"]:::new
    ACT -- "restore" --> RES["restore runner"]:::new
    REM -- "progress per chunk of 10" --> JOB
    RES -- "progress per chunk of 10" --> JOB
    REM -.-> LDQ["LinkDequeued"]:::event
    RES -.-> LQ["LinkQueued"]:::event
    REM --> FIN["finish row completed with counts"]:::new
    RES --> FIN
    FIN --> JOB
    FIN --> DONE["SavedLinksJobCompleted<br/>source hutch.saved-links-job<br/>no subscriber yet"]:::new
    H -. "error: rethrow, SQS redelivers" .-> Q
    H -. "error on receive 12" .-> FAIL["finish row failed"]:::new
    FAIL --> JOB
    FAIL --> FAILED["SavedLinksJobFailed<br/>no subscriber yet"]:::new
    LDQ --> IDQ["inbox record-link-dequeued"]:::system
    LDQ -. "private media item URLs only" .-> MR["media-release"]:::system
    LQ --> IQ["inbox record-link-queued"]:::system
```

</details>

---

## Remove action

![Remove action](diagrams/remove-action.svg)

[BPMN image](diagrams-bpmn/remove-action.png) · [Editable BPMN](diagrams-bpmn/remove-action.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    REM["remove runner<br/>cutoff, senders"]:::new
    ALL[("user-articles: reader's All partition")]:::store
    HOLD[("user-articles: userId#removed partition<br/>hold row: removedUrl, removedByJobId,<br/>removedAt, expiresAt = removedAt + 30 days")]:::new
    HL[("highlights")]:::store
    ART[("articles table: originalUrl, purgedAt")]:::store

    REM --> OPENED["list keys opened in readlists"]:::system
    OPENED --> ALL
    REM --> PAGE["for each removal-candidate page"]:::system
    PAGE --> ALL
    PAGE --> HLS["list the reader's highlights"]:::system
    HLS --> HL
    PAGE --> SEL{"select page:<br/>email provenance, chosen sender,<br/>saved at or before cutoff, unread,<br/>not hand-picked, viewed, summary-opened,<br/>highlighted, opened in a readlist,<br/>not restored after cutoff, not an issue row"}:::policy
    SEL -- "skip: read, opened, highlighted, unreadable" --> CNT["count skip reason"]:::policy
    SEL -- "selected, chunks of 10" --> MOVE["move newsletter link to hold<br/>consistent read, then transaction:<br/>Put hold row + Delete All row under the same conditions"]:::new
    MOVE --> ALL
    MOVE --> HOLD
    MOVE -- "transaction cancelled, row now holdable" --> CHG["count changed"]:::policy
    MOVE -- "held" --> ORIG["find original URLs"]:::system
    ORIG --> ART
    ORIG --> SAVES{"reader still saves<br/>this URL elsewhere?"}:::policy
    SAVES -- "no copy remains" --> LDQ["LinkDequeued<br/>url, userId"]:::event
    SAVES -- "a copy remains" --> NOEV["no event"]:::policy
    MOVE --> PROG["record progress on job row"]:::new
    PROG -- "stale: row moved on" --> STOP["stop, do not finish"]:::policy
    TTL["DynamoDB TTL on expiresAt<br/>purges the hold row after 30 days"]:::new
    HOLD --> TTL
```

</details>

---

## Restore action

![Restore action](diagrams/restore-action.svg)

[BPMN image](diagrams-bpmn/restore-action.png) · [Editable BPMN](diagrams-bpmn/restore-action.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    RES["restore runner<br/>requestedAt, senders"]:::new
    HOLD[("user-articles: userId#removed partition")]:::store
    ALL[("user-articles: reader's All partition")]:::store
    ART[("articles table: originalUrl, purgedAt")]:::store

    RES --> PAGES["read every hold-row page"]:::system
    PAGES --> HOLD
    PAGES --> SEL{"select: hold still live,<br/>removed at or before requestedAt,<br/>chosen sender, earliest per link"}:::policy
    SEL -- "chunks of 10" --> REST["restore held link"]:::new
    REST --> GET{"hold row still there?"}:::policy
    GET -- "no" --> GONE["gone, not counted"]:::policy
    GET -- "yes" --> PURGED{"shared article purged?"}:::policy
    PURGED -- "yes" --> UNR["count unrestorable"]:::policy
    PURGED -- "no" --> TX["transaction:<br/>Put All row with restoredAt, only if absent<br/>+ Delete hold row, only if present"]:::new
    TX --> ALL
    TX --> HOLD
    TX -- "Put refused" --> AIA["count already-in-all"]:::policy
    TX -- "Delete refused" --> GONE
    TX -- "restored" --> ORIG["find original URLs"]:::system
    ORIG --> ART
    ORIG --> LQ["LinkQueued<br/>url, userId"]:::event
    REST --> PROG["record progress on job row"]:::new
    PROG -- "stale: row moved on" --> STOP["stop, do not finish"]:::policy
```

</details>

---

## Resume and failure

![Resume and failure](diagrams/resume-and-failure.svg)

[BPMN image](diagrams-bpmn/resume-and-failure.png) · [Editable BPMN](diagrams-bpmn/resume-and-failure.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    Q[["user-data-jobs queue"]]:::queue
    DLQ[["user-data-jobs-dlq"]]:::dlq
    H["saved-links-job handler<br/>receive N"]:::new
    HOLD[("userId#removed partition")]:::store
    ALL[("reader's All partition")]:::store
    JOB[("job row")]:::store

    Q --> H
    H --> ST{"job row state"}:::policy
    ST -- "requested" --> FRESH["fresh run, counts start empty"]:::policy
    ST -- "running or failed" --> RESUME{"resume: which action?"}:::new
    ST -- "missing, other job, completed" --> ACK["acknowledge"]:::policy
    RESUME -- "remove" --> RH["scan hold rows of this jobId<br/>republish LinkDequeued where no copy remains<br/>seed held with their number"]:::new
    RESUME -- "restore" --> RR["scan All rows restored since requestedAt<br/>republish LinkQueued<br/>seed restored with their number"]:::new
    RH --> HOLD
    RR --> ALL
    RH -.-> LDQ["LinkDequeued"]:::event
    RR -.-> LQ["LinkQueued"]:::event
    RH --> CONT["carry on with the remaining links"]:::system
    RR --> CONT
    FRESH --> CONT
    CONT --> OK["finish completed"]:::new
    OK --> JOB
    OK --> DONE["SavedLinksJobCompleted"]:::new
    CONT -- "error" --> RC{"receiveCount at least 12?"}:::policy
    RC -- "no" --> RETHROW["rethrow, redelivered after visibility"]:::policy
    RETHROW --> Q
    RC -- "yes" --> FF["finish failed with counts so far<br/>only if the row is not completed"]:::new
    FF --> JOB
    FF -- "recorded" --> FAILED["SavedLinksJobFailed"]:::new
    FF --> RETHROW2["rethrow"]:::policy
    RETHROW2 --> DLQ
```

</details>

---

## Command → System → Event(s) reference

| Command / event | Handled by | Emits | Triggers next |
|---|---|---|---|
| `RunSavedLinksJobCommand` (new, `hutch.api`) | EventBridge rule `user-data-jobs` → `user-data-jobs` queue (DLQ after 12 receives) → user-data-jobs Lambda → saved-links-job handler | `LinkDequeued` (remove, per held link with no remaining copy), `LinkQueued` (restore, per restored link), then `SavedLinksJobCompleted`, or `SavedLinksJobFailed` on the 12th receive | No producer yet at this commit |
| `LinkDequeued` (existing) | inbox `record-link-dequeued`; `media-release` for private media item URLs only | — | Inbox records the link left All; media release frees a private item's media |
| `LinkQueued` (existing) | inbox `record-link-queued` | — | Inbox records the link is back in All |
| `SavedLinksJobCompleted` (new, `hutch.saved-links-job`) | No subscriber | — | — |
| `SavedLinksJobFailed` (new, `hutch.saved-links-job`) | No subscriber | — | — |
| Hold row TTL (`expiresAt`, new) | DynamoDB TTL on the user-articles table | — | Hold row deleted after 30 days |

| Store write | Where | Condition |
|---|---|---|
| Job progress (`running`, counts) | Job row in the reader's user-articles partition | Same job id and not `completed` |
| Job finish (`completed` or `failed`, counts, `finishedAt`) | Job row | Same job id and not `completed` |
| Move to hold | Put hold row in `<userId>#removed`, Delete All row | Delete conditional on the row still matching the remove rules and the same `savedAt` |
| Restore | Put All row with `restoredAt`, Delete hold row | Put only if the All row is absent; Delete only if the hold row exists |
