# Billing Plan on the Trial-End Charge Chain — Event Storming

**Base commit:** `d581f65d8` &nbsp;•&nbsp; **Commit date:** 2026-09-01 &nbsp;•&nbsp; **Generated:** 2026-09-02 &nbsp;•&nbsp; **Branch:** `main`
**Subject:** `refactor(@packages/web-shell): name the reader-failure banner's clicks after where they happen`

> **Dirty-tree snapshot.** The 3-tier pricing change documented here is **uncommitted** on top of `d581f65d8` at generation time. This document describes the working tree as it stands, not the commit. The wire-format change that mandates this snapshot is one line — an optional `plan` field on `SubscriptionChargeSucceededEvent`'s detail schema in the shared event catalogue — but the flows it rides through are shown in their complete current state.

This snapshot extends the trial-end conversion chain first mapped in
[`2026-05-24-bf80b57a`](../2026-05-24-bf80b57a/trial-end-conversion-flow.md) and re-wired onto a
shared queue in [`2026-08-04-cb3ec007`](../2026-08-04-cb3ec007/). Pricing goes from one
subscription price to three self-serve tiers — **monthly $10/mo**, **yearly $60/yr** (featured),
**triennial $108/3yr** — and the trial-end charge chain must now know *which* tier to charge and
*record* which tier it charged:

1. **The producer picks the plan.** The `subscription-start-request` handler (inside the shared
   `subscription-events` Lambda) resolves `plan = row.plan ?? DEFAULT_BILLING_PLAN` (`"yearly"`),
   charges Stripe at `stripePriceIds[plan]`, and stamps the resolved plan onto the
   `SubscriptionChargeSucceeded` event it publishes. In the current tree a trialing row is always
   plan-less (`upsertTrialing` REMOVEs the attribute), so the default is the live path; the
   `row.plan` read is the seam through which a future plan-choosing trial signup flows with no
   further wire change.
2. **The consumer records the plan the charge was made on.** The `subscription-charge-succeeded`
   handler forwards `detail.plan` into `upsertActive`, which SETs the row's `plan` attribute when
   the event carries one and REMOVEs it when it does not.
3. **Absence is meaningful, not back-compat convenience.** Internal contracts in this repo prefer
   required fields, but a `SubscriptionChargeSucceeded` event already enqueued at deploy time was
   charged at the legacy single $49/yr price — none of the three new tiers describes it, so
   recording one would be false. The absent field flows through to a plan-less row: the
   subscriber keeps their existing Stripe subscription and price (nothing in the app re-prices
   it), i.e. they are grandfathered. Making the field required would only dead-letter those
   in-flight events, and a redrive still could not conjure a true plan for them.

What is new in this snapshot (highlighted `:::new` in every diagram):

- **`plan` on `SubscriptionChargeSucceededEvent.detailSchema`** — `z.enum(["monthly", "yearly",
  "triennial"]).optional()`. The only wire-format change in the catalogue; `SubscriptionStartRequestCommand`
  and `SubscriptionChargeFailedEvent` are untouched.
- **`BillingPlan` union + `DEFAULT_BILLING_PLAN`** (`"yearly"`) in the provider contracts, with
  the tier table and display strings in the web shell's pricing module.
- **`stripePriceIds: Record<BillingPlan, string>`** replaces the scalar `stripePriceId` in both
  composition roots that talk to Stripe. Three env vars — `STRIPE_PRICE_ID_MONTHLY`,
  `STRIPE_PRICE_ID_YEARLY`, `STRIPE_PRICE_ID_TRIENNIAL` — replace `STRIPE_PRICE_ID` on the
  SSR Lambda and the `subscription-events` Lambda. No IAM, queue, rule, or schedule changes.
- **`upsertActive` gains optional `plan`** — SET when present, REMOVE when absent, so a
  redelivered legacy event converges on the grandfathered plan-less row instead of leaving a
  stale attribute behind. `upsertTrialing` now REMOVEs `plan` alongside the other
  subscription-scoped attributes.
- **`plan` on the DynamoDB row schema** — parsed tolerantly (`.catch(undefined)`): every read of
  the row feeds the save gate and the header banner, so one malformed attribute degrades to
  "no plan" rather than locking the account.
- **The synchronous plan writers** — the same three-tier choice rides the checkout flows that
  write the row directly without touching this event: the subscribe-plans popover posts a
  `plan` to `POST /account/subscribe`; Stripe Checkout sessions are created at
  `stripePriceIds[plan]` and the pending-signup row carries the plan to
  `GET /auth/checkout/success`; the one-click resubscribe charges
  `chosenPlan ?? row.plan ?? DEFAULT_BILLING_PLAN`. All converge on the same `upsertActive`
  write the event consumer uses.

> Snapshots are historical. Any file path referenced below may be renamed, moved, or deleted in
> the future. Treat as an artefact, not a live guide.

---

## Legend

Every node in the diagrams below carries one of these roles. Nodes drawn with a thick amber
border (`:::new`) are the ones this snapshot introduces or changes — here that is the `plan`
field riding the success event, the producer's plan resolution and per-plan price lookup, and
the consumer's plan-recording write.

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

## 1. Trial-end conversion chain — complete current state

At trial signup the SSR Lambda writes the plan-less trialing row and creates the one-shot
EventBridge Schedule `trial-end-<userId>` firing at `trialEndsAt`. Since
[`2026-08-04-cb3ec007`](../2026-08-04-cb3ec007/) the whole subscription state machine shares
**one** SQS queue and **one** Lambda: six EventBridge rules — one per command/event, each named
`<event-name>-rule` — converge on the `subscription-events` queue, whose single queue policy
admits all six, and the Lambda routes each record on the envelope's `detail-type`. The chain
below therefore re-enters the same queue and Lambda at every hop.

The typical trial has no card on file, so the typical path is still charge-failed →
cancel chain. The charging path — a trialing row that *does* hold a `customerId` (attached
out-of-band; no current flow writes one while the row stays trialing) — is where the plan now
rides: the handler resolves the plan, charges that tier's price id, and publishes the fact with
the plan on it, so the row records the plan the charge was actually made on rather than
whatever the pricing table says at read time.

![Trial-end conversion chain with the plan riding the charge-succeeded event](diagrams/trial-end-conversion-chain.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  U(["Trial signup — email, Google or Apple"]) --> S0["hutch web · start trial"]:::sys
  S0 -->|"upsertTrialing<br/>REMOVEs plan among the<br/>subscription-scoped attributes"| ROW[("subscription_providers<br/>status=trialing, plan-less")]:::store
  S0 -->|"createTrialEndSchedule<br/>one-shot, fires at trialEndsAt"| SCHED["EventBridge Scheduler<br/>group hutch-trial-end-stage<br/>trial-end-userId"]:::pol

  SCHED -->|"events PutEvents via<br/>scheduler execution role"| BUS["hutch event bus"]:::sys
  BUS --> CMD["SubscriptionStartRequestCommand<br/>userId"]:::cmd
  CMD -->|"subscription-start-request-command-rule"| Q[("subscription-events queue<br/>visibility 30s · batch 1<br/>shared by all six detail-types")]:::queue
  Q --> L["subscription-events Lambda<br/>128 MB / 30 s<br/>routes on detail-type"]:::sys
  Q -.->|"retries exhausted"| DLQ[("subscription-events DLQ")]:::dlq
  DLQ -.->|"CloudWatch alarm + SNS email"| OP(["operator"])

  L -->|"SubscriptionStartRequestCommand"| H1["start-request handler<br/>findByUserId"]:::sys
  ROW -.->|"read"| H1
  H1 -->|"row missing or not trialing"| NOOP["idempotent noop —<br/>already converted or cancelled"]:::pol
  H1 -->|"trialing, no customerId<br/>typical no-card path"| FP1["publish charge-failed<br/>reason no_card_on_file"]:::pol
  H1 -->|"trialing with customerId"| PLAN["resolve plan =<br/>row.plan ?? yearly default"]:::sys
  PLAN --> STRIPE{{"Stripe POST /v1/subscriptions<br/>price = stripePriceIds of plan"}}
  STRIPE -->|"2xx + subscriptionId"| SP["publish charge-succeeded<br/>carrying the resolved plan"]:::pol
  STRIPE -->|"non-2xx / throw"| FP2["publish charge-failed<br/>reason stripe_error"]:::pol

  SP --> ESUC["SubscriptionChargeSucceededEvent<br/>userId, subscriptionId, customerId,<br/>plan optional — monthly, yearly, triennial"]:::evt
  ESUC --> BUS
  BUS -->|"subscription-charge-succeeded-rule<br/>same shared queue"| Q
  L -->|"SubscriptionChargeSucceeded"| H2["charge-succeeded handler<br/>upsertActive with detail.plan"]:::sys
  H2 -->|"SET plan when present<br/>REMOVE plan when absent"| ROWA[("subscription_providers<br/>status=active<br/>plan records the charged tier,<br/>absent = grandfathered legacy price")]:::store

  FP1 --> EFAIL["SubscriptionChargeFailedEvent<br/>userId, reason"]:::evt
  FP2 --> EFAIL
  EFAIL --> BUS
  BUS -->|"subscription-charge-failed-rule<br/>same shared queue"| Q
  L -->|"SubscriptionChargeFailed"| H3["charge-failed handler"]:::sys
  H3 --> CCMD["CancelSubscriptionCommand"]:::cmd
  CCMD --> BUS
  BUS -->|"cancel-subscription-command-rule<br/>same shared queue"| Q
  L -->|"CancelSubscriptionCommand"| H4["cancel chain —<br/>cancel-subscription, then<br/>cancelled handlers via the<br/>same queue, markCancelledByUserId"]:::sys
  H4 -->|"status=cancelled"| ROW

  class PLAN,STRIPE,ESUC,H2,ROWA new;
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

## 2. Where the row's plan comes from — the synchronous writers

The event consumer's `upsertActive` is one of three writers of the plan-bearing row; the other
two are synchronous request-path writes that never touch `SubscriptionChargeSucceeded` but must
stay shape-consistent with it. The plan choice enters through the subscribe-plans popover — a
three-panel grid rendered on `/account` and the queue's subscription banner, each panel a form
posting its tier as a hidden `plan` input to `POST /account/subscribe` (an unknown value is a
400; an absent one falls back per branch below). The home page renders the same tier table as
marketing copy; its CTAs lead into signup, not into this POST.

The `row.plan ?? …` fallback in the one-click resubscribe is the same seam the trial-end
handler uses: a cancelled subscriber who re-subscribes without re-choosing gets the tier their
row last recorded, and a grandfathered (plan-less) one gets the default.

![The synchronous plan writers converging on the same row shape](diagrams/plan-writers.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  U(["Reader picks a tier —<br/>subscribe-plans popover on<br/>/account or the queue banner"]) --> C1["POST /account/subscribe<br/>body plan optional,<br/>unknown value = 400"]:::cmd
  C1 --> S1["hutch web ·<br/>pickSubscribeBranch on row.status"]:::sys
  ROW0[("subscription_providers row")]:::store -.->|"findByUserId"| S1

  S1 -->|"trialing"| B1["startCheckout<br/>plan = chosen ?? yearly default<br/>trial preserved when time remains"]:::sys
  S1 -->|"cancelled with customerId"| B2["one-click resubscribe<br/>plan = chosen ?? row.plan<br/>?? yearly default"]:::sys
  S1 -->|"cancelled without customerId"| B1
  S1 -->|"active or pending — noop"| NOOP["303 back to /account"]:::pol

  B1 --> CK{{"Stripe Checkout session<br/>price = stripePriceIds of plan"}}
  B1 -->|"stores the chosen plan"| PS[("pending_signups row<br/>plan attribute")]:::store
  CK -->|"payment completes"| C2["GET /auth/checkout/success"]:::cmd
  C2 --> S2["hutch web ·<br/>consumePendingSignup, then<br/>delete trial schedules,<br/>create charge reminder"]:::sys
  PS -.->|"single use"| S2
  S2 -->|"upsertActive with pending.plan"| ROWA[("subscription_providers<br/>status=active, plan recorded")]:::store

  B2 --> SC{{"Stripe POST /v1/subscriptions<br/>price = stripePriceIds of plan"}}
  SC -->|"2xx"| W2["upsertActive with plan —<br/>synchronous, no event"]:::sys
  W2 --> ROWA
  SC -->|"declined / throw"| B1F["checkout fallback,<br/>same resolved plan"]:::sys
  B1F --> CK

  class C1,B1,B2,CK,SC,PS,S2,W2,ROWA,B1F new;
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

| Command / Event | Handler | Side effects | Emits |
|---|---|---|---|
| EventBridge Scheduler fires at `trialEndsAt` | EventBridge Scheduler service (managed) | `events:PutEvents` to the hutch bus via the scheduler execution role | `SubscriptionStartRequestCommand` |
| `SubscriptionStartRequestCommand` (userId) | `subscription-events` Lambda → start-request handler | Reads the row; **NEW:** resolves `plan = row.plan ?? "yearly"` and calls Stripe `subscriptions.create` at `stripePriceIds[plan]` | `SubscriptionChargeSucceededEvent` (**NEW:** carrying `plan`) OR `SubscriptionChargeFailedEvent` |
| `SubscriptionChargeSucceededEvent` (userId, subscriptionId, customerId, **plan?**) | `subscription-events` Lambda → charge-succeeded handler | **NEW:** `upsertActive` forwards `detail.plan` — SET when present, REMOVE when absent | (terminal — no downstream event) |
| `SubscriptionChargeFailedEvent` (userId, reason) | `subscription-events` Lambda → charge-failed handler | Dispatches the cancel command (Event → Command) | `CancelSubscriptionCommand` |
| `CancelSubscriptionCommand` (userId, reason) | `subscription-events` Lambda → cancel-subscription handler | Deletes trial schedules; per-status branch; downstream cancelled handlers flip the row | `SubscriptionCancelledEvent` or `SubscriptionCancellationScheduledEvent` |
| Reader posts a tier to `/account/subscribe` (trialing) | SSR Lambda (synchronous) | **NEW:** Stripe Checkout session at `stripePriceIds[plan]`; pending-signup row stores `plan` | (terminal — 303 to Stripe Checkout) |
| Stripe redirects to `/auth/checkout/success` | SSR Lambda (synchronous) | **NEW:** `upsertActive` with `pending.plan`; deletes trial schedules; creates the charge reminder | (terminal — 303 to return URL) |
| Reader posts a tier to `/account/subscribe` (cancelled + customerId) | SSR Lambda (synchronous) | **NEW:** Stripe `subscriptions.create` at `stripePriceIds[chosen ?? row.plan ?? "yearly"]` + `upsertActive` with that plan | (terminal — 303 to /account; decline falls back to Checkout at the same plan) |

---

## Trust boundaries

Nothing structural changes: no new Lambda, queue, rule, schedule, table, or IAM statement. The
whole change is wire-format plus configuration.

The `subscription-events` Lambda (shared subscription state machine):

- **IAM**: unchanged — DynamoDB `GetItem`/`UpdateItem` on `subscription_providers`, EventBridge
  `PutEvents`, scheduler manage policy, Stripe via HTTPS.
- **Environment**: `STRIPE_PRICE_ID` → **`STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_YEARLY` /
  `STRIPE_PRICE_ID_TRIENNIAL`**. The composition root builds `stripePriceIds` from the three
  required accessors, so a missing tier fails the boot, not the charge.

The SSR Lambda (request-response composition root):

- **IAM**: unchanged.
- **Environment**: same three-way price-id swap as above.

---

## Failure paths

| Failure point | Behaviour | Recovery |
|---|---|---|
| `SubscriptionChargeSucceeded` enqueued **before** the deploy, consumed after | Detail has no `plan`; schema accepts it; `upsertActive` REMOVEs the row's `plan` | Correct by design — that charge was made at the legacy single price; the row reads as grandfathered and the subscriber's Stripe subscription is untouched |
| A tier's price-id env var missing at deploy | `requireEnv` throws at composition-root load — the Lambda fails to boot | Fix the stack config; no partial pricing table can ever serve traffic |
| Stripe declines the trial-end charge | Handler publishes charge-failed (`stripe_error`) → cancel chain, as before | Row ends up cancelled; a later one-click resubscribe reuses `row.plan` if any was recorded |
| Redelivery of a plan-carrying success event | `upsertActive` is idempotent — same SET, same row | No drift |
| Redelivery interleaved with a plan-less legacy event | Last write wins; the legacy event REMOVEs, the plan-carrying one SETs | Whichever fact arrived last is what the row records — both describe real charges, and the operator can redrive from the DLQ in order |
| Malformed `plan` attribute on a stored row | The row schema's tolerant parse degrades it to `undefined` | Reads (save gate, banner, `/account`) see a plan-less row instead of a locked account; the next plan-carrying write repairs it |
| Records exhausting SQS retries | Shared `subscription-events` DLQ + CloudWatch alarm + SNS email | Operator redrive, unchanged from the consolidation snapshot |

---

## Why `plan` is optional on an internal event

This repo's testing conventions demand required fields on internal contracts — producer and
consumer deploy together, so the compiler should force every producer to supply the value. The
`plan` field is the documented exception, and the reasoning is recorded here because the schema
line alone looks like the forbidden "optional for backward compatibility":

- A `SubscriptionChargeSucceeded` sitting in the queue across the deploy describes a charge made
  at the legacy $49/yr price. None of `monthly`/`yearly`/`triennial` is true of it.
- The absence therefore *is* the datum: it flows through `upsertActive`'s REMOVE branch into the
  plan-less row that the read side treats as grandfathered. That is the semantically-optional
  carve-out — modelling reality, not tolerating a sloppy producer.
- Every in-repo producer today (`subscription-start-request` is the only one) supplies the field
  unconditionally; the type on the publisher contract (`PublishSubscriptionChargeSucceeded`)
  requires it, so the compiler still forbids a producer dropping it. Only the wire schema, which
  must also describe pre-deploy history, admits absence.
