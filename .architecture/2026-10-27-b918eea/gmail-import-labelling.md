# Gmail import labelling — label and mark read after a save reaches All

**Commit:** `b918eea` · **Commit date:** 2026-10-27 · **Generated:** 2026-10-27 · **Branch:** `rp/blissful-hopper-kukf1y`

**Subject:** feat: label and mark Gmail originals read once their email is saved to All

Once every output a Gmail-mapped email selected for the reader's All readlist is durably saved there, the original Gmail message is labelled `imported-to-readplace` and marked read. This covers both entry points: a manual history import of a mapped sender's mail, and future mail forwarded through the Gmail filter. Saves that are held, unparsed, truncated or failed never qualify. Article enrichment, summaries and filing into custom readlists do not delay the Gmail update.

## Legend

Nodes and edges highlighted in **gold** (`:::new`) are new in this snapshot; everything else is the flow as it already stood.

![Legend](diagrams/legend.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef queue fill:#e8e8e8,stroke:#666,color:#000;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;
  C[Command]:::command
  S[System / Lambda]:::system
  E[Event]:::event
  P[Policy / reaction]:::policy
  R[(Read model / store)]:::store
  Q[[Queue]]:::queue
  D[[DLQ]]:::dlq
  N[Changed in this snapshot]:::new
```

</details>

## 1. Capturing the Gmail identity of an accepted email

Both ingestion paths now record which Gmail message an inbox email came from on the canonical inbox email row. A duplicate (the same issue arriving by forwarding and by import) resolves back to the canonical row and keeps the newly discovered identity, then re-evaluates completion so the new copy is labelled too.

![Identity capture](diagrams/identity-capture.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef queue fill:#e8e8e8,stroke:#666,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;

  SES[SES receipt notification]:::event --> RQ[[inbox-receive-email queue]]:::queue --> RX[receive-email Lambda]:::system
  FETCHED[GmailHistoryImportMessageFetched]:::event --> IQ[[inbox-ingest-gmail-import queue]]:::queue --> IG[ingest-gmail-import Lambda]:::system

  RX --> CONN[(Gmail connections<br/>account captured at receipt)]:::new
  RX --> ID{Email identity claim}:::policy
  IG --> ID
  ID -- new --> ROW[(Inbox email row<br/>+ gmailOrigins set)]:::new
  ID -- already ingested,<br/>canonical row id --> DUP[Record duplicate Gmail origin<br/>ADD to canonical row]:::new
  DUP --> EVAL[Evaluate completion inline]:::new
  EVAL -- canonical already in All --> MARK[MarkGmailEmailImported]:::new
  ROW --> RECEIVED[EmailReceived]:::event
  RX -. forwarded origin:<br/>account, sender, RFC Message-ID .-> ROW
  IG -. history origin:<br/>account, Gmail message id .-> ROW
```

</details>

## 2. Frozen selection and dispatch to All

Extraction for a Gmail-mapped email whose saves are not held is split into a selection step and a dispatch step. The selection — the full issue, the eligible link ordinals, or both — is persisted on the inbox email row before any save is dispatched, frozen the first time it is made. A retry replays it without re-running triage. Every save command carries the email/output correlation, and a selection-completed fact is published on every run, including one that selected nothing.

![Selection and dispatch](diagrams/selection-dispatch.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef queue fill:#e8e8e8,stroke:#666,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;

  RECEIVED[EmailReceived]:::event --> XQ[[inbox-extract-email-links queue]]:::queue --> X[extract-email-links Lambda]:::system
  X --> TRACK{Gmail routing and<br/>write access full?}:::policy
  TRACK -- no: inbox address,<br/>held, backfill --> OLD[Dispatch as before,<br/>no tracking]:::system
  TRACK -- yes --> FROZEN{Selection already<br/>on the row?}:::new
  FROZEN -- yes --> REPLAY[Replay frozen selection<br/>no triage call]:::new
  FROZEN -- no --> TRIAGE[Triage links, write link rows]:::system --> SELECT[(outputSelection<br/>conditional SET, first wins)]:::new
  SELECT --> DISPATCH[Dispatch each selected output]:::new
  REPLAY --> DISPATCH
  DISPATCH -- issue --> SEI[SaveEmailIssueCommand<br/>+ emailOutput]:::new
  DISPATCH -- link ordinal, URL from link row --> SLC[SubmitLinkCommand<br/>+ emailOutput]:::new
  DISPATCH --> SELECTED[EmailOutputsSelected<br/>outputCount, may be 0]:::new
  X --> PREVIEW[CrawlEmailLinkPreview]:::command
  X --> TRIAGED[EmailLinksTriaged<br/>custom readlist filing]:::event
```

</details>

## 3. Confirming saves in All and completing the import

The save workers emit `EmailOutputSavedToAll` immediately after the durable write to All — duplicate saves included — and before custom-readlist filing or enrichment. A completion Lambda records each acknowledgement atomically (a DynamoDB string-set `ADD`) and evaluates completion with a strongly consistent read; duplicates and reordered facts converge, and nothing ever removes an acknowledgement.

![Completion](diagrams/completion.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef queue fill:#e8e8e8,stroke:#666,color:#000;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;

  SLC[SubmitLinkCommand]:::command --> SL[submit-link Lambda]:::system --> ALL[(All readlist row)]:::store
  SEI[SaveEmailIssueCommand]:::command --> SE[save-email-issue Lambda]:::system --> ALL
  ALL --> ACK[EmailOutputSavedToAll]:::new
  SL --> FILE[File into custom readlist,<br/>crawl / enrich]:::system
  SE --> FILE
  ACK --> CQ[[inbox-gmail-import-completion queue]]:::new
  SELECTED[EmailOutputsSelected]:::new --> CQ
  CQ --> CL[gmail-import-completion Lambda]:::new
  CQ -. exhausted .-> CDLQ[[own DLQ + alarm]]:::dlq
  CL --> ADD[(ADD savedOutputs)]:::new
  CL --> READ[(Consistent read:<br/>selection, savedOutputs, gmailOrigins)]:::new
  READ --> DONE{Selection present, not truncated,<br/>every output acknowledged,<br/>at least one Gmail origin?}:::policy
  DONE -- no --> WAIT[Wait for the next fact]:::system
  DONE -- yes, one per origin --> MARK[MarkGmailEmailImported]:::new
```

</details>

## 4. Labelling the Gmail original

The Gmail worker records the update as pending (an account-prefixed record in the Gmail history-imports table) before it checks permission, then opens the mailbox through one credential snapshot: refresh token and granted scope read together, one access token minted from that token, and the mailbox's own address verified before any lookup or change. A history message is found by its Gmail id; a forwarded one by RFC Message-ID search with the sender and Message-ID verified, mutating only an unambiguous match. The `imported-to-readplace` label is reused or created (a creation conflict re-lists and reuses). One modify request adds the label and removes `UNREAD`, leaving other labels and inbox placement alone. Completion is recorded only after Gmail accepts it, and a completed record answers every later request.

![Gmail worker](diagrams/gmail-worker.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef queue fill:#e8e8e8,stroke:#666,color:#000;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;

  MARK[MarkGmailEmailImported]:::new --> GQ[[gmail-message-updates queue]]:::new
  GRANT[GmailModifyPermissionGranted]:::new --> GQ
  GQ --> GW[gmail-message-updates Lambda]:::new
  GQ -. exhausted .-> SDLQ[[gmail-history-import-failures<br/>shared DLQ]]:::dlq --> DLQH[gmail-history-import-dlq router]:::system
  DLQH --> FAILREC[(record failed: dead-lettered)]:::new
  DLQH --> FAILED[GmailEmailUpdateFailed]:::new

  GW --> PEND[(GMAIL_UPDATE#account#origin<br/>record pending)]:::new
  PEND --> STATUS{Record status}:::policy
  STATUS -- completed --> MARKED[GmailEmailMarkedImported<br/>already-marked]:::new
  STATUS -- failed --> FAILED
  STATUS -- pending --> ACCT{Connected account is the captured one,<br/>not revoked or disconnecting?}:::policy
  ACCT -- no --> DEFER[GmailEmailUpdateDeferred<br/>account-unavailable]:::new
  ACCT -- yes --> OPEN[Open mailbox: one credential snapshot,<br/>gmail.modify scope, verified profile]:::new
  OPEN -- no modify scope --> DEFERP[GmailEmailUpdateDeferred<br/>permission-required]:::new
  OPEN -- transient --> RETRY[Throw: SQS retry]:::system
  OPEN -- ok --> FIND{Locate original}:::policy
  FIND -- history: messages.get --> LABEL
  FIND -- forwarded: rfc822msgid search,<br/>verify Message-ID and sender --> LABEL[Find or create label<br/>imported-to-readplace]:::new
  FIND -- missing or ambiguous --> FAILREC2[(record failed)]:::new --> FAILED
  LABEL --> MOD[messages.modify<br/>+label, -UNREAD]:::new --> COMPLETE[(record completed)]:::new --> MARKED2[GmailEmailMarkedImported<br/>marked]:::new
  GW -. failed line .-> METRIC[GmailEmailUpdateFailed metric<br/>alarm emails operator]:::new

  GRANT --> RESUME[List pending records of the account<br/>consistent, paginated key query]:::new --> MARK
```

</details>

## 5. Permission: request, upgrade and resume

New connections and the import permission request ask for `gmail.modify`, which also reads mail, so a reader who grants it needs no separate read-only grant; existing read-only grants keep working. Readers connected without it see an "Allow labelling" prompt that runs the incremental OAuth upgrade. After the upgraded credentials are stored, the callback publishes `GmailModifyPermissionGranted`, which resumes every pending update for that account. Because pending work is persisted before permission is checked, a grant that lands concurrently with a completion is never missed.

![Permission](diagrams/permission.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;

  PAGE[Gmail newsletters page<br/>connected, no gmail.modify]:::new --> PROMPT[Allow labelling<br/>POST connect, intent=label]:::new
  PROMPT --> GOOGLE[Google consent<br/>scope gmail.modify,<br/>include_granted_scopes]:::system
  CONNECT[Connect / import permission]:::system --> GOOGLE
  GOOGLE --> CB[OAuth callback]:::system
  CB --> CRED[(Store credentials<br/>refresh token + granted scope)]:::store
  CRED --> HAS{gmail.modify granted?}:::policy
  HAS -- yes --> GRANT[GmailModifyPermissionGranted]:::new
  HAS -- no, label intent --> REFUSED[notice: label_permission_refused]:::new
  GRANT --> RESUME[Gmail worker resumes<br/>pending updates for the account]:::new
  CB --> NOTICE[notice: label_permission_granted]:::new
```

</details>

## 6. History pagination independent of read state

The history import lists the sender's mail in its fixed date window without `is:unread`, keeping the spam and trash exclusions, and checks `UNREAD` on each fetched message. Marking imported mail read therefore never shifts which messages a later page holds, including updates caused by concurrent forwarding; already-read messages cost one extra read each and are skipped.

![History pagination](diagrams/history-pagination.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;

  PAGE[gmail-history-import page]:::system --> LIST[messages.list<br/>from:sender after/before<br/>no is:unread]:::new
  LIST --> GET[messages.get raw + labelIds]:::system
  GET --> SPAM{SPAM / TRASH?}:::policy
  SPAM -- yes --> SKIP1[skip: unlisted-label]:::system
  SPAM -- no --> UNREAD{UNREAD label?}:::new
  UNREAD -- no --> SKIP2[skip: already-read]:::new
  UNREAD -- yes --> FETCHED[GmailHistoryImportMessageFetched]:::event
```

</details>

## Command → System → Event(s) reference

| Command / event | Handled by | Emits | Next |
|---|---|---|---|
| SES receipt (forwarded mail) | inbox receive-email Lambda | `EmailReceived`; on a duplicate, `MarkGmailEmailImported` if the canonical email is already in All | extract-email-links; Gmail worker |
| `GmailHistoryImportMessageFetched` | inbox ingest-gmail-import Lambda | `EmailReceived`, `GmailHistoryImportMessageIngested`; on a duplicate, `MarkGmailEmailImported` if already in All | extract-email-links; history outcomes; Gmail worker |
| `EmailReceived` | inbox extract-email-links Lambda | `SubmitLinkCommand` / `SaveEmailIssueCommand` (with `emailOutput` when tracked), `CrawlEmailLinkPreview`, `EmailLinksTriaged`, **`EmailOutputsSelected`** | save-link workers; preview crawler; custom-readlist filter; completion |
| `SubmitLinkCommand` | save-link submit-link Lambda | `LinkQueued`, `QueueEntryCreated`, **`EmailOutputSavedToAll`**, `TierContentExtracted` | inbox read model; completion; content selection |
| `SaveEmailIssueCommand` | save-link save-email-issue Lambda | **`EmailOutputSavedToAll`**, `TierContentExtracted` | completion; content selection |
| **`EmailOutputsSelected`** | inbox gmail-import-completion Lambda | `MarkGmailEmailImported` per Gmail origin when complete | Gmail worker |
| **`EmailOutputSavedToAll`** | inbox gmail-import-completion Lambda | `MarkGmailEmailImported` per Gmail origin when complete | Gmail worker |
| **`MarkGmailEmailImported`** | hutch gmail-message-updates Lambda | **`GmailEmailMarkedImported`** / **`GmailEmailUpdateDeferred`** / **`GmailEmailUpdateFailed`** | — (facts) |
| **`GmailModifyPermissionGranted`** | hutch gmail-message-updates Lambda | `MarkGmailEmailImported` per pending update of the account | Gmail worker |
| Dead-lettered `MarkGmailEmailImported` | hutch gmail-history-import-dlq router | **`GmailEmailUpdateFailed`** (dead-lettered) | — |
| OAuth callback with `gmail.modify` | hutch web Lambda | **`GmailModifyPermissionGranted`** | Gmail worker |
