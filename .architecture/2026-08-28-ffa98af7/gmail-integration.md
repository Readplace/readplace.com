# Gmail integration — event storming

**Commit:** `ffa98af7` — *feat: write and maintain the Gmail forwarding filter from a reader's senders*
**Commit date:** 2026-08-28 · **Generated:** 2026-08-28 · **Branch:** `main`

A point-in-time map of every command, system and event involved in connecting a
Gmail account, confirming its forwarding address, writing and maintaining the
Gmail filter, routing forwarded mail by sender, and disconnecting.

---

## Legend

Every node in the diagrams below carries one of these roles. Nodes drawn with a
thick amber border (`:::new`) are the ones this snapshot introduces — the whole
Gmail flow is new since the previous snapshot, so the highlight marks the
commands and events that did not exist in it at all.

![Colour legend for the diagram roles](diagrams/legend.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
  C["Command<br/>(a request that may be refused)"]:::cmd
  S["System / aggregate<br/>(the handler that decides)"]:::sys
  E["Event<br/>(an irreversible fact)"]:::evt
  P["Policy / reaction<br/>(what an event triggers)"]:::pol
  R["Read model / store"]:::store
  Q["Queue"]:::queue
  D["Dead-letter queue"]:::dlq
  N["New in this snapshot"]:::new

  classDef cmd fill:#a6d8ff,stroke:#1e6fb8,color:#062b45;
  classDef sys fill:#fff2a8,stroke:#a08a00,color:#3d3400;
  classDef evt fill:#ffb976,stroke:#a85800,color:#3d1f00;
  classDef pol fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f2e1c;
  classDef queue fill:#e8e8e8,stroke:#666,color:#222;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3d0f0f;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#3d2600;
```

</details>

---

## 1. Connect and confirm

Connecting is an ordinary authenticated page action. Google issues the grant,
Readplace mints a gateway address, and the reader pastes that address into
Gmail's own forwarding settings — the one step no API can perform, because
`forwardingAddresses.create` is restricted to domain-wide-delegated service
accounts that a consumer `@gmail.com` cannot grant.

Google then emails a confirmation link to the gateway address, which lands in
Readplace's own inbound pipeline. The receive worker recognises it and hands it
to a dedicated worker that completes the confirmation with an empty-body POST —
no credentials involved, which is why that worker lives in the inbox stack
rather than beside the OAuth secret.

![Connecting a Gmail account and confirming the forwarding address](diagrams/connect-and-confirm.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  U(["Reader on /integrations"]) --> C1["POST /integrations/gmail/connect"]:::cmd
  C1 --> S1["hutch web · sign state, redirect"]:::sys
  S1 --> G1{{"Google consent<br/>gmail.settings.basic<br/>access_type=offline · prompt=consent"}}
  G1 --> C2["GET /integrations/gmail/callback"]:::cmd
  C2 --> S2["hutch web · verify state, exchange code"]:::sys
  S2 -->|refresh token| R1[("gmail-credentials")]:::store
  S2 -->|mint gateway alias| R2[("inbox-addresses<br/>purpose=gmail-forwarding")]:::store
  S2 -->|connection row| R3[("gmail-connections")]:::store

  R3 --> U2(["Reader pastes the gateway address<br/>into Gmail settings"])
  U2 --> G2{{"Google sends a confirmation email<br/>to the gateway address"}}
  G2 --> SES["SES → S3 → SNS → SQS"]:::queue
  SES --> S3["inbox · receive-email"]:::sys
  S3 -->|"From forwarding-noreply@google.com<br/>+ X-Google-Address-Confirmation<br/>+ sole live gateway recipient"| C3["ConfirmGmailForwardingCommand"]:::cmd
  C3 --> Q1["inbox-confirm-gmail-forwarding-q"]:::queue
  Q1 --> S4["inbox · confirm-gmail-forwarding<br/>empty-body POST to mail.google.com/mail/vf-…"]:::sys
  Q1 -.->|retries exhausted| D1["inbox shared failures DLQ"]:::dlq
  S4 -->|200, no submit form left| E1["GmailForwardingConfirmedEvent"]:::evt
  S4 -->|"400 · interstitial · bad URL"| E2["GmailForwardingConfirmFailedEvent"]:::evt
  S4 -.->|"5xx / network"| Q1

  E1 --> Q2["hutch-rewrite-gmail-filter-q"]:::queue
  Q2 --> S5["hutch · mark confirmed"]:::sys
  S5 --> R3
  S5 --> C4["RewriteGmailFilterCommand<br/>reason=forwarding-confirmed"]:::cmd

  class C3,C4,E1,E2,S4,S5,R1,R3,Q1,Q2 new;
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8,color:#062b45;
  classDef sys fill:#fff2a8,stroke:#a08a00,color:#3d3400;
  classDef evt fill:#ffb976,stroke:#a85800,color:#3d1f00;
  classDef pol fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f2e1c;
  classDef queue fill:#e8e8e8,stroke:#666,color:#222;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3d0f0f;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#3d2600;
```

</details>

---

## 2. Filter lifecycle

`RewriteGmailFilterCommand` carries only the reader's id and a reason — never a
snapshot of the sender set — so a redelivery reconciles against current truth
rather than replaying a stale list. Four page actions and one event dispatch it.

The worker holds three rules, each answering a distinct failure: it creates the
replacement before deleting what it supersedes; it reads the new filter back and
compares the query byte-for-byte, because Gmail accepts an over-long query and
then silently never matches it; and it decides which filters are its own from
Gmail's state rather than from stored ids, so a crashed run self-heals to
exactly one filter.

![The filter rewrite command, its triggers, and its two outcomes](diagrams/filter-lifecycle.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  A1["POST /integrations/gmail/verify"]:::cmd --> C1
  A2["POST /integrations/gmail/senders/add"]:::cmd --> C1
  A3["POST /integrations/gmail/senders/remove"]:::cmd --> C1
  A4["POST /integrations/gmail/senders/map"]:::cmd --> C1
  E0["GmailForwardingConfirmedEvent"]:::evt --> C1
  C1["RewriteGmailFilterCommand"]:::cmd --> Q["hutch-rewrite-gmail-filter-q"]:::queue
  Q -.->|retries exhausted| D["hutch-rewrite-gmail-filter-dlq<br/>→ SNS → operator email"]:::dlq
  Q --> S["hutch · rewrite-gmail-filter"]:::sys

  S --> RD1[("gmail-connections<br/>read state")]:::store
  S --> RD2[("gmail-senders<br/>read sender set")]:::store
  S --> RD3[("gmail-credentials<br/>refresh → access token")]:::store

  S --> B{"connection state"}
  B -->|"absent · unconfirmed · revoked"| F1["GmailFilterRewriteFailedEvent"]:::evt
  B -->|"query over the length cap"| F1
  B -->|"no senders left"| X1["delete our filters<br/>clear filterId"]:::pol
  B -->|"senders present"| X2["list → create → read back → delete old"]:::pol

  X2 -->|"query round-tripped"| OK["GmailFilterRewrittenEvent"]:::evt
  X2 -->|"Gmail stored a different query"| Y["delete the new filter<br/>record lastFilterError"]:::pol
  Y --> F1
  X1 --> OK
  X2 -.->|"429 / 5xx"| Q
  OK --> RD1
  F1 --> RD1

  class C1,A1,A2,A3,A4,E0,S,OK,F1,X1,X2,Y,Q,D,RD1,RD2,RD3 new;
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8,color:#062b45;
  classDef sys fill:#fff2a8,stroke:#a08a00,color:#3d3400;
  classDef evt fill:#ffb976,stroke:#a85800,color:#3d1f00;
  classDef pol fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f2e1c;
  classDef queue fill:#e8e8e8,stroke:#666,color:#222;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3d0f0f;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#3d2600;
```

</details>

---

## 3. Inbound mail routing

One receive worker serves every inbound message. Mail addressed to an ordinary
alias behaves exactly as it did before this commit. Two branches are new: the
Google confirmation is claimed before any outbound image fetch can be triggered,
and mail arriving at a gateway address is routed by its sender rather than by
the address it was sent to.

An unmapped sender is recorded and held. Nothing is published for it, so the
link-extraction Lambda is never invoked and no preview crawl runs for a
newsletter the reader has not claimed.

![How an inbound message is routed, including the two Gmail branches](diagrams/inbound-mail-routing.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  IN(["Inbound message"]) --> SES["SES → S3 raw .eml → SNS → SQS"]:::queue
  SES --> S["inbox · receive-email"]:::sys
  SES -.->|retries exhausted| D["inbox shared failures DLQ"]:::dlq

  S --> G1{"oversize / unparseable?"}
  G1 -->|yes| AUD[("inbox-emails<br/>audit row")]:::store
  G1 -->|no| G2{"Google forwarding confirmation<br/>to a single live gateway address?"}

  G2 -->|yes| C1["ConfirmGmailForwardingCommand"]:::cmd
  G2 -->|no| IMG["download inline images once"]:::pol
  IMG --> G3{"recipient purpose"}

  G3 -->|"unknown / disabled"| AUD
  G3 -->|"user-alias"| DEL["store body + row"]:::pol
  G3 -->|"gmail-forwarding"| G4{"sender mapped?"}

  G4 -->|"mapped"| MAP["deliver as the mapped alias"]:::pol
  G4 -->|"unmapped"| HOLD["record sender + hold the message<br/>publish nothing"]:::pol
  G4 -->|"sender unreadable"| DEL

  HOLD --> R1[("gmail-senders")]:::store
  HOLD --> R2[("gmail-held-mail")]:::store
  MAP --> DEL
  DEL --> R3[("inbox-emails")]:::store
  DEL --> E1["EmailReceivedEvent"]:::evt
  E1 --> EX["inbox · extract-email-links → previews"]:::sys

  class C1,G2,G4,MAP,HOLD,R1,R2 new;
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8,color:#062b45;
  classDef sys fill:#fff2a8,stroke:#a08a00,color:#3d3400;
  classDef evt fill:#ffb976,stroke:#a85800,color:#3d1f00;
  classDef pol fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f2e1c;
  classDef queue fill:#e8e8e8,stroke:#666,color:#222;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3d0f0f;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#3d2600;
```

</details>

---

## 4. Disconnect

Disconnecting is a command rather than an inline write for two reasons: the
Gmail filter has to be removed *before* the grant is revoked, or a rule keeps
forwarding to an address that no longer routes; and performing that removal in
the request path would place a restricted-scope credential in the web Lambda.

The steps are ordered so that an outage leaves the reader connected rather than
half-disconnected — the token is only forgotten once Google has confirmed the
revocation.

![The disconnect teardown order](diagrams/disconnect.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  A["POST /integrations/gmail/disconnect"]:::cmd --> C["DisconnectGmailCommand"]:::cmd
  C --> Q["hutch-rewrite-gmail-filter-q"]:::queue
  Q -.->|retries exhausted| D["hutch-rewrite-gmail-filter-dlq<br/>→ SNS → operator email"]:::dlq
  Q --> S["hutch · disconnect-gmail"]:::sys

  S --> S1["delete every sender row"]:::pol
  S1 --> S2["rewrite the filter<br/>(no senders left ⇒ Gmail filter removed)"]:::pol
  S2 -->|"Gmail unavailable"| Q
  S2 --> S3["revoke the grant at Google"]:::pol
  S3 -->|"Google unavailable"| Q
  S3 --> S4["delete credentials, mark revoked"]:::pol
  S4 --> R1[("gmail-credentials · row gone")]:::store
  S4 --> R2[("gmail-connections · revokedAt set<br/>index marker removed")]:::store
  S4 --> E["GmailDisconnectedEvent<br/>filterRemoved · grantRevoked"]:::evt

  class A,C,S,S1,S2,S3,S4,E,R1,R2,Q,D new;
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8,color:#062b45;
  classDef sys fill:#fff2a8,stroke:#a08a00,color:#3d3400;
  classDef evt fill:#ffb976,stroke:#a85800,color:#3d1f00;
  classDef pol fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f2e1c;
  classDef queue fill:#e8e8e8,stroke:#666,color:#222;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3d0f0f;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#3d2600;
```

</details>

---

## Command → System → Event(s) reference

| Command / Event | Handled by | Emits | Triggers next |
|---|---|---|---|
| `POST /integrations/gmail/connect` | hutch web | — (303 to Google) | reader completes consent |
| `GET /integrations/gmail/callback` | hutch web | — (303 back to the list) | writes credentials, gateway alias, connection row |
| `ConfirmGmailForwardingCommand` | inbox · confirm-gmail-forwarding | `GmailForwardingConfirmedEvent`, `GmailForwardingConfirmFailedEvent` | on success, the filter rewrite |
| `GmailForwardingConfirmedEvent` | hutch · rewrite-gmail-filter Lambda | `RewriteGmailFilterCommand` | marks the connection confirmed first |
| `GmailForwardingConfirmFailedEvent` | *(no consumer)* | — | recorded for operators only |
| `POST /integrations/gmail/verify` | hutch web | `RewriteGmailFilterCommand` (`requested`) | filter rewrite |
| `POST /integrations/gmail/senders/add` | hutch web | `RewriteGmailFilterCommand` (`sender-added`) | filter rewrite |
| `POST /integrations/gmail/senders/remove` | hutch web | `RewriteGmailFilterCommand` (`sender-removed`) | filter rewrite |
| `POST /integrations/gmail/senders/map` | hutch web | `RewriteGmailFilterCommand` (`sender-added`) | mints an alias, then the rewrite |
| `RewriteGmailFilterCommand` | hutch · rewrite-gmail-filter | `GmailFilterRewrittenEvent`, `GmailFilterRewriteFailedEvent` | terminal |
| `GmailFilterRewrittenEvent` | *(no consumer)* | — | terminal fact |
| `GmailFilterRewriteFailedEvent` | *(no consumer)* | — | surfaced on the page via `lastFilterError` |
| `POST /integrations/gmail/disconnect` | hutch web | `DisconnectGmailCommand` | teardown |
| `DisconnectGmailCommand` | hutch · disconnect-gmail | `GmailDisconnectedEvent` | terminal |
| `GmailDisconnectedEvent` | *(no consumer)* | — | terminal fact |
| `EmailReceivedEvent` | inbox · extract-email-links | link previews | pre-existing flow, unchanged |

All three Gmail detail types — `RewriteGmailFilter`, `GmailForwardingConfirmed`
and `DisconnectGmail` — route to a single hutch Lambda behind one SQS queue and
one DLQ, split by `detail-type` at the composition root. Each carries its own
stack-prefixed EventBridge rule name, so a rule can never be silently upserted
over another stack's.

---

## Stores

| Store | Stack | Keys | Written by |
|---|---|---|---|
| `gmail-credentials` | hutch | hash `userId` | callback, disconnect |
| `gmail-connections` | hutch | hash `userId`, sparse `connected-index` | callback, confirm, rewrite, disconnect |
| `inbox-gmail-senders` | inbox | hash `userId`, range `senderEmail` | page actions, receive worker, rewrite |
| `inbox-gmail-held-mail` | inbox | hash `userId`, range `receivedAt#messageId`, LSI on `senderEmail#…` | receive worker |
| `inbox-addresses` | inbox | hash `address`, `userId-index` | callback (gateway), sender mapping |

`countConnected` reads the sparse `connected-index` with `Select: "COUNT"`, so
the coming 100-user alarm never scans. The marker attribute is written while a
connection is live and removed when it is revoked, so the index holds only live
rows.

---

## Known gaps at this commit

- **Account deletion does not touch the Gmail stores.** Deleting an account
  leaves the credentials, connection, sender and held-mail rows in place and
  does not revoke at Google. The tables are keyed by `userId`, so the cleanup is
  a Query and delete per table, but nothing calls it yet.
- **No consumer for the three terminal facts.** `GmailFilterRewriteFailed`,
  `GmailForwardingConfirmFailed` and `GmailDisconnected` are published and
  logged; the failure state a reader sees comes from `lastFilterError` on the
  connection row, not from the event.
- **No alarm on the 100-user cap.** The counting path exists; the metric filter,
  emitter and alarm do not.
- **The filter query length cap is unmeasured.** The constant is a chosen value,
  guarded by the mandatory post-create read-back rather than by knowledge of
  Gmail's real ceiling.
