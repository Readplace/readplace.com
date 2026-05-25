# Decoupled card capture and subscription creation

Snapshot of the post-decoupling subscription state machine. The single
"Subscribe — $3.99/month" button has been split into two stages: card
capture via Stripe Checkout `mode=setup`, then a deferred off-session
charge driven by the existing trial-end scheduler OR a new
`PaymentMethodAddedEvent` (for users who add a card after their trial
has lapsed or after a cancellation).

The auto-cancel-on-decline cascade (`SubscriptionChargeFailedEvent` →
`CancelSubscriptionCommand` → row flips to `cancelled`) is gone.
Charge failures are now persisted on the row (`chargeFailedAt` +
`chargeFailedReason`) and surfaced as a warning banner on `/account`;
SQS retry exhaustion still pages the operator via the standard DLQ +
SNS alarm.

## Legend

| Role | Fill | Stroke |
|---|---|---|
| Command | `#a6d8ff` | `#1e6fb8` |
| System / aggregate | `#fff2a8` | `#a08a00` |
| Event | `#ffb976` | `#a85800` |
| Policy / reaction | `#d6b8ff` | `#6b3fb0` |
| Read model / store | `#b8e8c5` | `#2f7a45` |
| Queue | `#e8e8e8` | `#666` |
| DLQ | `#f8c8c8` | `#a83434` |
| **New / changed in this snapshot** | `#ffd24c` | `#a0660b` (3px) |

```mermaid
flowchart LR
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8;
  classDef sys fill:#fff2a8,stroke:#a08a00;
  classDef evt fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;

  L1((Legend)):::sys
  L2[Command]:::cmd
  L3[System]:::sys
  L4[Event]:::evt
  L5[Reaction / Lambda]:::policy
  L6[(Store / row)]:::store
  L7[/SQS Queue/]:::queue
  L8[/DLQ + SNS/]:::dlq
  L9[NEW or CHANGED]:::new
```

## Card capture (Add payment method)

```mermaid
flowchart TD
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8;
  classDef sys fill:#fff2a8,stroke:#a08a00;
  classDef evt fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;

  U([User clicks Add payment method]):::sys
  U --> POST[/POST /account/payment-method/]:::cmd
  POST --> ENSURE[ensureCustomerId]:::policy
  ENSURE --> STRIPE_CUST[Stripe createCustomer]:::sys
  STRIPE_CUST --> UPSERT_CUST[(upsertCustomerId<br/>attribute_not_exists)]:::store
  UPSERT_CUST -->|ok or read winner| CHECKOUT[Stripe Checkout<br/>mode=setup]:::sys
  CHECKOUT -->|303 / HX-Redirect| BROWSER([Browser at Stripe])
  BROWSER --> RETURN[/GET /account/payment-method/success?session_id/]:::cmd
  RETURN -->|render auto-submit POST| POSTFIN[/POST /account/payment-method/finalize/]:::cmd
  POSTFIN --> RETRIEVE[Stripe retrieveSetupCheckoutSession<br/>expand setup_intent.payment_method]:::sys
  RETRIEVE --> PUB_ADD[publish AddPaymentMethodCommand]:::new

  PUB_ADD -.->|EventBridge| Q_ADD[/add-payment-method SQS/]:::queue
  Q_ADD --> L_ADD[add-payment-method Lambda]:::new
  L_ADD --> STRIPE_PATCH[Stripe Customer PATCH<br/>invoice_settings.default_payment_method<br/>Idempotency-Key]:::sys
  L_ADD --> UPSERT_PM[(upsertPaymentMethod<br/>brand, last4, clear chargeFailed*)]:::store
  L_ADD --> EMIT_ADDED[PaymentMethodAddedEvent]:::new
  L_ADD -.->|throw on Stripe error| DLQ_ADD[/add-payment-method DLQ + SNS/]:::dlq

  EMIT_ADDED -.->|EventBridge| Q_PMA[/payment-method-added SQS/]:::queue
  Q_PMA --> L_PMA[payment-method-added Lambda]:::new
  L_PMA --> READ_ROW[(findByUserIdConsistent)]:::store
  L_PMA -->|trialing OR cancelled| EMIT_SSR[SubscriptionStartRequestCommand]:::new
  L_PMA -->|active / pending_cancellation| NOOP_PMA([noop]):::policy
  L_PMA -.->|throw on store error| DLQ_PMA[/payment-method-added DLQ + SNS/]:::dlq

  class POST,POSTFIN,PUB_ADD,EMIT_ADDED,EMIT_SSR,UPSERT_CUST,UPSERT_PM,L_ADD,L_PMA,Q_ADD,Q_PMA,DLQ_ADD,DLQ_PMA,STRIPE_PATCH,RETRIEVE,CHECKOUT new;
```

## Trial-end charge + post-trial charge

```mermaid
flowchart TD
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8;
  classDef sys fill:#fff2a8,stroke:#a08a00;
  classDef evt fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px;

  SCHED([EventBridge Scheduler<br/>fires at trialEndsAt]):::policy
  PMA_REACT([PaymentMethodAddedEvent handler<br/>dispatches for trialing/cancelled rows]):::new
  SCHED -.->|EventBridge| SSR_CMD[SubscriptionStartRequestCommand]:::cmd
  PMA_REACT -.->|EventBridge| SSR_CMD

  SSR_CMD -.-> Q_SSR[/subscription-start-request SQS/]:::queue
  Q_SSR --> L_SSR[subscription-start-request Lambda]:::sys
  L_SSR --> CONSISTENT[(findByUserIdConsistent)]:::store

  CONSISTENT -->|status not trialing/cancelled| NOOP1([noop]):::policy
  CONSISTENT -->|trialing, no card, trial active| NOOP2([noop — wait for scheduler]):::policy
  CONSISTENT -->|trialing, no card, trial expired| UPSERT_C[(upsertCancelled<br/>NO event)]:::store
  CONSISTENT -->|cancelled, no card| NOOP3([noop — defensive]):::policy
  CONSISTENT -->|trialing, card, trial active| NOOP4([noop — wait for scheduler]):::policy
  CONSISTENT -->|trialing+card+trial-expired<br/>OR cancelled+card| MARK_REQ[(markChargeRequested<br/>conditional / reuse on conflict)]:::store

  MARK_REQ --> STRIPE_CREATE[Stripe subscriptions.create<br/>off_session=true<br/>payment_behavior=default_incomplete<br/>Idempotency-Key=chargeRequestedAt]:::sys
  STRIPE_CREATE -->|succeeded| CLEAR_FAILED[(clearChargeFailed if set)]:::store
  CLEAR_FAILED --> EMIT_SUCC[SubscriptionChargeSucceededEvent]:::evt
  STRIPE_CREATE -->|requires_action OR payment_failed| MARK_FAILED[(markChargeFailed<br/>chargeFailedAt + reason)]:::store
  MARK_FAILED --> THROW([throw to SQS retry → DLQ → SNS]):::dlq

  EMIT_SUCC -.->|EventBridge| Q_SUCC[/subscription-charge-succeeded SQS/]:::queue
  Q_SUCC --> L_SUCC[subscription-charge-succeeded Lambda]:::sys
  L_SUCC --> UPSERT_ACTIVE[(upsertActive<br/>REMOVE chargeRequestedAt, chargeFailedAt, chargeFailedReason)]:::new

  class PMA_REACT,UPSERT_C,MARK_REQ,MARK_FAILED,CLEAR_FAILED,THROW,STRIPE_CREATE,CONSISTENT,UPSERT_ACTIVE new;
```

## Cancellation chain (unchanged)

```mermaid
flowchart LR
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8;
  classDef sys fill:#fff2a8,stroke:#a08a00;
  classDef evt fill:#ffb976,stroke:#a85800;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0;
  classDef store fill:#b8e8c5,stroke:#2f7a45;
  classDef queue fill:#e8e8e8,stroke:#666;
  classDef dlq fill:#f8c8c8,stroke:#a83434;

  POST_CANCEL[/POST /account/cancel/]:::cmd
  POST_CANCEL --> CANCEL_CMD[CancelSubscriptionCommand]:::cmd
  CANCEL_CMD -.-> Q_CANCEL[/cancel-subscription SQS/]:::queue
  Q_CANCEL --> L_CANCEL[cancel-subscription Lambda]:::sys
  L_CANCEL --> STRIPE_DEL[Stripe DELETE subscription]:::sys
  L_CANCEL --> EMIT_CANCEL[SubscriptionCancelledEvent]:::evt
  L_CANCEL --> DEL_SCHED[deleteTrialEndSchedule]:::sys
  EMIT_CANCEL -.-> L_HSC[handle-subscription-cancelled Lambda]:::sys
  L_HSC --> MARK_CXL[(markCancelledByUserId)]:::store

  STRIPE_WEBHOOK([Stripe customer.subscription.deleted webhook]):::policy
  STRIPE_WEBHOOK --> L_WEBHOOK[stripe-webhook-receiver Lambda]:::sys
  L_WEBHOOK --> EMIT_CANCEL
```

## Command → System → Event(s) reference

| Command / Event | Handler | Emits | Triggers next |
|---|---|---|---|
| **`AddPaymentMethodCommand`** (new) | `add-payment-method` Lambda | `PaymentMethodAddedEvent` | payment-method-added Lambda |
| **`PaymentMethodAddedEvent`** (new) | `payment-method-added` Lambda | `SubscriptionStartRequestCommand` (for trialing/cancelled) | subscription-start-request Lambda |
| `SubscriptionStartRequestCommand` (existing — new branching) | `subscription-start-request` Lambda | `SubscriptionChargeSucceededEvent` (success) OR row write + throw (failure) | subscription-charge-succeeded Lambda OR DLQ SNS |
| `SubscriptionChargeSucceededEvent` (existing — handler clears charge sentinels) | `subscription-charge-succeeded` Lambda | (terminal — row write) | n/a |
| ~~`SubscriptionChargeFailedEvent`~~ (DELETED) | ~~`subscription-charge-failed` Lambda~~ | ~~`CancelSubscriptionCommand`~~ | DLQ row banner replaces this chain |
| `CancelSubscriptionCommand` (unchanged) | `cancel-subscription` Lambda | `SubscriptionCancelledEvent`, deleteTrialEndSchedule | handle-subscription-cancelled Lambda |
| `SubscriptionCancelledEvent` (unchanged) | `handle-subscription-cancelled` Lambda | (terminal — row write) | n/a |

## Idempotency & race-condition strategy

Three layers of defence prevent duplicate charges across SQS at-least-once
redeliveries, EventBridge fan-out duplicates, and concurrent producer races
(the trial-end scheduler firing at the same moment as PaymentMethodAddedEvent):

1. **DynamoDB conditional write on `chargeRequestedAt`** — first writer wins;
   conflicts cause the loser to re-read the winner's `chargeRequestedAt` and
   reuse it as the Stripe Idempotency-Key.
2. **Stripe Idempotency-Key** on `customers.update` (set default PM) and
   `subscriptions.create` — Stripe dedupes server-side for 24h, so even
   without the conditional write Stripe would not double-charge.
3. **`ConsistentRead: true`** in `findByUserIdConsistent` — eliminates
   eventual-consistency windows where the scheduler reads stale row state
   while a card-add write is in flight.

## Deletion / deploy ordering

`SubscriptionChargeFailedEvent` + its handler are deleted in the same
commit. The unsubscribe (Pulumi removes the `eventBus.subscribe` rule)
and the Lambda deletion happen in the same `pulumi up`. Stripe-side
behaviour is preserved: the producer (`subscription-start-request`)
stops emitting in the same code commit, so no in-flight events of the
deleted type can exist at deploy time. Any pre-existing in-flight
messages on the DLQ-bound queue would dead-letter to SNS — operationally
acceptable given the queue typically carries no traffic.
