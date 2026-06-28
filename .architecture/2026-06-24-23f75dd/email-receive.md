# Email receive & read flow (M2)

Snapshot of the inbound email-forwarding flow at commit `23f75dd`. A forwarded
newsletter is received via AWS SES, parsed + sanitized, stored, surfaced as the
new past-tense `EmailReceivedEvent`, and read back in the `/inbox` UI. Everything
is gated behind `?feature=email`.

**New in this snapshot** (highlighted `:::new` in gold): the `EmailReceivedEvent`
wire format and the SES → SNS → SQS → `receive-email` Lambda chain that publishes
it. There is no M2 consumer — M3 attaches to `EmailReceivedEvent` to extract
links from the stored body without touching the publisher (Open/Closed).

> File paths in this document are accurate as of this commit and may later move.

---

## Legend

![Legend](diagrams/legend.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
  cmd[Command]:::command
  sys[System / aggregate]:::system
  evt[Event]:::event
  pol[Policy / reaction]:::policy
  rm[(Read model / store)]:::readmodel
  q[Queue]:::queue
  dlq[DLQ]:::dlq
  new[New in this snapshot]:::new

  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef readmodel fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef queue fill:#e8e8e8,stroke:#666,color:#000;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;
```

</details>

---

## Inbound receive flow

A real email arrives at `in-<token>@read.place`. The SES receipt rule (catch-all
on the mail domain — addresses are minted dynamically) stores the raw `.eml`
forever and notifies SNS; the receive queue drains it. The `receive-email`
handler is command-shaped (it can reject) and ends by publishing the
irreversible fact `EmailReceivedEvent`.

![Inbound receive flow](diagrams/inbound-receive-flow.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  sender([Forwarded newsletter to in-<token>@read.place]):::command
  ses[SES receipt rule<br/>recipients = mail domain]:::system
  rawS3[(Raw .eml bucket<br/>inbound/&lt;sesMessageId&gt; — kept forever)]:::readmodel
  sns[SNS receipt topic]:::system
  queue[receive-email SQS queue]:::queue
  dlq[receive-email DLQ<br/>+ CloudWatch alarm -> SNS email]:::dlq

  handler[receive-email Lambda<br/>receive-email-handler.ts]:::system
  addrStore[(inbox-addresses table<br/>findByAddress)]:::readmodel
  parse[parse-email.ts<br/>postal-mime + cid preparser]:::system
  store[store-email-body.ts<br/>sanitize-html + data: inline<br/>-> content bucket]:::system
  emailStore[(inbox-emails table<br/>conditional putEmail)]:::readmodel
  evt[EmailReceivedEvent<br/>userId, receivedAtMessageId, recipientAddress]:::new
  m3([M3 consumer — deferred]):::policy

  sender --> ses
  ses -->|s3Action| rawS3
  ses -->|topicArn| sns
  sns -->|raw delivery| queue
  queue --> handler
  queue -. maxReceiveCount .-> dlq

  handler -->|GetObject| rawS3
  handler -->|resolve recipient| addrStore
  handler --> parse
  parse --> store
  store -->|PutObject content.html| emailStore
  handler -->|status=received putEmail| emailStore
  handler --> evt
  evt -. OCP seam .-> m3

  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef event fill:#ffb976,stroke:#a85800,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef readmodel fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef queue fill:#e8e8e8,stroke:#666,color:#000;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;
```

</details>

### Degrade-with-alert branches (★15)

Oversize, unknown-recipient, disabled-recipient, and unparseable mail are never
silently dropped: each records an auditable row (or none, for a non-forwarding
recipient — the raw `.eml` is still kept forever) and fails the record to the
DLQ so the existing alarm pages the operator. Only the happy path publishes the
event.

![Degrade-with-alert branches](diagrams/degrade-with-alert.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  rec[receive-email handler per record]:::system
  badNote{SES notification<br/>valid?}:::system
  raw{raw .eml<br/>readable?}:::system
  fwd{recipient is a<br/>forwarding address?}:::system
  size{size <= 20 MiB?}:::system
  known{recipient<br/>resolved?}:::system
  enabled{address enabled?}:::system
  parsed{body parses?}:::system

  dlq[DLQ + alarm]:::dlq
  rejUnrouted[(rejected row<br/>unrouted partition)]:::readmodel
  rejOwner[(rejected row<br/>owner partition)]:::readmodel
  unparsed[(unparsed row<br/>owner partition)]:::readmodel
  received[(received row + bodyS3Key)]:::readmodel
  evt[publish EmailReceivedEvent]:::new

  rec --> badNote
  badNote -- no --> dlq
  badNote -- yes --> raw
  raw -- no (retry) --> dlq
  raw -- yes --> fwd
  fwd -- no --> dlq
  fwd -- yes --> size
  size -- no --> rejOwner --> dlq
  size -- yes --> known
  known -- no --> rejUnrouted --> dlq
  known -- yes --> enabled
  enabled -- no --> rejOwner --> dlq
  enabled -- yes --> parsed
  parsed -- no --> unparsed --> dlq
  parsed -- yes --> received --> evt

  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef readmodel fill:#b8e8c5,stroke:#2f7a45,color:#000;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000;
```

</details>

---

## Read flow (web, behind ?feature=email)

The `/inbox` surface reads the stores the receive flow wrote. It is not
event-driven — a modest page-level poll surfaces newly-arrived mail.

![Read flow](diagrams/read-flow.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  navList([GET /inbox]):::command
  listSys[inbox.page.ts GET /]:::system
  emailStore[(inbox-emails table<br/>listEmailsByUserId, newest first)]:::readmodel
  listView[Gmail-style list<br/>sender, subject, time, badge]:::system

  navDetail([GET /inbox/:id]):::command
  detailSys[inbox.page.ts GET /:id]:::system
  getRow[(inbox-emails table getEmail<br/>PK=userId scoped)]:::readmodel
  contentS3[(content bucket<br/>sanitized body HTML)]:::readmodel
  iframe[View tab: sandboxed iframe<br/>no allow-scripts/same-origin<br/>default-src none CSP]:::system
  articles([Articles tab — M3 placeholder]):::policy

  navAddr([GET /inbox/addresses]):::command
  addrSys[inbox.page.ts GET /addresses<br/>moved M1 management]:::system
  addrStore[(inbox-addresses table)]:::readmodel

  navList --> listSys --> emailStore --> listView
  navDetail --> detailSys --> getRow
  detailSys -->|received + bodyS3Key| contentS3 --> iframe
  detailSys --> articles
  navAddr --> addrSys --> addrStore

  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#000;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000;
  classDef readmodel fill:#b8e8c5,stroke:#2f7a45,color:#000;
```

</details>

---

## Command → System → Event(s) reference

| Command / trigger | System (handler) | Event(s) emitted | Next command(s) |
|---|---|---|---|
| Email to `in-<token>@read.place` | SES receipt rule → S3 + SNS | (SNS receipt notification) | enqueue to receive-email SQS |
| SQS message (SES notification) | `receive-email` Lambda (`receive-email-handler.ts`) | **`EmailReceivedEvent`** (happy path only) | none in M2 — M3 subscribes |
| oversize / unknown / disabled / unparseable | `receive-email` Lambda | none — audit row + DLQ failure | DLQ alarm → operator email |
| `GET /inbox` | `inbox.page.ts` `GET /` | none (read model) | — |
| `GET /inbox/:id` | `inbox.page.ts` `GET /:id` | none (read model) | — |
| `GET /inbox/addresses` | `inbox.page.ts` `GET /addresses` | none (read model) | — |
| `POST /inbox/create` · `POST /inbox/disable` | `inbox.page.ts` (M1) | none | — |

### Wire format

```
EmailReceivedEvent
  name:        "email-received"
  source:      "hutch.inbox"
  detailType:  "EmailReceived"
  detail:      { userId, receivedAtMessageId, recipientAddress }   (all strings)
```
