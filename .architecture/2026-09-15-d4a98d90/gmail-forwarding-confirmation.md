# Gmail forwarding confirmation — event storming

**Commit:** `d4a98d90` — *feat(hutch): show when each previously-read match was last read, and ship the section*
**Commit date:** 2026-09-15 · **Generated:** 2026-09-15 · **Branch:** `main`

A point-in-time map of how a reader connects Gmail, confirms the forwarding
address, and — new in this snapshot — how a confirmation that Google *rejects*
or *never completes* is recorded on the connection row, surfaced to the reader
as a "Needs attention" step 2, and recovered on its own once the reader re-adds
the address and Google confirms.

The `GmailForwardingConfirmFailedEvent` has existed and been published by the
inbox confirm worker since the Gmail integration shipped (see
[`2026-08-28-ffa98af7`](../2026-08-28-ffa98af7/)), but nothing consumed it — a
failed confirmation was observable in CloudWatch and invisible to the reader.
This snapshot gives it its first consumer.

> Captured from a dirty working tree — the whole change is uncommitted on top of
> the base commit `d4a98d90`.

---

## Legend

Every node in the diagrams below carries one of these roles. Nodes drawn with a
thick amber border (`:::new`) are the ones this snapshot introduces: the new
EventBridge subscription that routes the failed-confirmation fact into the
existing filter Lambda, the handler that records it, the `lastConfirmError` row
field and the `confirm-failed` connection state it drives, and the reader-facing
recovery surface.

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

## 1. Connect, confirm, and the failed-confirmation branch

Connecting is an ordinary authenticated page action. Google issues the grant,
Readplace mints a gateway address, and the reader pastes that address into
Gmail's own forwarding settings — the one step no API can perform, because
`forwardingAddresses.create` is restricted to domain-wide-delegated service
accounts that a consumer `@gmail.com` cannot grant.

Google then emails a confirmation link to the gateway address, which lands in
Readplace's own inbound pipeline. The receive worker recognises it and hands it
to a credential-free worker that opens the link with an empty-body POST. That
worker has four terminal outcomes: it publishes `GmailForwardingConfirmedEvent`
on success and `GmailForwardingConfirmFailedEvent` (with a reason —
`token-rejected`, `not-confirmed`, or `invalid-url`) for the three ways Google's
page can refuse; a transient 5xx/network error is left on the queue to retry and
eventually dead-letters to the operator.

**New in this snapshot:** the hutch `rewrite-gmail-filter` Lambda — which already
subscribed the *confirmed* fact — now also subscribes the *failed* fact through
one added EventBridge rule onto the same queue. A new handler stamps the reason
and a timestamp onto the connection row as `lastConfirmError`, but only when the
failed address is the connection's own gateway and the connection is not already
confirmed; otherwise it logs and skips. No new event, command, Lambda, queue,
metric, or alarm — the consumer rides the existing filter Lambda and its queue.

![Connecting a Gmail account, confirming the forwarding address, and recording a failed confirmation](diagrams/connect-and-confirm.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  U(["Reader on /integrations"]) --> C1["POST /integrations/gmail/connect"]:::cmd
  C1 --> S1["hutch web · sign state, redirect"]:::sys
  S1 --> G1{{"Google consent<br/>gmail.settings.basic"}}
  G1 --> C2["GET /integrations/gmail/callback"]:::cmd
  C2 --> S2["hutch web · verify state, exchange code"]:::sys
  S2 -->|refresh token| R1[("gmail-credentials")]:::store
  S2 -->|mint gateway alias| R2[("inbox-addresses<br/>purpose=gmail-forwarding")]:::store
  S2 -->|connection row| R3[("gmail-connections")]:::store

  R3 --> U2(["Reader pastes the gateway address<br/>into Gmail settings"])
  U2 --> G2{{"Google emails a confirmation link<br/>to the gateway address"}}
  G2 --> SES["SES → S3 → SNS → SQS"]:::queue
  SES --> S3["inbox · receive-email<br/>claims the confirmation"]:::sys
  S3 --> C3["ConfirmGmailForwardingCommand"]:::cmd
  C3 --> Q1["inbox-confirm-gmail-forwarding-q"]:::queue
  Q1 --> S4["inbox · confirm-gmail-forwarding<br/>empty-body POST to mail.google.com/mail/vf-…"]:::sys
  Q1 -.->|retries exhausted| D1["inbox shared failures DLQ<br/>→ operator email"]:::dlq
  S4 -->|"200, no submit form left"| E1["GmailForwardingConfirmedEvent"]:::evt
  S4 -->|"400 · interstitial · bad URL<br/>reason=token-rejected / not-confirmed / invalid-url"| E2["GmailForwardingConfirmFailedEvent"]:::evt
  S4 -.->|"5xx / network"| Q1

  E1 --> Q2["hutch-rewrite-gmail-filter-q"]:::queue
  E2 --> Q2
  Q2 --> S5["hutch · gmail-forwarding-confirmed<br/>mark confirmed, clear lastConfirmError"]:::sys
  Q2 --> S6["hutch · gmail-forwarding-confirm-failed<br/>stamp reason + time as lastConfirmError"]:::sys
  Q2 -.->|retries exhausted| D2["hutch-rewrite-gmail-filter-dlq<br/>→ operator email"]:::dlq
  S5 --> R3
  S5 --> C4["RewriteGmailFilterCommand<br/>reason=forwarding-confirmed"]:::cmd
  S6 -->|"gateway address · not yet confirmed"| R3
  S6 -.->|"named alias · already confirmed · no row"| SKIP["log and skip"]:::pol

  class S6,SKIP new;
  linkStyle 20,22,26,27 stroke:#a0660b,stroke-width:3px;
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8,color:#062b45;
  classDef sys fill:#fff2a8,stroke:#a08a00,color:#3d3400;
  classDef evt fill:#ffb976,stroke:#a85800,color:#3d1f00;
  classDef pol fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f2e1c;
  classDef queue fill:#e8e8e8,stroke:#666,color:#222;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3d0f0f;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#3d2600;
```

The four amber edges are the only wiring this snapshot adds: the failed fact's
new subscription onto the existing queue (`E2 → Q2`), its delivery to the new
handler (`Q2 → S6`), and the handler's two outcomes — stamping `lastConfirmError`
on the gateway's own unconfirmed row (`S6 → R3`) or logging and skipping
(`S6 ⇢ SKIP`). Every node they touch except `S6`/`SKIP` already existed.

</details>

---

## 2. What the reader sees, and the recovery loop

`gmailConnectionState` derives the connection's state from the row. It gains one
member — `confirm-failed` — returned when the forwarding address is still
unconfirmed **and** `lastConfirmError` is set. The check sits immediately before
`awaiting-confirmation`, so a row that later confirms (which clears
`lastConfirmError`) still reads as confirmed even if a stale error lingers, and a
duplicate delivery of an already-spent link is harmless.

The Gmail page keeps Step 2 on screen for both `awaiting-confirmation` and
`confirm-failed`, so the address, Copy and Open Gmail stay available. The badge
reads "Needs attention", an alert names what went wrong and tells the reader to
remove and re-add the address in Gmail, and the poll line keeps watching. The
status route now carries a `state` representation hint so the self-updating poll
fragment names which of the two waiting states it last rendered; a poll that
names the wrong state (or none — an open tab from before the deploy) gets one
full-page redirect and comes back naming the current state. When the reader
re-adds the address and Google confirms, the page flips to "Forwarding
confirmed." on its own, exactly as it did before.

![The reader-facing confirm-failed state and how re-adding the address recovers it](diagrams/reader-recovery.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  R3[("gmail-connections<br/>lastConfirmError set,<br/>forwardingConfirmedAt unset")]:::store --> ST{"gmailConnectionState"}
  ST -->|"confirmed later"| RTF["ready-to-filter / filtering"]:::pol
  ST -->|"unconfirmed + lastConfirmError"| CF["confirm-failed<br/>badge: Needs attention"]:::new

  CF --> PG["/integrations/gmail<br/>Step 2 kept · alert for the reason<br/>address · Copy · Open Gmail"]:::pol
  PG --> POLL["GET /integrations/gmail/status?state=confirm-failed<br/>watching for a new confirmation · every 3s, ≤100 ticks"]:::new
  POLL -->|"state matches"| POLL
  POLL -.->|"state missing or mismatched"| PG

  PG --> U(["Reader removes + re-adds the<br/>forwarding address in Gmail"])
  U --> G2{{"Google emails a fresh<br/>confirmation link"}}
  G2 --> S3["inbox · receive → confirm worker"]:::sys
  S3 --> E1["GmailForwardingConfirmedEvent"]:::evt
  E1 --> S5["hutch · mark confirmed<br/>REMOVE lastConfirmError"]:::sys
  S5 --> DONE["state = ready-to-filter<br/>page: Forwarding confirmed."]:::pol

  class CF,POLL new;
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
| `ConfirmGmailForwardingCommand` | inbox · confirm-gmail-forwarding | `GmailForwardingConfirmedEvent`, `GmailForwardingConfirmFailedEvent` | on success, the filter rewrite; on failure, the new consumer below |
| `GmailForwardingConfirmedEvent` | hutch · rewrite-gmail-filter Lambda (confirmed handler) | `RewriteGmailFilterCommand` | marks the connection confirmed and clears `lastConfirmError` first |
| **`GmailForwardingConfirmFailedEvent`** | **hutch · rewrite-gmail-filter Lambda (confirm-failed handler)** *(new consumer)* | — | **stamps `lastConfirmError` on the gateway's connection row; the page surfaces it** |
| `RewriteGmailFilterCommand` | hutch · rewrite-gmail-filter | `GmailFilterRewrittenEvent`, `GmailFilterRewriteFailedEvent` | terminal |
| `GmailFilterRewriteFailedEvent` | *(no consumer)* | — | surfaced on the page via `lastFilterError` |
| `DisconnectGmailCommand` | hutch · disconnect-gmail | `GmailDisconnectedEvent` | terminal |

`GmailForwardingConfirmFailedEvent` is the only wiring change: it joins
`RewriteGmailFilterCommand`, `GmailForwardingConfirmedEvent` and
`DisconnectGmailCommand` as the fourth detail type routed to the single hutch
`rewrite-gmail-filter` Lambda behind one SQS queue and one DLQ, split by
`detail-type` at the composition root. It carries its own stack-prefixed
EventBridge rule (`hutch-gmail-forwarding-confirm-failed`), so the rule can never
be silently upserted over another stack's. The Lambda already reads and updates
the `gmail-connections` table, so no new environment variable, table, or IAM
statement is added — the infrastructure preview is one new rule, one new target
on the existing queue, and the queue/DLQ policy growing by one source ARN, with
nothing replaced or deleted.

---

## Stores

| Store | Stack | Keys | Written by |
|---|---|---|---|
| `gmail-credentials` | hutch | hash `userId` | callback, disconnect |
| `gmail-connections` | hutch | hash `userId`, sparse `connected-index` | callback, confirm, **confirm-failed (new: `lastConfirmError`)**, rewrite, disconnect |
| `inbox-addresses` | inbox | hash `address`, `userId-index` | callback (gateway), sender mapping |

`lastConfirmError` is a new optional attribute on the `gmail-connections` row:
`{ reason, at }`, where `reason` is exactly the failed event's enum. It is
written by the new confirm-failed handler and removed by
`markForwardingConfirmed`, so a confirmation that lands after a failure leaves a
clean row. A missing attribute reads as `undefined`, so rows written before the
deploy stay `awaiting-confirmation` with no backfill.

---

## Known gaps at this commit

- **A confirmation that never arrives at all still reaches only the operator.**
  When Google is unreachable for every attempt, the confirm command dead-letters
  to the inbox shared failures DLQ and pages the operator; the reader gets the
  generic poll-exhausted copy, not a specific message. Reaching the reader from
  there would need the DLQ Lambda to publish onto the bus or write into another
  stack's table, and no such failure has been observed.
- **A failed confirmation of a *named* inbox alias is not stamped.** The new
  consumer marks the connection only when the failed address is the connection's
  own gateway, mirroring how the confirmed handler decides what to mark.
- **The three earlier gaps from `2026-08-28-ffa98af7` that remain:** account
  deletion still does not touch the Gmail stores; there is still no consumer for
  `GmailFilterRewriteFailed` or `GmailDisconnected`; and the filter query length
  cap is still unmeasured. Only the confirm-failed leg of "no consumer for the
  terminal facts" is closed here.
