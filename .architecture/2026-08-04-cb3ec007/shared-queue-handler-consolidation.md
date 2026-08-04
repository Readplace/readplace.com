# Shared-Queue Handler Consolidation — One Lambda per Family, Routed by `detail-type` — Event Storming

**Base commit:** `cb3ec007` &nbsp;•&nbsp; **Commit date:** 2026-08-04 &nbsp;•&nbsp; **Generated:** 2026-08-04 &nbsp;•&nbsp; **Branch:** `main`
**Subject:** `refactor(hutch,@packages/hutch-infra-components): merge low-traffic handler families onto shared queues`

Nine SQS-backed Lambdas became two. **No command or event definition changed** — every `source`/`detailType` wire value, every schema, and every rule's event pattern is byte-identical to the previous snapshot. What changed is the *topology underneath* them: which queue a rule delivers to, and which process consumes it.

The forcing measurement: an **event source mapping, not a message, is the unit of SQS cost.** An idle queue produced exactly 360 empty receives per hour over 30 consecutive hours (min 359, max 360) — `2 pollers × 60s / 20s long poll`, AWS's documented idle floor — and that rate held to within 1.5% across a 539× swing in daily volume. Production moved ~37,600 messages in 30 days and spent ~15.4M SQS requests finding them: **410 polling calls per message delivered.** A queue + handler pair therefore costs ≈ $5.14/yr across both accounts *before it carries anything*, and the subscription/billing family — eight queues — moved 141 messages between them in 30 days.

- **Two families merged, chosen by runtime profile, not by intuition.** `subscription-events` (30 s visibility / 128 MB / 30 s) takes seven handlers; `user-data-jobs` (900 s / 1024 MB / 900 s) takes two. `send-trial-feedback-email` is **deliberately excluded** at 60/256/60 — folding it in would either halve its timeout or double the memory of the other seven. The digest pair is left alone: its producer/consumer self-loop and dedicated scheduler target are a different *shape*, not merely a different profile.
- **Routing is on `detail-type`, a discriminator the envelope already carries.** Every merged queue is EventBridge-fed, so each record's body is a full EventBridge envelope. `initHandleByDetailType` groups a batch's records by their registered handlers, invokes each handler once with its slice, and unions the `batchItemFailures`. A `detail-type` outside the table **fails that record to the DLQ** rather than defaulting — defaulting is how an unrouted billing event would vanish silently.
- **Only the composition roots merged.** Every domain handler under `src/runtime/<name>/<name>-handler.ts` and its tests are untouched: each still parses its own envelope, owns its own error handling, and returns its own partial-batch failures. The nine deleted files were `*.main.ts` wiring, nothing else.
- **`SubscriptionCancelled` had two subscribers, so its second rule is deleted** and the fan-out now happens inside one invocation. That couples their retries — a failure in the feedback scheduler re-runs the cancel marker. Both were verified idempotent before merging: `markCancelledByUserId` is an unconditional `SET status = cancelled` guarded only by `attribute_exists(userId)`, and the feedback scheduler deletes-then-creates a deterministic per-user schedule.
- **`HutchEventBus.subscribeAll` exists because SQS permits exactly one policy per queue.** N rules onto one queue cannot each mint their own `QueuePolicy`, so the new method creates one rule + one target per event and a *single* combined policy naming every rule ARN. The one-rule case keeps a **scalar** `aws:SourceArn` rather than a one-element array: IAM treats them identically, but the rendered JSON differs, and the scalar form is what keeps this a no-op for the ~40 existing subscriptions elsewhere in the fleet.
- **Observability collapses with the fleet.** Six `LAMBDA_NAMES` entries became one; `LOG_GROUPS`, the dashboard's origin filter, and the forwarder's source list all derive from it, so the collapse propagates atomically and the `satisfies` constraint makes a partial edit a compile error. Handler attribution survives in each line's message prefix (`[cancel-subscription]`, `[SubscriptionCancelled]`, …) rather than in the log-group name.
- **Two accepted trade-offs, both recorded rather than hidden.** The merged roles hold the *union* of their group's permissions (`user-data-jobs` additionally gains `events:PutEvents`, which `delete-account` lacked and `export-user-data` had). And `export-user-data` inherits `dlqMaxReceiveCount: 12` (was 3) — dropping to 3 would regress `delete-account`'s deliberate ride-out-an-Apple-outage window, the stronger of the two properties.

---

## Legend

New/changed pieces carry the amber **new** highlight (`fill:#ffd24c`, `stroke:#a0660b`, 3 px stroke); everything else is pre-existing infrastructure shown for context. Deleted infrastructure is drawn with a dashed stroke where it aids the comparison.

![Legend](diagrams/legend.svg)

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
    classDef gone    fill:#f0f0f0,stroke:#999,stroke-dasharray:5 5,color:#666

    C[Command]:::command
    S[System / aggregate]:::system
    E[Event]:::event
    P[Policy / reaction]:::policy
    R[Read model / store]:::store
    Q[(Queue)]:::queue
    D[(DLQ)]:::dlq
    N[New in this snapshot]:::new
    G[Deleted in this snapshot]:::gone
```

</details>

---

## 1. Topology — what the merge actually moved

Rules and their event patterns are unchanged and **update in place**; only each target's queue ARN moves. The one structural deletion is the duplicate `SubscriptionCancelled` rule, whose fan-out is now in-process.

![Topology before and after](diagrams/topology.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000
    classDef gone    fill:#f0f0f0,stroke:#999,stroke-dasharray:5 5,color:#666

    Bus["shared platform EventBridge bus<br/>(hutch-event-bus)"]:::system

    subgraph Rules["8 rules — patterns unchanged, targets repointed in place"]
        R1["cancel-subscription-command-rule"]:::system
        R2["subscription-cancellation-scheduled-rule"]:::system
        R3["subscription-cancelled-rule"]:::system
        R4["subscription-charge-failed-rule"]:::system
        R5["subscription-charge-succeeded-rule"]:::system
        R6["subscription-start-request-command-rule"]:::system
        R7["delete-account-command-rule"]:::system
        R8["export-user-data-command-rule"]:::system
    end

    Bus --> R1 & R2 & R3 & R4 & R5 & R6 & R7 & R8

    Dup["schedule-trial-feedback-email-rule<br/>2nd rule on SubscriptionCancelled —<br/>DELETED; fan-out is now in-process"]:::gone
    Bus -.-> Dup

    QA[("subscription-events-q<br/>visibility 30s")]:::new
    DA[("subscription-events-dlq<br/>1 alarm → SNS email")]:::new
    QB[("user-data-jobs-q<br/>visibility 900s,<br/>maxReceiveCount 12")]:::new
    DB[("user-data-jobs-dlq<br/>1 alarm → SNS email")]:::new

    R1 & R2 & R3 & R4 & R5 & R6 --> QA
    R7 & R8 --> QB
    QA -.->|"exhausted receives"| DA
    QB -.->|"exhausted receives"| DB

    PolA["subscription-events-queue-policy<br/>ONE policy naming all 6 rule ARNs —<br/>SQS allows exactly one per queue"]:::new
    PolB["user-data-jobs-queue-policy<br/>ONE policy naming both rule ARNs"]:::new
    QA --- PolA
    QB --- PolB

    LA["subscription-events-handler<br/>128MB / 30s / batchSize 1 /<br/>ReportBatchItemFailures"]:::new
    LB["user-data-jobs-handler<br/>1024MB / 900s / batchSize 1 /<br/>ReportBatchItemFailures"]:::new
    QA -->|"1 event source mapping"| LA
    QB -->|"1 event source mapping"| LB

    Old["DELETED: 9 queues + 9 DLQs +<br/>9 mappings + 9 alarms + 9 roles<br/>(log groups retained)"]:::gone
    LA -.-> Old
    LB -.-> Old
```

</details>

---

## 2. The router — one process, many handlers

`initHandleByDetailType` is the only new logic in the change. It never parses a `detail`; it reads `detail-type` alone and hands whole records onward, so each domain handler keeps sole ownership of its own schema.

![Detail-type router](diagrams/router.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    In[("SQS batch of EventBridge envelopes")]:::queue
    Parse["parse envelope — reads<br/>'detail-type' ONLY;<br/>'detail' stays opaque here"]:::new
    In --> Parse

    Miss["unregistered detail-type →<br/>assert fails → that record<br/>reported as a batch item failure"]:::new
    Parse -->|"no route"| Miss
    DLQ[("DLQ after maxReceiveCount<br/>→ alarm → SNS email")]:::dlq
    Miss --> DLQ

    Group["group records by handler —<br/>a type with N handlers adds the<br/>record to each of them"]:::new
    Parse -->|"routed"| Group

    H1["handler A — invoked once<br/>with its own slice"]:::system
    H2["handler B — invoked once<br/>with its own slice"]:::system
    Group --> H1 & H2

    Own["each handler parses its own<br/>detail schema, logs its own<br/>prefix, returns its own failures"]:::system
    H1 --> Own
    H2 --> Own

    Union["union batchItemFailures into a Set —<br/>a record failed by two fan-out handlers<br/>is reported once"]:::new
    Own --> Union
    Union --> Out["SQSBatchResponse"]:::system
    Union -.->|"redelivery"| In
```

</details>

---

## 3. Subscription lifecycle — complete current state

Every arrow below already existed; what changed is that all six boxes now run **inside one Lambda**. Producers are unchanged: the hutch web Lambda, the Stripe webhook receiver, EventBridge Scheduler one-shots, and the family's own handlers publishing back onto the bus.

![Subscription lifecycle](diagrams/subscription-lifecycle.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    Web["POST /account/cancel<br/>(hutch web Lambda)"]:::command
    Sched1["EventBridge Scheduler one-shot<br/>trial-end, created at signup"]:::policy
    Sched2["EventBridge Scheduler one-shot<br/>deferred cancellation<br/>(effective-at + 1h)"]:::policy
    Hook["Stripe webhook receiver<br/>customer.subscription.deleted"]:::policy

    CSR["SubscriptionStartRequestCommand"]:::command
    CSC["CancelSubscriptionCommand"]:::command
    Sched1 --> CSR
    Sched2 --> CSC
    Web --> CSC

    subgraph L["subscription-events-handler — ONE Lambda, ONE queue, ONE mapping"]
        direction TB
        HSR["subscription-start-request<br/>row missing / not trialing → noop"]:::new
        HCS["cancel-subscription<br/>branches on row status"]:::new
        HCancelled["handle-subscription-cancelled<br/>SET status=cancelled"]:::new
        HFeedback["schedule-trial-feedback-email<br/>trial reasons only"]:::new
        HSched["handle-subscription-cancellation-scheduled<br/>SET pending_cancellation"]:::new
        HOK["subscription-charge-succeeded<br/>upsertActive"]:::new
        HFail["subscription-charge-failed"]:::new
    end

    CSR --> HSR
    CSC --> HCS

    ChargeOK["SubscriptionChargeSucceeded"]:::event
    ChargeNo["SubscriptionChargeFailed<br/>no_card_on_file | stripe_error"]:::event
    HSR --> ChargeOK
    HSR --> ChargeNo
    ChargeOK --> HOK
    ChargeNo --> HFail
    HFail -->|"closes the loop"| CSC

    SchedEv["SubscriptionCancellationScheduled"]:::event
    HCS -->|"active / trialing"| SchedEv
    SchedEv --> HSched
    HCS -->|"active / trialing"| Sched2

    Cancelled["SubscriptionCancelled"]:::event
    HCS -->|"pending_cancellation →<br/>final conversion"| Cancelled
    Hook --> Cancelled

    FanOut["ONE rule, ONE queue record →<br/>BOTH handlers in ONE invocation<br/>(2nd rule deleted)"]:::new
    Cancelled --> FanOut
    FanOut --> HCancelled
    FanOut --> HFeedback

    Sched3["EventBridge Scheduler one-shot<br/>trial feedback, +3 days,<br/>deterministic name per user"]:::policy
    HFeedback --> Sched3
    STFE["SendTrialFeedbackEmailCommand"]:::command
    Sched3 --> STFE

    Sep["send-trial-feedback-email-handler<br/>60/256/60 — SEPARATE by design;<br/>profile does not match the seven"]:::system
    STFE --> Sep

    Table[("hutch-subscription-providers<br/>merged grant: GetItem + UpdateItem")]:::store
    HSR --> Table
    HCS --> Table
    HCancelled --> Table
    HSched --> Table
    HOK --> Table

    Analytics["subscriptions stream →<br/>forwarder → /readplace/analytics"]:::store
    HCancelled --> Analytics
    HOK --> Analytics
    HFail --> Analytics
```

</details>

---

## 4. User data jobs — the two long-running data-rights commands

Both were already EventBridge-fed commands with an identical 900/1024/900 profile. `remove-my-content-command` is **not** here: it lives in `projects/save-link`, and merging across independently deployable Pulumi stacks would couple their release cadence.

![User data jobs](diagrams/user-data-jobs.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    WebE["POST /export (hutch web Lambda)"]:::command
    WebD["POST /account/delete<br/>(typed-phrase confirmation)"]:::command
    EUD["ExportUserDataCommand"]:::command
    DAC["DeleteAccountCommand"]:::command
    WebE --> EUD
    WebD --> DAC

    Q[("user-data-jobs-q — 900s visibility,<br/>maxReceiveCount 12 (was 3 for export):<br/>the scrub's Apple-outage window is the<br/>stronger of the two properties")]:::new
    EUD --> Q
    DAC --> Q

    subgraph L["user-data-jobs-handler — ONE Lambda, 1024MB / 900s"]
        HE["export-user-data<br/>paged article read → archive"]:::new
        HD["delete-account<br/>converges on partial state by design"]:::new
    end
    Q --> HE
    Q --> HD

    S3E[("user-export bucket<br/>read + write + TTL lifecycle")]:::store
    HE --> S3E
    Mail["Resend email with presigned URL<br/>(reserved domains skipped)"]:::system
    HE --> Mail
    Exported["UserDataExported /<br/>UserDataExportFailed"]:::event
    HE --> Exported

    Stripe["Stripe deleteCustomer —<br/>404 treated as success so a<br/>redrive converges"]:::system
    HD --> Stripe
    Scheds["delete 5 per-user schedules<br/>(all ResourceNotFound-idempotent)"]:::system
    HD --> Scheds
    Stores[("users, sessions, oauth, articles,<br/>user-articles, digest queue, reader-ready,<br/>onboarding, prefs, subscriptions,<br/>4 inbox tables, 3 token tables")]:::store
    HD --> Stores
    S3D[("raw-email, content, user-export —<br/>DeleteObject + ListBucket")]:::store
    HD --> S3D
    Idp["revoke Apple refresh token —<br/>fails closed on an Apple outage"]:::system
    HD --> Idp

    D[("user-data-jobs-dlq → alarm → SNS email")]:::dlq
    Q -.->|"12 receives ≈ 3h"| D
```

</details>

---

## Command → System → Event(s) reference table

No wire value changed. The **System** column is what this snapshot re-writes.

| Command / trigger | System (handler) | Event(s) emitted | Next command(s) triggered |
|---|---|---|---|
| `POST /account/cancel`; `subscription-charge-failed`; deferred-cancellation Scheduler one-shot | **`subscription-events` Lambda** (was `cancel-subscription`) — branches on row status: `active` → Stripe `cancel_at_period_end` + deferred schedule; `trialing` → delete trial-end schedule + deferred schedule; `pending_cancellation` → final conversion; `cancelled` → noop; **missing row → warn + noop** | `SubscriptionCancellationScheduled` (active/trialing) or `SubscriptionCancelled` (pending_cancellation) | — |
| `SubscriptionCancellationScheduled` | **`subscription-events` Lambda** (was `handle-subscription-cancellation-scheduled`) | — (store-only: `status='pending_cancellation'` + `cancellationEffectiveAt`) | — |
| `SubscriptionCancelled` — **one rule, two handlers, one invocation** | **`subscription-events` Lambda** (was two Lambdas on two queues): `handle-subscription-cancelled` marks the row cancelled and emits the `cancelled` analytics line; `schedule-trial-feedback-email` creates the +3-day one-shot for trial reasons only, non-trial → noop | — (store + scheduler writes; analytics stream) | `SendTrialFeedbackEmailCommand`, via the one-shot |
| `SubscriptionStartRequestCommand` — trial-end Scheduler one-shot | **`subscription-events` Lambda** (was `subscription-start-request`) — row missing or not `trialing` → noop; `trialing` + `customerId` → Stripe `subscriptions.create`; `trialing` without → immediate failure | `SubscriptionChargeSucceeded` or `SubscriptionChargeFailed` | — |
| `SubscriptionChargeSucceeded` | **`subscription-events` Lambda** (was `subscription-charge-succeeded`) | — (store-only: `upsertActive`; analytics stream) | — |
| `SubscriptionChargeFailed` | **`subscription-events` Lambda** (was `subscription-charge-failed`) | — (analytics stream) | `CancelSubscriptionCommand` — closes the loop through the same queue |
| `SendTrialFeedbackEmailCommand` — Scheduler one-shots + Stripe `invoice.payment_failed` | `send-trial-feedback-email` Lambda — **unchanged, still its own queue and mapping** (60/256/60 does not match the family) | — | — |
| `DeleteAccountCommand` | **`user-data-jobs` Lambda** (was `delete-account`) | — | `RemoveMyContentCommand` is *not* involved; content erasure for the queue path lives in save-link |
| `ExportUserDataCommand` | **`user-data-jobs` Lambda** (was `export-user-data`) | `UserDataExported` / `UserDataExportFailed` | — |
| Any record whose `detail-type` is not in the route table | **`initHandleByDetailType`** — `assert` fails, record reported as a batch item failure | — | → DLQ → alarm → SNS email |

**Wire formats** (deployment contracts, all unchanged): `hutch.subscriptions` / `CancelSubscriptionCommand`, `SubscriptionCancellationScheduled`, `SubscriptionCancelled`, `SubscriptionChargeSucceeded`, `SubscriptionChargeFailed`, `SubscriptionStartRequestCommand`, `SendTrialFeedbackEmailCommand`; `hutch.api` / `DeleteAccountCommand`, `ExportUserDataCommand`. All ride the shared platform-stack EventBridge bus.

---

## Fleet effect

| | Before | After |
|---|---:|---:|
| Event source mappings (this change's families) | 9 | 2 |
| DLQ alarms + SNS topics + email subscriptions | 9 | 2 |
| Main queues + DLQs | 18 | 4 |
| EventBridge rules | 9 | 8 |
| Account-wide mappings (staging, measured) | 62 | 55 |

Verified on staging by a targeted apply before landing: all eight `detail-type`s processed on the merged Lambdas, the `SubscriptionCancelled` fan-out ran both handlers in a single invocation, no DLQ arrivals, no traffic reaching the old Lambdas — then reverted, leaving the stack byte-identical.
