# Reader-ready fan-out retired: the queue digest is the only digest

Snapshot of the uncommitted working tree over `928cccbc6` (`main`), whose 2026-10-09 subject is **fix: recrawl an Apple News story with no publisher URL on its own link**. Generated 2026-10-09. The base commit still runs the reader-ready fan-out; its retirement is uncommitted at capture time.

The queue digest (`699f4566a`, live in production from 2026-09-30T22:23:29Z) moved digest selection to send time: `digest-scan` enumerates recipients from the subscription status index and `send-user-digest` reads each recipient's unread saves from the user-articles `userId-savedAt-index`. From that moment no feature read the digest-queue table, and only account deletion still queried it, to delete a departing user's rows. The old write side was left running on purpose so that `699f4566a` stayed a plain revert. The retirement gate (a week of clean queue-digest sends, issue #1177) passed on 2026-10-09, and this change removes the old write side in one commit and one deploy.

- **Deleted:** the `reader-ready-fanout` Lambda with its role, policies and log subscription filter; its queue, dead-letter queue, event source mapping, DLQ alarm and SNS email subscription; the EventBridge rule, target and both queue policies that delivered `ReaderViewLoadingSucceeded` to it; and the `hutch-digest-queue-{stage}` table. The Lambda's log group is retained (`retainOnDelete`): it leaves Pulumi state and stays in AWS.
- **`ReaderViewLoadingSucceeded` keeps its publisher and loses its only consumer.** The save-link summary worker still publishes it on the transition into a succeeded reader view. EventBridge accepts an event that matches no rule, so nothing fails; `ReaderReadyEmailSentEvent` is already published the same way.
- **Account deletion stops scrubbing the digest-queue table.** The data-rights worker (`user-data-jobs`) loses the table's IAM grant and its `DYNAMODB_DIGEST_QUEUE_TABLE` environment variable in the same deploy that deletes the table, so no running code can name a missing table.
- **The table's rows go with it.** It had no deletion protection and no point-in-time recovery. Since the queue digest shipped, its rows were per-user saved URLs that no feature read; they would otherwise have aged out under the 30-day TTL.
- **Kept:** the user-articles `url-index` (account deletion and save-link count savers through it), the `hutch-reader-ready-notifications` table (the regular-digest slot and the starter state), the per-save `emailSentAt` stamp, `SendUserDigestCommand` and `ReaderReadyEmailSentEvent`.
- **First drawing of the queue digest.** No earlier snapshot shows the six-hour tick as it now runs, so the digest flows below are drawn in full in their role colours: they are context, not part of this change.

---

## Legend

Amber marks what this retirement changes; dashed grey marks what it deletes. Everything else is existing infrastructure shown for context.

![Legend](diagrams/legend.svg)

[BPMN image](diagrams-bpmn/legend.png) · [Editable BPMN](diagrams-bpmn/legend.bpmn)

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
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000
    classDef gone    fill:#f0f0f0,stroke:#999,stroke-dasharray:5 5,color:#666

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P["Policy / reaction"]:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    U["Reader action"]:::ui
    N["Changed by this retirement"]:::new
    G["Deleted by this retirement"]:::gone
```

</details>

---

## 1. The reader-view fact loses its only consumer

The summary worker writes the summary axis and, only when that write moves the article's reader view into `succeeded`, publishes `ReaderViewLoadingSucceeded`. A re-summarise of an article whose reader view had already succeeded publishes nothing new. Before this change one rule matched the fact and fed the fan-out, which looked up every saver of the URL through the `url-index` and appended a digest-queue row for each saver who had opened the reader, when the event carried a ready summary. After it, no rule matches.

![The reader-view fact loses its only consumer](diagrams/reader-view-fact.svg)

[BPMN image](diagrams-bpmn/reader-view-fact.png) · [Editable BPMN](diagrams-bpmn/reader-view-fact.bpmn)

<details><summary>Mermaid source</summary>

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
    classDef gone    fill:#f0f0f0,stroke:#999,stroke-dasharray:5 5,color:#666

    GSC["GenerateSummaryCommand"]:::command
    GSQ[("generate-summary queue")]:::queue
    GS["save-link generate-summary Lambda<br/>markSummaryReady or markSummarySkipped"]:::system
    ART[("articles table<br/>summary axis")]:::store
    GATE{"did this write move the reader view<br/>into succeeded?"}
    SG(("SummaryGeneratedEvent<br/>ready summaries only")):::event
    SGC["existing save-link consumer<br/>unchanged"]:::system
    RVLS(("ReaderViewLoadingSucceeded<br/>url, succeededAt, hasSummary")):::new
    BUS["hutch event bus<br/>no rule matches the detail-type"]:::new
    DROP["accepted, delivered nowhere"]:::policy
    QUIET["no reader-view fact<br/>re-summarise of a succeeded article"]:::policy

    GSC --> GSQ
    GSQ --> GS
    GS --> ART
    GS --> SG
    SG --> SGC
    GS --> GATE
    GATE -->|"yes"| RVLS
    GATE -->|"no"| QUIET
    RVLS --> BUS
    BUS --> DROP

    subgraph Deleted["Deleted by this retirement"]
        RULE["reader-view-loading-succeeded-rule<br/>target, queue policy, DLQ policy"]:::gone
        FQ[("reader-ready-fanout-q<br/>visibility 120 s")]:::gone
        FDLQ[("reader-ready-fanout-dlq<br/>alarm and SNS email")]:::gone
        FL["reader-ready-fanout Lambda<br/>512 MB, 60 s, batch 1"]:::gone
        DQT[("hutch-digest-queue table<br/>userId and url, 30-day TTL")]:::gone
    end

    UIDX[("user-articles url-index<br/>stays: savers are still counted through it")]:::store

    BUS -.->|"was"| RULE
    RULE -.-> FQ
    FQ -.-> FL
    FQ -.->|"3 receives"| FDLQ
    FL -.->|"Query every saver"| UIDX
    FL -.->|"PutItem per saver with viewedAt,<br/>when hasSummary"| DQT
```

</details>

---

## 2. The six-hour tick: `digest-scan`

An EventBridge Scheduler schedule puts a trigger message on the `digest-scan` queue every six hours. The worker runs three steps in order. The first two only log their failures, so a broken Hacker News fetch or report never stops the digests. Recipients come from the KEYS_ONLY `status-index` on the subscription-providers table, and each one gets its own `SendUserDigestCommand` over direct SQS. A failed dispatch is counted and logged rather than failing the tick, because a redrive would re-dispatch every recipient; the next tick picks that user up. A new Hacker News story with no article row and no crawl starts an anonymous crawl, which is the one path from this tick back to `ReaderViewLoadingSucceeded`.

![The six-hour tick](diagrams/digest-tick.svg)

[BPMN image](diagrams-bpmn/digest-tick.png) · [Editable BPMN](diagrams-bpmn/digest-tick.bpmn)

<details><summary>Mermaid source</summary>

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

    SCHED["EventBridge Scheduler hutch-digest-flush<br/>rate 6 hours"]:::system
    DSQ[("digest-scan-q<br/>visibility 120 s")]:::queue
    DSDLQ[("digest-scan-dlq<br/>alarm and SNS email")]:::dlq
    DS["digest-scan Lambda<br/>512 MB, 60 s, batch 1"]:::system

    SCHED -->|"trigger message"| DSQ
    DSQ --> DS
    DSQ -.->|"3 receives"| DSDLQ

    PREP["1. prepare the starter snapshot<br/>a failure is logged and the tick continues"]:::policy
    BUCKET[("content bucket<br/>starter rollout and daily HN snapshot")]:::store
    HN["Hacker News API<br/>top 30 stories"]:::system
    NEWSTORY{"story with no article row<br/>and no crawl?"}
    STUB[("articles table<br/>stub, crawl and summary pending")]:::store
    SALC["SaveAnonymousLinkCommand"]:::command
    PIPE["existing save-link crawl,<br/>selection and summary chain"]:::system
    RVLS(("ReaderViewLoadingSucceeded<br/>no consumer")):::new

    DS --> PREP
    PREP --> BUCKET
    PREP --> HN
    PREP --> NEWSTORY
    NEWSTORY -->|"yes"| STUB
    NEWSTORY -->|"yes"| SALC
    SALC --> PIPE
    PIPE --> RVLS

    REPORT["2. starter report<br/>a failure is logged and the tick continues"]:::policy
    RLOG[("JSON report lines<br/>CloudWatch Logs")]:::store
    DS --> REPORT
    REPORT --> RLOG

    ENUM["3. list recipients<br/>trialing, active, pending_cancellation"]:::policy
    SIDX[("subscription-providers<br/>status-index, KEYS_ONLY")]:::store
    SUDC["SendUserDigestCommand<br/>one per user, direct SQS"]:::command
    SUDQ[("send-user-digest-q")]:::queue
    TICK["dispatched user digests<br/>users and failed counts logged"]:::policy
    DS --> ENUM
    ENUM --> SIDX
    ENUM --> SUDC
    SUDC --> SUDQ
    ENUM --> TICK
```

</details>

---

## 3. Send-time selection: `send-user-digest`

One message is one recipient. The worker first finishes its own redrive: a message that already holds the regular slot or the pay claim only completes the bookkeeping. It then enrols the reader in the Hacker News starter pack and, unless a pay digest is due, tries the starter email before any digest. A pay digest is due for a trialing row between 96 and 60 hours before the trial ends, once per trial. A regular digest waits seven days, less thirty minutes for tick jitter, after the last digest of either kind. Candidates are read at send time from the user-articles `userId-savedAt-index`: unread personal saves whose reader view is available and whose summary is ready. The regular digest also requires the save to be at least 30 days old and never emailed before. The claim is a conditional write, the email goes through Resend, and every listed save is stamped with `emailSentAt` before the consumer-less `ReaderReadyEmailSentEvent` is published. None of this reads the digest-queue table.

![Send-time selection](diagrams/send-user-digest.svg)

[BPMN image](diagrams-bpmn/send-user-digest.png) · [Editable BPMN](diagrams-bpmn/send-user-digest.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000

    SUDC["SendUserDigestCommand"]:::command
    SUDQ[("send-user-digest-q<br/>visibility 120 s")]:::queue
    SUDDLQ[("send-user-digest-dlq<br/>alarm and SNS email")]:::dlq
    SUD["send-user-digest Lambda<br/>512 MB, 60 s, batch 1"]:::system

    SUDC --> SUDQ
    SUDQ --> SUD
    SUDQ -.->|"3 receives"| SUDDLQ

    OWN{"does this message already<br/>hold a digest claim?"}
    ENROLL["enrol in the HN starter pack<br/>a failure is logged"]:::policy
    PAYDUE{"pay digest due?"}
    STARTER["HN starter email path"]:::policy
    STOP["done for this tick"]:::policy
    GATES{"verified email, subscribed,<br/>trial or paid tier?"}
    SKIP["skipped and logged"]:::policy
    CADENCE{"7 days less 30 min since<br/>the last digest of either kind?"}
    HELD["held: cadence"]:::policy
    PAYSEL["pay digest selection<br/>up to 10 unread saves, reader available, summary ready"]:::system
    REGSEL["regular digest selection<br/>up to 10 unread saves 30 days old or more, never emailed"]:::system
    UAIDX[("user-articles<br/>userId-savedAt-index")]:::store
    PAYCLAIM["claim the once-per-trial pay digest"]:::system
    REGCLAIM["claim the per-user slot<br/>5.5 h cooldown"]:::system
    SUBS[("subscription-providers row")]:::store
    RRN[("hutch-reader-ready-notifications row")]:::store
    WARN["claim held elsewhere<br/>warning logged"]:::policy
    MAIL["send the digest email through Resend"]:::system
    FIN["stamp emailSentAt on every listed save"]:::system
    UAROWS[("user-articles rows")]:::store
    RRES(("ReaderReadyEmailSentEvent<br/>no consumer")):::event

    SUD --> OWN
    OWN -->|"yes, a redelivery"| FIN
    OWN -->|"no"| ENROLL
    ENROLL --> PAYDUE
    PAYDUE -->|"no"| STARTER
    STARTER -->|"starter handled the user"| STOP
    STARTER -->|"nothing to send"| GATES
    PAYDUE -->|"yes"| GATES
    GATES -->|"no"| SKIP
    GATES -->|"pay due"| PAYSEL
    GATES -->|"regular"| CADENCE
    CADENCE -->|"no"| HELD
    CADENCE -->|"yes"| REGSEL
    PAYSEL --> UAIDX
    REGSEL --> UAIDX
    PAYSEL -->|"nothing ready"| SKIP
    REGSEL -->|"nothing ready"| SKIP
    PAYSEL --> PAYCLAIM
    REGSEL --> REGCLAIM
    PAYCLAIM --> SUBS
    REGCLAIM --> RRN
    PAYCLAIM -->|"already claimed"| WARN
    REGCLAIM -->|"slot held"| WARN
    PAYCLAIM --> MAIL
    REGCLAIM --> MAIL
    MAIL --> FIN
    FIN --> UAROWS
    FIN --> RRES
```

</details>

---

## 4. Account deletion without the digest queue

Account deletion is unchanged except for one removed step. The scrub used to delete the user's digest-queue rows right after their saved-article rows; that table is gone, so the step is gone, and the `user-data-jobs` role and environment lose the table with it. The `url-index` is still read here, to count the other savers of each URL before single-saver content is purged.

![Account deletion without the digest queue](diagrams/account-deletion.svg)

[BPMN image](diagrams-bpmn/account-deletion.png) · [Editable BPMN](diagrams-bpmn/account-deletion.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000
    classDef gone    fill:#f0f0f0,stroke:#999,stroke-dasharray:5 5,color:#666

    UI["POST /account/delete<br/>typed confirmation"]:::ui
    WEB["web Lambda<br/>stamp deletedAt, destroy sessions, revoke OAuth tokens"]:::system
    DAC["DeleteAccountCommand"]:::command
    UDJQ[("user-data-jobs-q<br/>visibility 900 s")]:::queue
    UDJDLQ[("user-data-jobs-dlq<br/>alarm and SNS email")]:::dlq
    UDJ["user-data-jobs Lambda<br/>no digest-queue grant or environment variable"]:::new

    UI --> WEB
    WEB --> DAC
    DAC --> UDJQ
    UDJQ --> UDJ
    UDJQ -.->|"12 receives"| UDJDLQ

    EARLY["billing, per-user schedules, inbox,<br/>Gmail and readlist address claims"]:::system
    ARTS["purge single-saver content,<br/>then delete the user's saved-article rows"]:::system
    UIDX[("user-articles url-index<br/>other savers per URL")]:::store
    STARTER["withdraw the HN starter assignment"]:::system
    RRS["delete the reader-ready slot row"]:::system
    RRN[("hutch-reader-ready-notifications")]:::store
    REST["onboarding, exports, reset and verification tokens,<br/>pending signups"]:::system
    CREDS["revoke IdP and OAuth tokens, destroy sessions,<br/>close the account, delete the subscription row"]:::system
    DONE["completion logged<br/>no event published"]:::policy
    GONE["delete the user's digest-queue rows<br/>Query and DeleteItem on hutch-digest-queue"]:::gone

    UDJ --> EARLY
    EARLY --> ARTS
    ARTS --> UIDX
    ARTS --> STARTER
    ARTS -.->|"removed step"| GONE
    STARTER --> RRS
    RRS --> RRN
    RRS --> REST
    REST --> CREDS
    CREDS --> DONE
```

</details>

---

## 5. What the deploy deletes and updates

The staging preview of this tree (`pnpm check-infra`) was compared with the same preview of the base commit, taken earlier on 2026-10-09:

| Stack | Base commit | This change |
|---|---|---|
| hutch | 15 to update, 622 unchanged | 15 to update, **23 to delete**, 599 unchanged |
| save-link | 29 to update | 28 to update |
| inbox, web-embed, blog-site, platform | 7, 1, 1 and 0 to update | the same |

- **The 23 deletes** are the 18 AWS resources in the Deleted group below, the Lambda's log group as `delete[retain]`, and the four Pulumi components that wrapped them. Nothing is replaced.
- **One update is new:** the `user-data-jobs` DynamoDB role policy, whose resource list loses the `hutch-digest-queue-staging` ARN and nothing else. **One update is gone:** the fan-out Lambda's code drift, which is now a delete. The `user-data-jobs-handler` environment loses `DYNAMODB_DIGEST_QUEUE_TABLE` inside an update that the base preview already listed for local build drift.
- **The save-link difference is not this change.** The staging deploy of the base commit updated that one Lambda between the two previews.

![What the deploy deletes and updates](diagrams/deploy-delta.svg)

[BPMN image](diagrams-bpmn/deploy-delta.png) · [Editable BPMN](diagrams-bpmn/deploy-delta.bpmn)

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

    DEPLOY["CI deploy of the hutch stack<br/>staging, then prod"]:::system

    subgraph Updated["Updated in place"]
        UFN["user-data-jobs-handler<br/>environment loses DYNAMODB_DIGEST_QUEUE_TABLE, new code"]:::new
        UPOL["user-data-jobs DynamoDB role policy<br/>loses the digest-queue table ARN"]:::new
    end

    subgraph Deleted["Deleted"]
        DRULE["EventBridge rule and target<br/>reader-view-loading-succeeded"]:::gone
        DQP["queue policy and DLQ policy<br/>reader-view-loading-succeeded"]:::gone
        DESM["event source mapping<br/>reader-ready-fanout"]:::gone
        DFN["Lambda reader-ready-fanout-handler<br/>role, basic execution, 3 inline policies,<br/>log subscription filter"]:::gone
        DQ[("reader-ready-fanout-q and reader-ready-fanout-dlq")]:::gone
        DALARM["DLQ alarm, SNS topic and email subscription"]:::gone
        DTABLE[("DynamoDB hutch-digest-queue-staging and -prod<br/>no deletion protection, no PITR")]:::gone
    end

    RETAIN[("log group /aws/lambda/reader-ready-fanout-handler<br/>retained: leaves state, stays in AWS")]:::store

    DEPLOY -->|"updates apply first"| UFN
    DEPLOY --> UPOL
    DEPLOY -.->|"delivery"| DRULE
    DRULE -.-> DQP
    DEPLOY -.->|"worker"| DESM
    DESM -.-> DFN
    DEPLOY -.->|"queues and alerting"| DQ
    DQ -.-> DALARM
    DFN -.->|"the table goes after everything that names it"| DTABLE
    UPOL -.->|"no longer names it"| DTABLE
    DFN -.->|"retainOnDelete"| RETAIN
```

</details>

---

## Command → System → Event(s) reference

| Command or input | System and durable result | Emitted events or next actions |
|---|---|---|
| `GenerateSummaryCommand` | save-link `generate-summary` Lambda writes the summary axis as ready or skipped | `SummaryGeneratedEvent` for a ready summary; `ReaderViewLoadingSucceeded` when the write moves the reader view into succeeded, which **no rule matches after this change** |
| `ReaderViewLoadingSucceeded` | none: the rule, the fan-out Lambda and the digest-queue table are deleted | none |
| Scheduler `hutch-digest-flush`, every 6 hours | `digest-scan` Lambda: starter rollout and daily HN snapshot in the content bucket, starter report log lines, recipients from the subscription `status-index` | `SaveAnonymousLinkCommand` for a new HN story with no article row and no crawl; one `SendUserDigestCommand` per recipient over direct SQS |
| `SaveAnonymousLinkCommand` | existing save-link anonymous save, crawl, selection and summary chain | the existing chain, ending in `ReaderViewLoadingSucceeded` with no consumer |
| `SendUserDigestCommand` | `send-user-digest` Lambda: HN starter enrolment and starter email, or a queue digest selected at send time from `userId-savedAt-index`; claims the regular slot in `hutch-reader-ready-notifications` or the pay claim on the subscription row; stamps `emailSentAt` on each listed save | `ReaderReadyEmailSentEvent`, no consumer |
| `DeleteAccountCommand` | `user-data-jobs` Lambda scrubs every user-owned store, no longer including the digest-queue table | none; the scrub ends with a completion log line |

---

## Known gaps recorded with the retirement

- **`viewedAt` is now written and never read.** Every owner reader open and reader poll still stamps it, and `findUserArticlesByUrl`, its only reader, has no production caller. Keeping both was the minimal option; removing them is a separate, larger change.
- **Rolling back the queue digest is no longer a plain revert of `699f4566a`.** That revert names the digest-queue table this change deletes, so this change has to be reverted first, and the recreated table starts empty.
- **The fan-out's log group stays in AWS** outside Pulumi state, and the older `reader-ready-notify-handler` log group is still orphaned. Removing either is its own change.
- **Names still say "reader-ready".** `ReaderReadyEmailSentEvent` is published for every queue digest, regular and pay, and `SendUserDigestCommand` is documented as a reader-ready digest. Renaming either is a catalogue change with its own snapshot.

---

## Source evidence at capture time

| Boundary | Evidence |
|---|---|
| Publisher of the reader-view fact | [Summary worker](../../projects/save-link/src/runtime/domain/generate-summary/generate-summary-handler.ts), [summary-ready transition](../../src/packages/domain/src/article-aggregate/transitions/mark-summary-ready.ts), [summary-skipped transition](../../src/packages/domain/src/article-aggregate/transitions/mark-summary-skipped.ts), [effect dispatcher](../../projects/save-link/src/runtime/domain/article-aggregate/lambda-effect-dispatcher.ts), [event catalogue](../../src/packages/hutch-infra-components/src/events.ts) |
| Six-hour tick | [digest-scan composition root](../../projects/hutch/src/runtime/digest-scan.main.ts), [digest-scan handler](../../projects/hutch/src/runtime/digest-scan/digest-scan-handler.ts), [HN snapshot](../../projects/hutch/src/runtime/domain/engagement/hn-snapshot.ts) |
| Send-time selection | [send-user-digest composition root](../../projects/hutch/src/runtime/send-user-digest.main.ts), [queue digest handler](../../projects/hutch/src/runtime/send-queue-digest/send-queue-digest-handler.ts), [cadence](../../projects/hutch/src/runtime/domain/email/queue-digest-cadence.ts), [pay window](../../projects/hutch/src/runtime/domain/stripe/stripe-trial-config.ts) |
| Account deletion | [delete-account handler](../../projects/hutch/src/runtime/delete-account/delete-account-handler.ts), [user-data-jobs composition root](../../projects/hutch/src/runtime/user-data-jobs.main.ts) |
| Infrastructure | [hutch infrastructure](../../projects/hutch/src/infra/index.ts), [hutch storage](../../projects/hutch/src/infra/hutch-storage.ts), [Lambda component and its retained log group](../../src/packages/hutch-infra-components/src/infra/hutch-lambda.ts) |
