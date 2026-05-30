# Deferred Subscription Cancellation Flow

> **Snapshot commit:** `60e8e699` (2026-05-28, branch `claude/laughing-dirac-QlUGH`)
>
> **Scope:** user-initiated cancel (`POST /account/cancel`), deferred-cancellation convergence (Stripe webhook + EventBridge Scheduler), reactivation (`POST /account/reactivate`), and the `pending_cancellation` access gate.

---

## Legend

```mermaid
flowchart LR
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event fill:#ffb976,stroke:#a85800,color:#000
    classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E["Event"]:::event
    P["Policy / reaction"]:::policy
    R["Read model / store"]:::store
    Q["Queue"]:::queue
    D["DLQ"]:::dlq
```

---

## Diagram 1 — Cancel flow (active + trialing)

User clicks Cancel on the account page. The SSR Lambda publishes `CancelSubscriptionCommand` via EventBridge. The `cancel-subscription` Lambda branches on the row's current status: paid users get a Stripe `cancel_at_period_end` PATCH, trial users get their trial-end schedule deleted. Both branches create a deferred-cancellation EventBridge Scheduler rule and emit `SubscriptionCancellationScheduledEvent`. The `handle-subscription-cancellation-scheduled` Lambda writes `status='pending_cancellation'` + `cancellationEffectiveAt` to the row.

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event fill:#ffb976,stroke:#a85800,color:#000
    classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000

    POST["POST /account/cancel<br/>(SSR Lambda)"]:::command
    CMD["CancelSubscriptionCommand<br/>(EventBridge)"]:::command
    Q1["cancel-subscription<br/>SQS queue"]:::queue
    DLQ1["cancel-subscription<br/>DLQ + email alarm"]:::dlq
    HANDLER["cancel-subscription<br/>Lambda"]:::system

    subgraph active ["active branch"]
        STRIPE_PATCH["Stripe PATCH<br/>cancel_at_period_end=true"]:::policy
        SCHED_A["Create deferred-cancellation<br/>EventBridge Scheduler<br/>(period_end + 1h)"]:::policy
    end

    subgraph trialing ["trialing branch"]
        DEL_TRIAL["Delete trial-end<br/>charge schedule"]:::policy
        SCHED_T["Create deferred-cancellation<br/>EventBridge Scheduler<br/>(trialEndsAt + 1h)"]:::policy
    end

    EVT["SubscriptionCancellation-<br/>ScheduledEvent"]:::event
    Q2["handle-subscription-<br/>cancellation-scheduled<br/>SQS queue"]:::queue
    DLQ2["handle-subscription-<br/>cancellation-scheduled<br/>DLQ + email alarm"]:::dlq
    SCHED_HANDLER["handle-subscription-<br/>cancellation-scheduled<br/>Lambda"]:::system
    DB["subscription_providers<br/>status=pending_cancellation<br/>cancellationEffectiveAt=…"]:::store

    POST --> CMD --> Q1 --> HANDLER
    Q1 -.->|retry exhaustion| DLQ1
    HANDLER -->|status=active| STRIPE_PATCH
    STRIPE_PATCH --> SCHED_A --> EVT
    HANDLER -->|status=trialing| DEL_TRIAL
    DEL_TRIAL --> SCHED_T --> EVT
    EVT --> Q2 --> SCHED_HANDLER --> DB
    Q2 -.->|retry exhaustion| DLQ2
```

---

## Diagram 2 — Convergence: deferred scheduler + Stripe webhook

Two paths drive the row from `pending_cancellation` to `cancelled`. The happy path is Stripe's `customer.subscription.deleted` webhook arriving before the scheduler fires. The defensive fallback is the deferred-cancellation EventBridge Scheduler firing `CancelSubscriptionCommand` at `cancellationEffectiveAt + 1h` against a row already in `pending_cancellation`. Both paths converge on `handle-subscription-cancelled`.

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event fill:#ffb976,stroke:#a85800,color:#000
    classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000

    subgraph happy ["Happy path (paid)"]
        STRIPE_WH["Stripe webhook<br/>customer.subscription.deleted"]:::command
        WH_RECV["stripe-webhook-receiver<br/>Lambda"]:::system
    end

    subgraph fallback ["Defensive fallback (paid + trial)"]
        SCHED_FIRE["Deferred-cancellation<br/>EventBridge Scheduler<br/>(cancellationEffectiveAt + 1h)"]:::policy
        CMD2["CancelSubscriptionCommand"]:::command
        CANCEL_Q["cancel-subscription<br/>SQS queue"]:::queue
        CANCEL_LAMBDA["cancel-subscription Lambda<br/>(pending_cancellation branch)"]:::system
    end

    EVT_CANCELLED["SubscriptionCancelledEvent"]:::event
    Q_HANDLE["handle-subscription-<br/>cancelled SQS queue"]:::queue
    DLQ_HANDLE["handle-subscription-<br/>cancelled DLQ + email alarm"]:::dlq
    HANDLE_LAMBDA["handle-subscription-<br/>cancelled Lambda"]:::system
    DB_CANCEL["subscription_providers<br/>status=cancelled"]:::store

    STRIPE_WH --> WH_RECV --> EVT_CANCELLED
    SCHED_FIRE --> CMD2 --> CANCEL_Q --> CANCEL_LAMBDA --> EVT_CANCELLED
    EVT_CANCELLED --> Q_HANDLE --> HANDLE_LAMBDA --> DB_CANCEL
    Q_HANDLE -.->|retry exhaustion| DLQ_HANDLE
```

---

## Diagram 3 — Reactivation flow

User clicks Reactivate on the account page while in `pending_cancellation`. The SSR Lambda deletes the deferred-cancellation schedule first (prevents re-cancel race), then branches: paid users get a Stripe PATCH to reverse `cancel_at_period_end` + row flipped to `active`; trial users get the trial-end charge schedule recreated + row flipped back to `trialing`. Both paths publish `SubscriptionReactivatedEvent` (no load-bearing handler today).

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event fill:#ffb976,stroke:#a85800,color:#000
    classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue fill:#e8e8e8,stroke:#666,color:#000

    REACT["POST /account/reactivate<br/>(SSR Lambda)"]:::command
    READ_ROW["Read row<br/>(must be pending_cancellation)"]:::system
    DEL_SCHED["Delete deferred-cancellation<br/>EventBridge Scheduler"]:::policy

    subgraph paid ["Paid branch (subscriptionId present)"]
        STRIPE_REV["Stripe PATCH<br/>cancel_at_period_end=false"]:::policy
        MARK_ACTIVE["markActiveSubscription"]:::store
    end

    subgraph trial ["Trial branch (no subscriptionId)"]
        CREATE_TRIAL["Create trial-end<br/>charge schedule"]:::policy
        UPSERT_TRIAL["upsertTrialingSubscription"]:::store
    end

    EVT_REACT["SubscriptionReactivatedEvent"]:::event

    REACT --> READ_ROW --> DEL_SCHED
    DEL_SCHED -->|subscriptionId| STRIPE_REV --> MARK_ACTIVE --> EVT_REACT
    DEL_SCHED -->|no subscriptionId| CREATE_TRIAL --> UPSERT_TRIAL --> EVT_REACT
```

---

## Diagram 4 — Access gate (pending_cancellation time window)

The SSR Lambda calls `initGetEffectiveAccess` on every request. A `pending_cancellation` row grants full access while `now() < cancellationEffectiveAt`, showing a `cancellation-scheduled` banner with a Reactivate CTA. Past that instant, the user drops to `inactive` / read-only.

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event fill:#ffb976,stroke:#a85800,color:#000
    classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000

    REQ["HTTP request<br/>(any authenticated route)"]:::command
    GATE["initGetEffectiveAccess"]:::system
    DB_READ["subscription_providers<br/>(DynamoDB GetItem)"]:::store
    CHECK["status = pending_cancellation?"]:::system
    BEFORE["now() < cancellationEffectiveAt"]:::policy
    AFTER["now() >= cancellationEffectiveAt"]:::policy
    FULL["access: full<br/>banner: cancellation-scheduled<br/>+ Reactivate CTA"]:::event
    READONLY["access: read-only<br/>banner: inactive"]:::event

    REQ --> GATE --> DB_READ --> CHECK
    CHECK -->|yes| BEFORE --> FULL
    CHECK -->|yes| AFTER --> READONLY
```

---

## Command → System → Event(s) reference table

| Command / Trigger | System | Event(s) emitted | Next command(s) |
|---|---|---|---|
| `POST /account/cancel` | SSR Lambda (hutch) | — | `CancelSubscriptionCommand` |
| `CancelSubscriptionCommand` (active row) | cancel-subscription Lambda | `SubscriptionCancellationScheduledEvent` | — (creates deferred-cancellation EventBridge Scheduler) |
| `CancelSubscriptionCommand` (trialing row) | cancel-subscription Lambda | `SubscriptionCancellationScheduledEvent` | — (deletes trial-end schedule, creates deferred-cancellation EventBridge Scheduler) |
| `CancelSubscriptionCommand` (pending_cancellation row) | cancel-subscription Lambda | `SubscriptionCancelledEvent` | — |
| `CancelSubscriptionCommand` (cancelled row) | cancel-subscription Lambda | — (noop) | — |
| `SubscriptionCancellationScheduledEvent` | handle-subscription-cancellation-scheduled Lambda | — (writes `pending_cancellation` row) | — |
| Deferred-cancellation EventBridge Scheduler (fires at `cancellationEffectiveAt + 1h`) | EventBridge Scheduler | — | `CancelSubscriptionCommand` (defensive fallback) |
| Stripe webhook `customer.subscription.deleted` | stripe-webhook-receiver Lambda | `SubscriptionCancelledEvent` | — |
| `SubscriptionCancelledEvent` | handle-subscription-cancelled Lambda | — (writes `cancelled` row) | — |
| `POST /account/reactivate` (paid) | SSR Lambda (hutch) | `SubscriptionReactivatedEvent` | — (deletes deferred-cancellation schedule, Stripe PATCH, markActive) |
| `POST /account/reactivate` (trial) | SSR Lambda (hutch) | `SubscriptionReactivatedEvent` | — (deletes deferred-cancellation schedule, creates trial-end schedule, upsertTrialing) |
