# Trial Feedback Research Email Flow

> **Snapshot commit:** `a6469fc8` (2026-05-30, branch `claude/quirky-newton-wDzsX`)
>
> **Scope:** trial-feedback research email for churned trials — `SubscriptionCancelledEvent` (reason=`user_initiated_trial`) triggers a 3-day delayed "what was missing?" email via two SQS-backed Lambdas and an EventBridge Scheduler one-shot.

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
    classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E["Event"]:::event
    P["Policy / reaction"]:::policy
    R["Read model / store"]:::store
    Q["Queue"]:::queue
    D["DLQ"]:::dlq
    N["New in this snapshot"]:::new
```

---

## Diagram 1 — Schedule trial feedback email

`SubscriptionCancelledEvent` arrives via EventBridge. The `schedule-trial-feedback-email` Lambda filters on `reason='user_initiated_trial'` (paid churn and Stripe-side cancels are noops). For qualifying events it creates a deterministic-name EventBridge Scheduler one-shot (`trial-feedback-<userId>`) that fires 3 days later with `SendTrialFeedbackEmailCommand`. The deterministic name means at-least-once duplicate `SubscriptionCancelledEvent` deliveries overwrite the same schedule instead of stacking.

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event fill:#ffb976,stroke:#a85800,color:#000
    classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    EVT["SubscriptionCancelledEvent<br/>(EventBridge)"]:::event
    Q1["schedule-trial-feedback-email<br/>SQS queue"]:::new
    DLQ1["schedule-trial-feedback-email<br/>DLQ + email alarm"]:::new
    HANDLER["schedule-trial-feedback-email<br/>Lambda"]:::new

    FILTER{"reason =<br/>user_initiated_trial?"}:::new
    NOOP["noop<br/>(paid / stripe cancel)"]:::policy
    SCHED["Create EventBridge Scheduler<br/>one-shot trial-feedback-userId<br/>(fires in 3 days)"]:::new
    CMD["SendTrialFeedbackEmailCommand<br/>(scheduled payload)"]:::new

    EVT --> Q1 --> HANDLER --> FILTER
    Q1 -.->|retry exhaustion| DLQ1
    FILTER -->|no| NOOP
    FILTER -->|yes| SCHED --> CMD
```

---

## Diagram 2 — Send trial feedback email

The EventBridge Scheduler one-shot fires `SendTrialFeedbackEmailCommand` via EventBridge. The `send-trial-feedback-email` Lambda re-reads the subscription row and applies three guards: (1) row must exist, (2) status must be `cancelled` (reactivation guard), (3) `trialFeedbackEmailSentAt` must be unset (sent-flag dedupe). On pass, it looks up the user's email, counts their saved articles, renders the personalised research email, sends via Resend (Bcc to `readplace+trial_feedback@readplace.com`), and stamps `trialFeedbackEmailSentAt` on the row.

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event fill:#ffb976,stroke:#a85800,color:#000
    classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    SCHED_FIRE["EventBridge Scheduler<br/>one-shot fires<br/>(3 days after cancel)"]:::new
    CMD["SendTrialFeedbackEmailCommand<br/>(EventBridge)"]:::new
    Q2["send-trial-feedback-email<br/>SQS queue"]:::new
    DLQ2["send-trial-feedback-email<br/>DLQ + email alarm"]:::new
    HANDLER2["send-trial-feedback-email<br/>Lambda"]:::new

    READ_ROW["Read subscription_providers<br/>row by userId"]:::new
    GUARD{"row exists &<br/>status=cancelled &<br/>!trialFeedbackEmailSentAt?"}:::new
    NOOP2["noop<br/>(missing / reactivated / already sent)"]:::policy

    EMAIL["findEmailByUserId<br/>(users table)"]:::new
    ARTICLES["Count saved articles<br/>(userArticles table)"]:::new
    RENDER["Render trial-feedback<br/>email template"]:::new
    SEND["Send via Resend<br/>(Bcc readplace+trial_feedback)"]:::new
    STAMP["markTrialFeedbackEmailSent<br/>(subscription_providers)"]:::new

    SCHED_FIRE --> CMD --> Q2 --> HANDLER2 --> READ_ROW --> GUARD
    Q2 -.->|retry exhaustion| DLQ2
    GUARD -->|no| NOOP2
    GUARD -->|yes| EMAIL --> ARTICLES --> RENDER --> SEND --> STAMP
```

---

## Diagram 3 — End-to-end: cancel to feedback email

Complete flow from trial cancellation through to the research email delivery, showing how the existing `SubscriptionCancelledEvent` (from the cancel chain) fans out to both the existing `handle-subscription-cancelled` Lambda and the new trial-feedback scheduling chain.

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event fill:#ffb976,stroke:#a85800,color:#000
    classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    CANCEL["Cancel chain<br/>(cancel-subscription Lambda)"]:::system
    EVT["SubscriptionCancelledEvent<br/>(reason=user_initiated_trial)"]:::event

    subgraph existing ["Existing subscriber"]
        Q_EXIST["handle-subscription-cancelled<br/>SQS queue"]:::queue
        H_EXIST["handle-subscription-cancelled<br/>Lambda"]:::system
        DB_CANCEL["subscription_providers<br/>status=cancelled"]:::store
    end

    subgraph feedback ["New: trial feedback chain"]
        Q_SCHED["schedule-trial-feedback-email<br/>SQS queue"]:::new
        H_SCHED["schedule-trial-feedback-email<br/>Lambda<br/>(filter: user_initiated_trial)"]:::new
        TIMER["EventBridge Scheduler<br/>one-shot trial-feedback-userId<br/>(fires in 3 days)"]:::new
        CMD["SendTrialFeedbackEmailCommand"]:::new
        Q_SEND["send-trial-feedback-email<br/>SQS queue"]:::new
        H_SEND["send-trial-feedback-email<br/>Lambda<br/>(reactivation guard + sent-flag)"]:::new
        READ["Read row + email + article count"]:::new
        RESEND["Send research email<br/>(Resend)"]:::new
        STAMP["markTrialFeedbackEmailSent"]:::new
    end

    CANCEL --> EVT
    EVT --> Q_EXIST --> H_EXIST --> DB_CANCEL
    EVT --> Q_SCHED --> H_SCHED --> TIMER --> CMD --> Q_SEND --> H_SEND --> READ --> RESEND --> STAMP
```

---

## Command → System → Event(s) reference table

| Command / Trigger | System | Event(s) emitted | Next command(s) |
|---|---|---|---|
| `SubscriptionCancelledEvent` (reason=`user_initiated_trial`) | schedule-trial-feedback-email Lambda | — | Creates EventBridge Scheduler one-shot `trial-feedback-<userId>` (fires in 3 days with `SendTrialFeedbackEmailCommand`) |
| `SubscriptionCancelledEvent` (reason=`user_initiated_paid_confirmed` or `stripe_webhook`) | schedule-trial-feedback-email Lambda | — (noop) | — |
| EventBridge Scheduler one-shot fires (`trial-feedback-<userId>`) | EventBridge Scheduler | — | `SendTrialFeedbackEmailCommand` |
| `SendTrialFeedbackEmailCommand` (row cancelled, no sent flag) | send-trial-feedback-email Lambda | — (sends email via Resend, stamps `trialFeedbackEmailSentAt`) | — |
| `SendTrialFeedbackEmailCommand` (row missing, reactivated, or already sent) | send-trial-feedback-email Lambda | — (noop) | — |
