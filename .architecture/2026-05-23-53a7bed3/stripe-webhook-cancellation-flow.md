# Stripe Webhook Cancellation Flow — Event Storming

**Base commit:** `53a7bed3` &nbsp;•&nbsp; **Commit date:** 2026-05-23 &nbsp;•&nbsp; **Generated:** 2026-05-23 &nbsp;•&nbsp; **Branch:** `claude/stoic-brahmagupta-IPsCv`
**Subject:** `feat(hutch): extract Stripe webhook into dedicated Lambda with EventBridge`

A point-in-time map of the Stripe webhook cancellation flow: Stripe sends `customer.subscription.deleted` to a dedicated API Gateway-fronted Lambda that verifies the HMAC signature and emits `SubscriptionCancelledEvent` via EventBridge. A separate SQS-backed Lambda subscribes to the event and marks the subscription as cancelled in DynamoDB. The SSR Lambda's `initGetEffectiveAccess` reads the subscription status at request time and gates write access accordingly.

What is new in this snapshot:

- **`SubscriptionCancelledEvent`** — new EventBridge event (`source: "hutch.stripe-webhook"`, `detailType: "SubscriptionCancelled"`, detail: `{ subscriptionId }`). Emitted by the Stripe webhook receiver Lambda after signature verification.
- **`stripe-webhook-receiver` Lambda** — API Gateway-fronted (not SQS-backed). Verifies Stripe HMAC-SHA256 signature with `timingSafeEqual`, validates timestamp tolerance (300s), parses the event body via Zod. Returns 200 after successful EventBridge publish; lets publish failures propagate as 5xx so Stripe retries.
- **`handle-subscription-cancelled` Lambda** — SQS-backed via `HutchSQSBackedLambda`. Subscribes to `SubscriptionCancelledEvent` via EventBridge. Marks the `subscription_providers` row as `status='cancelled'`. Failed records are reported via `SQSBatchResponse.batchItemFailures` for per-record retry; exhausted retries land in DLQ with SNS email alarm.
- **Effective access gating** — `initGetEffectiveAccess` in the SSR Lambda reads the subscription row and derives a discriminated union (`FullAccessTier | InactiveAccess`). `requireWriteAccess` middleware 402-gates write endpoints for cancelled/trial-expired users.

> Snapshots are historical. Any file path referenced below may be renamed, moved, or deleted in the future. Treat as an artefact, not a live guide.

---

## Legend

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

    C[Command]:::command
    S[System / aggregate]:::system
    E[Event]:::event
    P[Policy / reaction]:::policy
    R[Read model / store]:::store
    Q[(Queue)]:::queue
    D[(DLQ)]:::dlq
    N[New in this snapshot]:::new
```

---

## End-to-end flow — Stripe cancellation to write-access gating

Stripe sends `customer.subscription.deleted` via HTTP POST to an API Gateway route. The `stripe-webhook-receiver` Lambda verifies the HMAC-SHA256 signature (including timestamp tolerance), parses the event body, and publishes `SubscriptionCancelledEvent` to EventBridge. EventBridge routes the event to an SQS queue fronting the `handle-subscription-cancelled` Lambda, which marks the subscription row as cancelled. On the next authenticated request, the SSR Lambda's `initGetEffectiveAccess` reads the updated row and returns `InactiveAccess`, causing `requireWriteAccess` to 402-gate write endpoints.

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    %% Entry
    Stripe[Stripe<br/>customer.subscription.deleted]:::policy

    %% API Gateway
    APIGW[API Gateway<br/>POST /webhooks/stripe]:::new
    Stripe -->|HTTP POST| APIGW

    %% Webhook receiver Lambda
    Receiver[stripe-webhook-receiver Lambda<br/>HMAC-SHA256 verify + parse<br/>128 MB / 10 s]:::new
    APIGW --> Receiver

    %% Signature check outcomes
    Receiver -->|invalid signature<br/>or expired timestamp| R400[400 Bad signature]:::store
    Receiver -->|unknown event type<br/>e.g. invoice.created| R200Ignore[200 OK<br/>silently accepted]:::store

    %% EventBridge publish
    Receiver -->|customer.subscription.deleted<br/>valid signature| SCE[SubscriptionCancelledEvent<br/>subscriptionId]:::new

    %% Publish failure path
    Receiver -.->|EventBridge publish fails<br/>exception propagates| R5xx[5xx<br/>Stripe retries<br/>exponential backoff up to 3 days]:::dlq

    %% EventBridge to SQS
    EB[EventBridge]:::system
    SCE --> EB

    HSCQueue[(handle-subscription-cancelled<br/>SQS queue<br/>vis 30 s)]:::new
    EB --> HSCQueue

    %% Handler Lambda
    HSCLambda[handle-subscription-cancelled Lambda<br/>markCancelled on subscription_providers<br/>128 MB / 30 s]:::new
    HSCQueue --> HSCLambda

    %% Success path
    HSCLambda -->|success| SubRow[(subscription_providers row<br/>status = cancelled)]:::store

    %% Failure path
    HSCQueue -. exhausted retries .-> HSCDLQ[(handle-subscription-cancelled<br/>DLQ)]:::dlq
    HSCDLQ -.->|SNS alarm| OperatorEmail[Operator email notification]:::policy

    %% Read path — SSR Lambda
    SSR[SSR Lambda<br/>initGetEffectiveAccess]:::new
    SubRow -->|query at request time| SSR
    SSR -->|status=cancelled| Gate[requireWriteAccess middleware<br/>402-gates POST /queue, /save, /import/*]:::new
```

---

## Failure paths

| Failure point | Behaviour | Recovery |
|---|---|---|
| Stripe signature invalid / expired | `stripe-webhook-receiver` returns 400; Stripe does **not** retry 4xx | No action — invalid requests are rejected by design |
| EventBridge publish fails | Exception propagates; API Gateway returns 5xx; Stripe retries with exponential backoff up to 3 days | Automatic via Stripe retry |
| `handle-subscription-cancelled` Lambda throws | SQS retries per `maxReceiveCount`; exhausted messages land in DLQ with SNS email alarm | Operator redrives from DLQ |
| `markCancelled` DynamoDB write fails | Record reported in `batchItemFailures`; SQS retries that record | Automatic via SQS retry, then DLQ |

---

## Command → System → Event reference

| Command / Event | Handler | Side effects | Emits |
|---|---|---|---|
| Stripe `customer.subscription.deleted` (HTTP POST) | `stripe-webhook-receiver` Lambda (API Gateway) | HMAC verify, parse body | `SubscriptionCancelledEvent` (subscriptionId) |
| `SubscriptionCancelledEvent` (subscriptionId) | `handle-subscription-cancelled` Lambda (SQS-backed) | `markCancelled` on `subscription_providers` table | (terminal — no downstream event) |

---

## Trust boundary

The `stripe-webhook-receiver` is an API Gateway-fronted Lambda (not SQS-backed):

- **IAM**: EventBridge `events:PutEvents` only — no DynamoDB, no S3.
- **Capacity**: 128 MB / 10 s — signature verification and JSON parsing only.
- **Failure domain**: Stripe's built-in retry mechanism (exponential backoff, up to 3 days) handles transient EventBridge failures. The webhook receiver has no DLQ of its own because API Gateway is the queue analogue.

The `handle-subscription-cancelled` is an SQS-backed Lambda:

- **IAM**: DynamoDB `GetItem`, `Query`, `UpdateItem` on `subscription_providers` table.
- **Capacity**: 128 MB / 30 s — single DynamoDB write per event.
- **Failure domain**: its own SQS queue + DLQ + SNS alarm + email subscription. DLQ arrivals page the operator for manual redrive.
