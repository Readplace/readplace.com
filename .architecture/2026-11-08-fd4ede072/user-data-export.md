# An export job is safe to redrive from user-data-jobs-dlq

Snapshot of the uncommitted working tree over `fd4ede072` (`main`), whose 2026-11-08 subject is **fix(hutch,@packages/inbox-store): abandon a stored Gmail notice email that can no longer be sent**. Generated 2026-11-08. The export gates, the delivery marker and the new skipped event are uncommitted and not deployed.

A signed-in reader posts `/export/start`. The web route publishes `ExportUserDataCommand` carrying only `userId` and `requestedAt`; the address no longer travels on the message. The account page's delete card publishes `DeleteAccountCommand` after marking the users row `deletedAt`. Both commands route by detail type into the one `user-data-jobs-q` queue (batch size 1, twelve receives, then `user-data-jobs-dlq`), and the user-data-jobs Lambda dispatches each to its handler. A redrive moves both kinds together and in no order.

- **New: gate 1.** Before reading any article, the export handler reads the export recipient: a `userId-index` query for the address, then a consistent `GetItem` on the users row by `email`. A missing row, or a row whose `userId` differs (the address was reclaimed), is **account-gone**; a row with `deletedAt` is **account-deleting**; a row whose `exportDeliveredRequestedAt` is at or after the message's `requestedAt` is **already-delivered**. Otherwise the export is built and uploaded under `exports/<userId>/` as before.
- **New: gate 2.** After the upload, the handler reads and decides again. A delete that started during the build is caught here, and S3's strongly consistent listing means a delete that starts later finds the object.
- **New: finishing as refused.** For account-gone and account-deleting the handler removes every object under the user's export prefix, including one left by an earlier crashed attempt, then publishes `UserDataExportSkipped`. For already-delivered it only publishes, so the link already mailed keeps working. Every refusal logs `[ExportUserData] export skipped` with `userId` and `reason`.
- **Changed: the send.** The link goes to the address gate 2 read from the live row, and the sent-email log line no longer carries the recipient. After the send, a conditional update sets `exportDeliveredRequestedAt` only when the row still exists, belongs to the same user and holds no newer marker; a refused condition counts as success. Then `UserDataExported` is published as before.
- **`DeleteAccountCommand` is unchanged.** It stays idempotent and heals on redrive.
- **Dead letters.** A repeating fault (a missing article row, a rejected send) still fails the record and leaves one unused object per attempt for the bucket's seven-day lifecycle rule. Once the cause is fixed, a redrive delivers once; a redrive after the account is gone or being deleted removes the leftover object and mails nobody.

No Pulumi change: the Lambda already had `GetItem`, `Query` and `UpdateItem` on the users table, `DeleteObject` and `ListBucket` on the export bucket, and `PutEvents` on the bus. `UserDataExportSkipped` has no subscriber.

---

## Legend

Thick green marks what the uncommitted change adds or changes. Everything else is existing infrastructure shown for context.

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
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P{"Policy / decision"}:::policy
    R[("Read model / store")]:::store
    Q[["Queue"]]:::queue
    D[["DLQ"]]:::dlq
    N{"Added by this change"}:::new
```

</details>

---

## Export and delete on the shared queue

![Export and delete on the shared queue](diagrams/export-delete-flow.svg)

[BPMN image](diagrams-bpmn/export-delete-flow.png) · [Editable BPMN](diagrams-bpmn/export-delete-flow.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    ExportRoute["POST /export/start"]:::system
    DeleteRoute["POST account delete"]:::system
    MarkDeleted[("users row: deletedAt set")]:::store
    ExportCmd["ExportUserDataCommand<br/>userId, requestedAt<br/>(email removed)"]:::new
    DeleteCmd["DeleteAccountCommand<br/>userId"]:::command
    Bus[["EventBridge bus<br/>detail-type rules"]]:::queue
    JobsQ[["user-data-jobs-q<br/>batch 1, 12 receives"]]:::queue
    JobsDlq[["user-data-jobs-dlq"]]:::dlq
    Lambda["user-data-jobs Lambda<br/>dispatch by detail type"]:::system
    ExportHandler["export handler<br/>gate 1, build, upload, gate 2,<br/>send, mark"]:::new
    DeleteHandler["delete-account handler<br/>idempotent, unchanged"]:::system
    Users[("users table<br/>exportDeliveredRequestedAt")]:::new
    Bucket[("export bucket<br/>exports/userId/")]:::store
    Resend["Resend: export link<br/>to the live row's address"]:::new
    Exported(("UserDataExported")):::event
    Skipped(("UserDataExportSkipped<br/>account-gone, account-deleting,<br/>already-delivered")):::new

    ExportRoute --> ExportCmd
    DeleteRoute --> MarkDeleted --> DeleteCmd
    ExportCmd --> Bus
    DeleteCmd --> Bus
    Bus --> JobsQ --> Lambda
    JobsQ -. after 12 receives .-> JobsDlq
    JobsDlq -. redrive, any order .-> JobsQ
    Lambda --> ExportHandler
    Lambda --> DeleteHandler
    ExportHandler -- consistent read, conditional mark --> Users
    ExportHandler -- upload, or delete prefix when refused --> Bucket
    ExportHandler --> Resend
    ExportHandler --> Exported
    ExportHandler --> Skipped
    DeleteHandler -- close row --> Users
    DeleteHandler -- delete prefix --> Bucket
```

</details>

---

## The export handler's gates

![The export handler's gates](diagrams/export-gates.svg)

[BPMN image](diagrams-bpmn/export-gates.png) · [Editable BPMN](diagrams-bpmn/export-gates.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    Cmd["ExportUserDataCommand"]:::command
    Read1[("findExportRecipient<br/>index query + consistent GetItem")]:::new
    Gate1{"gate 1: decide delivery"}:::new
    Build["read articles, readlists, engagement;<br/>upload JSON"]:::system
    Read2[("findExportRecipient again")]:::new
    Gate2{"gate 2: decide delivery"}:::new
    Send["sendEmail to the decided address"]:::new
    Mark[("markExportDelivered<br/>conditional on same user<br/>and an older marker")]:::new
    Exported(("UserDataExported")):::event
    Refused{"reason"}:::new
    Purge[("deleteUserExports(userId)")]:::new
    Skipped(("UserDataExportSkipped")):::new

    Cmd --> Read1 --> Gate1
    Gate1 -- deliver --> Build --> Read2 --> Gate2
    Gate2 -- deliver --> Send --> Mark --> Exported
    Gate1 -- refused --> Refused
    Gate2 -- refused --> Refused
    Refused -- account-gone or account-deleting --> Purge --> Skipped
    Refused -- already-delivered --> Skipped
```

</details>

---

## Command → System → Event(s) reference

| Command / event | System | Emits | Triggers next |
|---|---|---|---|
| `ExportUserDataCommand` (`userId`, `requestedAt`; `email` removed, still stripped if an old message carries it) | user-data-jobs Lambda, export handler, via `user-data-jobs-q` | `UserDataExported` or **`UserDataExportSkipped`** | Nothing: neither event has a subscriber |
| `DeleteAccountCommand` (`userId`) | user-data-jobs Lambda, delete-account handler, via `user-data-jobs-q` | Unchanged | Unchanged |
| `UserDataExported` (`userId`, `articleCount`, `s3Key`, `exportedAt`) | Published after the send and the delivery marker | — | — |
| **`UserDataExportSkipped`** (`userId`, `requestedAt`, `reason`: `account-gone`, `account-deleting`, `already-delivered`) | Published when gate 1 or gate 2 refuses | — | — |
