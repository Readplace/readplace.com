# GMail Newsletters to readlists

Base commit: `014108f92`, 2026-09-29, `main` — `feat: route inboxes to readlists and filter newsletter links (#1167)`.

Generated 2026-09-30 from the dirty working tree. Everything this snapshot marks as new is uncommitted on top of that base commit; the snapshot pins to that uncommitted change, not to the base commit's code.

A reader who connected Gmail picks a newsletter sender and a readlist. The sender is forwarded through the reader's single Gmail filter to the reader's gateway address, and on receipt it is routed to a hidden per-readlist address, so its links land in the chosen readlist ("All" is a readlist address too). A shared, admin-moderated newsletter catalog recognises known newsletters in the picker, and readers' unrecognised choices are submitted to it as pending suggestions. The reader can also import the sender's unread messages from the last 30 days: a self-looping import Lambda lists and fetches them with a read-only Gmail token, the inbox stack ingests each one through the same storage and link-extraction path as forwarded mail, and a per-message identity claim makes a forwarded copy and an imported copy of the same message converge on one stored email. Gold marks this snapshot's new behaviour; the other colours keep the shared event-storming roles.

## Legend

![Legend](diagrams/legend.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
  C["Command"]:::command --> S["System"]:::system --> E["Event"]:::event --> P["Policy"]:::policy
  D[("Store")]:::store
  Q[("Queue")]:::queue
  F[("Dead letter")]:::dlq
  N["New behaviour"]:::new
  classDef command fill:#a6d8ff,stroke:#1e6fb8;
  classDef system fill:#fff2a8,stroke:#a08a00;
  classDef event fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;
```

</details>

## Mapping a newsletter to a readlist

The Gmail integration page offers two pickers: a sender picker and a readlist picker. With an empty search the sender picker lists only discovered senders the catalog recognises as approved newsletters; a typed search or advanced mode covers every discovered sender, and recognition runs before the 100-result limit. When the catalog cannot be read, the picker says so and still allows search. The readlist picker lists the reader's readlists plus All, and a reader can create a readlist inline, which reuses an existing readlist of the same name and never saves a mapping on its own.

Saving a mapping resolves the readlist to its hidden `gmail-readlist` address through get-or-create. A claim item in the addresses table, keyed by user and readlist slug, makes the allocation idempotent: a consistent read of the claim returns the existing address, otherwise a new address is minted and the claim is conditionally written, and the loser of a concurrent race disables its minted address and returns the winner. The sender row is pointed at that address and added to the filter, the existing filter-rewrite command is published with reason `sender-added`, and a sender that is not recognised as approved (including when the catalog is unavailable) is submitted to the catalog. Remapping a sender cancels its unfinished imports with `destination-changed`. Readlist addresses are uncapped and hidden from inbox management, so the address cap and the `/inbox` address list count only reader-named aliases.

Removing a mapping publishes `sender-removed` and cancels that sender's imports with `mapping-removed`. Deleting a readlist runs a new decorator before the existing inbox-unrouting decorator: it finds the readlist's address through the claim, moves every sender mapped to it onto All (allocating All only if needed), cancels those senders' imports, publishes the filter-rewrite command with reason `readlist-deleted` so the moved mappings read as live once Gmail records the unchanged filter, then disables the address and deletes its claim. Legacy mappings to named `gmail-mapped` inboxes keep working and are shown as such; remapping one leaves the named inbox untouched.

![Mapping and readlist addresses](diagrams/mapping-and-readlist-addresses.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  P["Reader opens the Gmail integration page"]:::system --> DN["Detect newsletters: catalog detector, approved records only"]:::new
  CAT[("Newsletter catalog S3 document, ETag-revalidated cache")]:::store -.-> DN
  DN --> PK["Sender picker: approved newsletters by default, any discovered sender on search or advanced"]:::new
  PK --> RL["Readlist picker: reader readlists plus All"]:::new
  RL -->|"create readlist inline"| RC["POST readlists/create: upsert by name, reuse, reserved, invalid or limit outcome"]:::new
  RC --> RL
  RL --> SAVE["POST senders/add with sender, readlist and import choice"]:::command
  SAVE --> MAP["Map sender to readlist"]:::new
  MAP --> GOC["Get-or-create readlist address through claim"]:::new
  GOC -.-> ADDR[("Inbox addresses: gmail-readlist rows plus claim items")]:::store
  MAP -.-> SND[("Gmail senders: mappedAddress, addedToFilterAt")]:::store
  MAP -->|"remapped to another address"| CX["Cancel sender's unfinished imports: destination-changed"]:::new
  CX -.-> IMP[("Gmail history imports")]:::store
  SAVE --> RW["RewriteGmailFilterCommand reason sender-added"]:::command
  SAVE -->|"not recognised as approved"| SUB["SubmitNewsletterSenderCommand"]:::new
  SAVE -->|"new mapping with import ticked"| IS["Start unread import"]:::new
  REM["POST senders/remove"]:::command --> RW2["RewriteGmailFilterCommand reason sender-removed"]:::command
  REM --> CX2["Cancel sender's unfinished imports: mapping-removed"]:::new
  CX2 -.-> IMP
  DEL["Reader deletes a readlist"]:::command --> MV["Move Gmail mappings on readlist delete"]:::new
  MV -->|"claim found"| TOALL["Remap senders to All address, cancel their imports: destination-changed"]:::new
  TOALL -.-> SND
  TOALL --> RW3["RewriteGmailFilterCommand reason readlist-deleted"]:::new
  MV --> RET["Retire readlist address: disable row, delete claim"]:::new
  RET -.-> ADDR
  MV --> UNR["Existing: unroute named inboxes, then delete readlist definition"]:::system
  classDef command fill:#a6d8ff,stroke:#1e6fb8;
  classDef system fill:#fff2a8,stroke:#a08a00;
  classDef event fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;
```

</details>

## Newsletter catalog: suggestions and moderation

The catalog is one JSON document in a new private bucket. Every read sends `IfNoneMatch` with the cached ETag and reuses the parsed document on 304; a missing object reads as an empty catalog; any other failure reads as unavailable. Every write is conditional (`IfNoneMatch: *` for the first write, `IfMatch` afterwards) and a 409 or 412 is a conflict. Every change goes through one update loop that re-reads and re-applies the pure moderation rule on conflict, up to three attempts.

A reader's submission is a command. The suggestions Lambda merges the sender as a `pending` record only when it is absent: it never renames an approved record and never reopens a rejected one. It publishes `NewsletterSenderSubmitted` with `created-pending` or `already-present` on every success. A catalog that stays unavailable fails the record into the Lambda's own DLQ, whose backlog alarm pages the operator; the reader's mapping already works without the catalog.

Admins moderate at `/admin/newsletters`, behind the shared admin gate. The page lists records by status tab with search and pagination, and every action is a form that redirects on success: create (always pending, with evidence), edit, approve, reject, withdraw (approved to rejected), reconsider (rejected to pending), correct the FROM address (the new address becomes pending and the old record is rejected with `replacedBy`), and import the committed seed (idempotent; it never replaces an existing record). Stale edits, invalid transitions and conflicts return 409 with the attempted values; an unavailable catalog returns 503.

![Newsletter catalog](diagrams/newsletter-catalog.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  SUB["SubmitNewsletterSenderCommand"]:::new --> BUS["EventBridge rule hutch-submit-newsletter-sender"]:::system
  BUS --> Q[("newsletter-catalog-suggestions SQS")]:::queue
  Q --> W["Suggestions Lambda: merge submitted sender as pending only when absent"]:::new
  W --> UPD["Update catalog: read, apply rule, conditional write, rebase on conflict up to 3 attempts"]:::new
  UPD <-.-> CAT[("Newsletter catalog bucket, one JSON document")]:::new
  UPD -->|"ok"| EV["NewsletterSenderSubmittedEvent: created-pending or already-present"]:::new
  UPD -->|"unavailable"| Q
  Q -->|"receives exhausted"| DLQ[("Suggestions DLQ and backlog alarm")]:::dlq
  ADM["Admin form: create, edit, approve, reject, withdraw, reconsider, correct FROM, import seed"]:::new --> GATE["Admin gate"]:::policy
  GATE --> UPD2["Update catalog with the moderation rule"]:::new
  UPD2 <-.-> CAT
  UPD2 -->|"ok"| PRG["303 back to the list with notice"]:::system
  UPD2 -->|"stale, invalid transition or conflict"| R409["409 with attempted values and current record"]:::policy
  UPD2 -->|"unavailable"| R503["503 storage alert"]:::policy
  SEED[("Committed seed file")]:::store -.-> UPD2
  CAT -.-> DET["Picker detector reads approved records"]:::new
  classDef command fill:#a6d8ff,stroke:#1e6fb8;
  classDef system fill:#fff2a8,stroke:#a08a00;
  classDef event fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;
```

</details>

## Import orchestration

An import is a job row per sender. Starting one requires the connection to know its Gmail account; only one unfinished job per sender is allowed. The job is created `awaiting-permission`. When the stored grant already includes `gmail.readonly`, the web starts it straight away; otherwise the page shows a consent row whose form sends the reader through Google with `include_granted_scopes=true` and a signed import intent. On return, the OAuth callback resumes every job awaiting permission and restarts the intent sender's latest failed or partly failed job when it still follows the current mapping. A Google refusal or a grant still missing read access redirects with `import_permission_refused`, back to the picker state the reader left.

Starting a job (`startJob`) moves it to `queued` with a new generation, fixes the 30-day window the first time only, and on a retry rebuilds `listed` from the settled counts. The Start command carries that generation. The import Lambda runs page 0 in process; later pages loop through the same queue the way discovery does: every invocation ends in `PageProcessed`, whose progress branch dispatches the next page command directly to the Lambda's own queue with a 10-second delay. The Lambda is provisioned with recursive-loop detection set to Allow. Termination rests on the page token running out, the generation fence, the page claim, and the DLQ route that fails the job.

Each page re-checks that the connection still has the job's gateway and account (case-insensitive) with no disconnect requested, and that the sender still maps to the job's destination; a mismatch cancels the job. It then claims the page (a 60-second lease), lists unread messages from the sender in the window with a read-only token, and fetches each one as RAW. Mail that is gone or has moved to spam or trash is skipped. Each message's raw bytes go to the inbox raw-email bucket under a `gmail-import/` prefix, a message row is recorded (which adds to `listed` only for a message not yet counted), and its `MessageFetched` event is published before the page is saved. A redelivered page that was already saved republishes its progress, or completes the job when listing had finished. `reauth-required` marks the current connection revoked and fails the job as `permission-revoked`; missing read-only scope also fails it as `permission-revoked`; a Gmail rejection fails it as `gmail-rejected`; an unavailable Gmail throws for an SQS retry. Five exhausted receives dead-letter into a shared DLQ whose router fails the run the record belongs to as `dead-lettered`, fenced on that run's generation; a progress record with no next page names no run left to fail and is dropped.

![Import orchestration](diagrams/import-orchestration.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  ST["Start import from save, import button or retry"]:::new --> CJ["Create job awaiting-permission"]:::new
  CJ -.-> IMP[("Gmail history imports: JOB and MSG rows")]:::new
  CJ -->|"read-only scope granted"| SJ["startJob: queued, new generation, window fixed once"]:::new
  CJ -->|"scope missing"| CONS["Consent row: POST gmail/connect with signed import intent"]:::new
  CONS --> G["Google consent with include_granted_scopes"]:::system
  G --> CB["OAuth callback resumes awaiting jobs and restarts the intent sender's failed job"]:::new
  G -->|"refused or read access still missing"| REF["Redirect with import_permission_refused"]:::policy
  CB --> SJ
  SJ -.-> IMP
  SJ --> SC["StartGmailHistoryImportCommand with generation"]:::new
  SC --> BUS["EventBridge rules hutch-start-gmail-history-import and page-processed"]:::system
  BUS --> Q[("gmail-history-import SQS")]:::new
  Q --> L["Import Lambda: start runs page 0, page command runs page N"]:::new
  L --> F1{"Job running or queued in this generation"}:::policy
  F1 -->|"no"| PP
  F1 -->|"page already saved"| RP["Republish progress or complete if settled"]:::new
  F1 -->|"yes"| F2["Fence connection gateway and account, then sender mapping"]:::new
  F2 -->|"mismatch"| CAN["Cancel job: disconnected, account-changed, mapping-removed or destination-changed"]:::new
  F2 --> CL["Claim page, 60 second lease"]:::new
  CL --> LS["List unread from sender in window, fetch RAW with read-only token"]:::new
  GM["Gmail API"]:::system <-.-> LS
  LS --> PUT["Put raw under gmail-import prefix"]:::new
  PUT -.-> RAW[("Inbox raw-email bucket")]:::store
  PUT --> RF["Record message row, count new messages in listed"]:::new
  RF -.-> IMP
  RF --> MF["GmailHistoryImportMessageFetchedEvent"]:::new
  MF --> SAVE["Save page: advance page and token, stamp listingCompletedAt at the end"]:::new
  SAVE -.-> IMP
  SAVE -->|"listing complete and all settled"| CE["GmailHistoryImportCompletedEvent"]:::new
  LS -->|"reauth-required, readonly missing or rejected"| FJ["Fail job; mark connection revoked on reauth"]:::new
  FJ --> FE["GmailHistoryImportFailedEvent"]:::new
  CAN --> PP
  RP --> PP
  SAVE --> PP["GmailHistoryImportPageProcessedEvent with optional next page"]:::new
  FE --> PP
  PP --> BUS
  Q -->|"progress with next page"| NP["ProcessGmailHistoryImportPageCommand, direct SQS, 10 s delay"]:::new
  NP --> Q
  LS -->|"Gmail unavailable"| Q
  Q -->|"5 receives exhausted"| SDLQ[("Shared DLQ gmail-history-import-failures")]:::new
  SDLQ --> DR["gmail-history-import-dlq router, pages route: fail job dead-lettered"]:::new
  DR --> FE
  classDef command fill:#a6d8ff,stroke:#1e6fb8;
  classDef system fill:#fff2a8,stroke:#a08a00;
  classDef event fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;
```

</details>

## Ingestion, deduplication and outcomes

The inbox stack consumes `MessageFetched` in a new ingest Lambda. It checks the job is still running in the event's generation (otherwise the outcome is `cancelled`), reads the raw object, and parses it; an oversize or unparseable message throws, retries, and dead-letters into the shared inbox failures DLQ, whose new route publishes the outcome `failed`. A message whose parsed From is not the job's sender is `skipped-sender-mismatch`; one with no real Message-ID is `skipped-no-message-id`; a destination address that is missing, disabled or owned by someone else is `cancelled`.

Deduplication uses a claim per `(user, sender, normalised Message-ID)` in a new identities table. A first claim wins. The same attempt (the same SES message for forwarding, or the same job, account and Gmail message for imports) proceeds with the stored row key, so retries and co-addressed recipients converge. Another attempt that finds a stored email row reports `already-imported`; if the other attempt left no row, a conditional takeover lets this one proceed. Before claiming, a new Message-ID index on the emails table lets a received row that predates claims be adopted. An imported message is then stored through the same ingest step that forwarded mail uses, and publishes `EmailReceived` with origin `gmail-import` addressed to the readlist address. The existing link extractor accepts that origin, resolves the readlist from the address, and submits kept links to it (All submits with readlist `default`), which is how imported links reach the chosen readlist.

Every parsed record publishes `MessageIngested` with its outcome. The outcomes Lambda records it on the message row and the job counts in one transaction fenced on both generations (a stale outcome is ignored, a duplicate is not counted twice) and then completes the job when listing has finished and every listed message has an outcome. Completion is idempotent, so a redelivered final outcome still completes an interrupted job. An outcome that dead-letters is recorded as `failed` by the shared DLQ router's outcomes route, which also completes the job.

![Ingestion and outcomes](diagrams/ingestion-and-outcomes.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  MF["GmailHistoryImportMessageFetchedEvent"]:::new --> R1["EventBridge rule inbox-ingest-gmail-import"]:::system
  R1 --> Q[("inbox-ingest-gmail-import SQS")]:::new
  Q --> L["Ingest Lambda"]:::new
  IMP[("Hutch Gmail history imports, read only")]:::store -.-> L
  L -->|"job not running in generation, or destination gone"| OC["Outcome cancelled"]:::new
  RAW[("Inbox raw-email bucket")]:::store -.-> L
  L -->|"From is not the job sender"| OS["Outcome skipped-sender-mismatch"]:::new
  L -->|"no real Message-ID"| ON["Outcome skipped-no-message-id"]:::new
  L --> ID["Resolve identity: adopt pre-claim row by Message-ID index, claim, same attempt, or take over"]:::new
  IDS[("Email identities: claim per user, sender, Message-ID")]:::new <-.-> ID
  EM[("Inbox emails with messageId-index")]:::store -.-> ID
  ID -->|"another attempt stored the email"| OA["Outcome already-imported"]:::new
  ID -->|"proceed"| ING["Ingest parsed email: store body and images, write received row"]:::new
  ING -.-> EM
  ING --> ER["EmailReceivedEvent origin gmail-import to the readlist address"]:::new
  ER --> EX["Existing extract-email-links: triage links, resolve readlist from address"]:::system
  EX --> SL["SubmitLinkCommand to the chosen readlist, All as default"]:::command
  ING --> OI["Outcome imported with row key"]:::new
  OC --> MI["GmailHistoryImportMessageIngestedEvent"]:::new
  OS --> MI
  ON --> MI
  OA --> MI
  OI --> MI
  L -->|"oversize, unparseable or error"| Q
  Q -->|"receives exhausted"| IDLQ[("Shared inbox-failures DLQ")]:::dlq
  IDLQ --> IR["inbox-failures-dlq router, new ingestGmailImport route"]:::new
  IR --> MI
  MI --> R2["EventBridge rule hutch-gmail-history-import-outcomes"]:::system
  R2 --> OQ[("gmail-history-import-outcomes SQS")]:::new
  OQ --> OL["Outcomes Lambda: record outcome fenced on both generations"]:::new
  OL -.-> IMP2[("Gmail history imports")]:::store
  OL -->|"recorded or duplicate"| CS["Complete if listing finished and all settled"]:::new
  CS --> CE["GmailHistoryImportCompletedEvent"]:::new
  OQ -->|"receives exhausted"| SDLQ[("Shared DLQ gmail-history-import-failures")]:::new
  SDLQ --> OR["gmail-history-import-dlq router, outcomes route: record failed, complete if settled"]:::new
  OR --> CE
  classDef command fill:#a6d8ff,stroke:#1e6fb8;
  classDef system fill:#fff2a8,stroke:#a08a00;
  classDef event fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;
```

</details>

## Forwarded mail on the receive path

Forwarded newsletters still arrive through SES at the reader's gateway address. The receive Lambda keeps its existing order: confirmation interception, sender routing from the gateway to the sender's mapped address (now usually a readlist address), and holding mail for unmapped senders. After routing, and only for a deliverable recipient whose sender and normalised Message-ID are both known, it resolves the same identity claim with the SES message as the attempt. A message already imported is skipped with no row and no event, and co-addressed recipients of one SES message resolve as the same attempt, so the existing one-row, one-publish-per-recipient behaviour holds. Images are downloaded once per message, only after a copy is allowed to proceed. Mail sent directly to a readlist address takes the plain delivery branch.

![Forwarded receive path](diagrams/forwarded-receive-path.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  SES["SES receipt at gmail gateway address"]:::system --> RQ[("inbox receive SQS")]:::queue
  RQ --> RL["Receive Lambda: parse, intercept confirmation, route by sender, hold unmapped"]:::system
  SND[("Gmail senders: mappedAddress")]:::store -.-> RL
  RL -->|"routed to readlist address"| ID["Resolve identity with SES message attempt"]:::new
  IDS[("Email identities")]:::new <-.-> ID
  ID -->|"already imported or stored"| SKIP["Skip: no row, no event"]:::new
  ID -->|"proceed"| ING["Ingest parsed email, images downloaded once per message"]:::new
  ING -.-> EM[("Inbox emails")]:::store
  ING --> ER["EmailReceivedEvent origin receive"]:::event
  ER --> EX["Existing extract-email-links to readlist"]:::system
  RL -->|"no sender or no real Message-ID"| ING
  classDef command fill:#a6d8ff,stroke:#1e6fb8;
  classDef system fill:#fff2a8,stroke:#a08a00;
  classDef event fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;
```

</details>

## Cancellation and erasure

Cancellation is a synchronous store transition with no event: it moves every non-terminal job that matches (all of a user's jobs, or one sender's) to `cancelled` with a reason. Pages in flight then fence on the job state and end in `PageProcessed` without a next page, and fetched messages still in flight are ingested as `cancelled`. The web cancels on remove (`mapping-removed`), remap and readlist delete (`destination-changed`), the reader's cancel button (`user-cancelled`) and disconnect (`disconnected`); the disconnect worker cancels again before it deletes the senders.

Account deletion adds four erasure steps to the existing user-data job, in order: sweep the imported raw mail under the user's `gmail-import/` prefix, delete every import job and message row, delete every identity claim through the identities table's user index, and, after Gmail is disconnected, delete the readlist-address claims (derived from the user's address rows, never scanned) before the addresses are tombstoned. Each step is a no-op on an empty account, so a redriven deletion converges.

![Cancellation and erasure](diagrams/cancellation-and-erasure.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  WEB["Web: remove, remap, cancel button, readlist delete, disconnect"]:::system --> CX["Cancel unfinished imports with reason"]:::new
  DG["DisconnectGmailCommand"]:::command --> DW["Existing disconnect worker"]:::system
  DW --> CX
  DW --> GD["GmailDisconnectedEvent"]:::event
  CX -.-> IMP[("Gmail history imports")]:::new
  IMP -.-> FEN["In-flight pages end with no next page; in-flight messages ingest as cancelled"]:::new
  DA["DeleteAccountCommand"]:::command --> UDJ["user-data-jobs Lambda"]:::system
  UDJ --> S1["Existing inbox row deletes"]:::system
  S1 --> S2["Sweep raw mail under gmail-import user prefix"]:::new
  S2 --> S3["Delete all import jobs and message rows"]:::new
  S3 --> S4["Delete all identity claims via userId-index"]:::new
  S4 --> S5["Disconnect Gmail, cancelling imports"]:::system
  S5 --> S6["Delete readlist-address claims derived from address rows"]:::new
  S6 --> S7["Existing tombstone of inbox addresses"]:::system
  S2 -.-> RAW[("Inbox raw-email bucket")]:::store
  S4 -.-> IDS[("Email identities")]:::new
  S6 -.-> ADDR[("Inbox addresses")]:::store
  classDef command fill:#a6d8ff,stroke:#1e6fb8;
  classDef system fill:#fff2a8,stroke:#a08a00;
  classDef event fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;
```

</details>

## Command → System → Event(s) reference

| Command / event | System that handles it | Event(s) emitted | Next command(s) triggered |
|---|---|---|---|
| **new** `SubmitNewsletterSenderCommand` (web, on save when the sender is not an approved newsletter) | `newsletter-catalog-suggestions` Lambda via its own SQS queue and DLQ | **new** `NewsletterSenderSubmittedEvent` (`created-pending` or `already-present`) | none |
| `RewriteGmailFilterCommand` (`sender-added`, `sender-removed`, `readlist-deleted`, existing reasons) | existing `rewrite-gmail-filter` Lambda | `GmailFilterRewrittenEvent` / `GmailFilterRewriteFailedEvent` | none |
| **new** `StartGmailHistoryImportCommand` `{userId, jobId, generation}` (web start, retry, OAuth callback resume) | `gmail-history-import` Lambda, page 0 in process | `MessageFetched` × n, optional `Completed` or `Failed`, always `PageProcessed` | none directly |
| **new** `ProcessGmailHistoryImportPageCommand` (direct SQS, 10 s delay) | `gmail-history-import` Lambda, page N | same as Start | none directly |
| **new** `GmailHistoryImportPageProcessedEvent` `{nextPage?}` | `gmail-history-import` Lambda progress branch (same queue) | none | `ProcessGmailHistoryImportPageCommand` when `nextPage` is set |
| **new** `GmailHistoryImportMessageFetchedEvent` | inbox `ingest-gmail-import` Lambda | `EmailReceivedEvent` (origin `gmail-import`) when imported; always `GmailHistoryImportMessageIngestedEvent` | the existing extractor's `SubmitLinkCommand` / triage chain |
| `EmailReceivedEvent` (origin widened with `gmail-import`) | existing `inbox-extract-email-links` Lambda | `EmailLinksTriaged` and the existing link events | `SubmitLinkCommand` to the address's readlist |
| **new** `GmailHistoryImportMessageIngestedEvent` | `gmail-history-import-outcomes` Lambda | **new** `GmailHistoryImportCompletedEvent` on the settling transition | none |
| **new** `GmailHistoryImportCompletedEvent` | no subscriber (the page polls the job row) | — | — |
| **new** `GmailHistoryImportFailedEvent` (`gmail-rejected`, `permission-revoked`, `dead-lettered`) | no subscriber (the page shows consent or retry) | — | — |
| dead letter from `gmail-history-import-q` | `gmail-history-import-dlq` router, pages route | `GmailHistoryImportFailedEvent` (`dead-lettered`) when the job transitioned | none |
| dead letter from `gmail-history-import-outcomes-q` | `gmail-history-import-dlq` router, outcomes route | `GmailHistoryImportCompletedEvent` when settled | none |
| dead letter from `inbox-ingest-gmail-import-q` | existing `inbox-failures-dlq` router, new `ingestGmailImport` route | `GmailHistoryImportMessageIngestedEvent` (`failed`) | none |
| `DisconnectGmailCommand` | existing disconnect worker, now also cancelling imports | `GmailDisconnectedEvent` | none |
| `DeleteAccountCommand` | existing `user-data-jobs` Lambda, four new erasure steps | existing deletion events | none |

## Stores and grants

| Store | Status | Keys and access pattern | Who reads / writes |
|---|---|---|---|
| Hutch Gmail history imports table | new | PK `userId`, SK `JOB#<jobId>` or `MSG#<jobId>#<gmailMessageId>`; queries use `begins_with` only | web (Get, BatchGet, Put, Update, Delete, Query); import Lambda (Get, Put, Update, Query, TransactWrite, ConditionCheck); outcomes Lambda and DLQ router (Get, Update, TransactWrite); inbox ingest (GetItem via a config-derived ARN); rewrite-gmail-filter (Query, Update); user-data-jobs (Query, Update, Delete) |
| Inbox email identities table | new | PK identity key; KEYS_ONLY `userId-index` for erasure | receive and ingest (Get, Put, Update); user-data-jobs (Query on the index, Delete) |
| Inbox emails table | changed | new GSI `messageId-index` (hash `messageId`, range `userId`, INCLUDE sender and status) over existing attributes | receive and ingest Query; ingest Get, Put, Update |
| Inbox addresses table | new items | readlist rows with purpose `gmail-readlist`, and claim items keyed `claim#gmail-readlist#<userId>#<slug>` that never enter the user index | web get-or-create, find, retire; user-data-jobs deletes claims |
| Newsletter catalog bucket | new | one private JSON object, ETag-conditional writes | web and suggestions Lambda (read and write policies) |
| Inbox raw-email bucket | new prefix | `gmail-import/<userId>/<jobId>/<gmailMessageId>.eml` | import Lambda (inline PutObject on the prefix only); ingest (read); user-data-jobs (existing Delete and List) |

Every new environment variable is a config-derived name (`DYNAMODB_GMAIL_HISTORY_IMPORTS_TABLE`, `DYNAMODB_INBOX_EMAIL_IDENTITIES_TABLE`, `NEWSLETTER_CATALOG_BUCKET_NAME`, `GMAIL_HISTORY_IMPORT_QUEUE_URL`), read only by Lambda entry points or by the production provider assembly. Cross-stack access uses ARNs built from stack config; no StackReference is added.

## Source map and deployment

| Area | Where to look |
|---|---|
| Domain types and rules | the domain package's `gmail` area (import job, summary, scope), `inbox` area (identity claim, readlist-address purpose), and new `newsletter-catalog` area (schema, moderation, detector) |
| Wire contracts | the infra-components package's event catalog (nine new commands and events, origin widening) and its DLQ source-queue maps |
| Adapters | the inbox-store package (imports, identities, readlist claims, Message-ID query, raw writer); hutch's Gmail API providers (read-only token, history) and S3 catalog provider |
| Hutch workers | the four new Lambda entry points (import, outcomes, DLQ router, catalog suggestions) and their domain handlers; the readlist-delete decorator and disconnect/cancel handlers |
| Inbox workers | the new ingest entry point and handler, the extracted ingest step, the identity resolver, and the receive handler changes |
| Web | the Gmail integration page, its mappings routes, import actions and OAuth connect routes; the admin index and admin newsletters pages |
| Infrastructure | hutch and inbox Pulumi programs and storage components; the four new hutch Lambdas, shared DLQ, rules and grants; the inbox ingest Lambda, receive and failures-DLQ grants |

Rollout is ordered storage first (new tables, the GSI, the bucket), then consumers (inbox ingest and receive with the identity claim, web and worker env), then producers and UI once the Google consent screen includes `gmail.readonly`. The Gmail page stays behind the existing `?feature=gmail` navigation gate.

## Known gaps

- The per-message fence cancels by sender, so an in-flight page of an old job can cancel a newer job for the same sender in a millisecond window; no occurrence has been observed.
- A crash between retiring a readlist address's row and deleting its claim can leave a claim pointing at a disabled address.
- Account deletion sweeps the raw prefix before cancelling imports, so a page in flight can write a raw object after the sweep.
- Dev mode (`PERSISTENCE=development`) has no local import runner: started jobs stay `queued`.
- Starting an import checks for an unfinished job without a lock; concurrent starts for one sender could create two jobs, which ingestion's identity claim converges.
- Readonly consent, the down-scoped token and Message-ID preservation through Gmail forwarding still need verification with a real account in staging.
