# Save trigger: related passes only run for a link a person picked

Snapshot of the uncommitted working tree over `2aad162c1` (`main`), whose 2026-11-02 subject is **revert: retry a blocked wrapper hop through curl-impersonate**. Generated 2026-11-02. Nothing here is deployed yet.

`QueueEntryCreatedEvent` starts both related passes, `next_read` and `past_reads`, at two DeepSeek calls per new save. Before this change the gate read the provenance kind, so every email link paid for both. Provenance cannot express the rule, because the inbox page and the reader's issue links let a person tap Save on a link that also carries `email` provenance.

- **A save states who picked the link.** `saveTrigger` is required on the user branch of `SubmitLinkCommand` and on the save parameters. `manual` publishes the event, `automatic` never does. The provenance table is gone.
- **Email links are automatic.** Inbox-address, Gmail live and Gmail history links are `automatic`, as is the import tab, which already skipped the passes.
- **A tap on a newsletter link is manual.** The inbox page per-link Save and the reader's issue-links Save keep both passes.
- **save-content takes the capture's trigger.** A tapped upload publishes, and an automatic heal or rescue does not, on both the resolved inline branch and the unresolved branch that queues a `SubmitLinkCommand`.
- **The issue save publishes nothing.** Its publish, dependency and wiring are removed.
- **The crawl-latency flag rides the same gate.** A save that publishes no event has no worker waiting on its crawl, so `measured` is false.
- **A tap on a row an automatic save created publishes nothing.** The gate needs a created row, so that row stays `pending`, as import rows have since `e5b700358`. Past reads still fill on open.
- **An automatic save's reader is not browser-cached.** Its related status stays `pending`, so the reader is served `private, no-cache` rather than `private, max-age=1800`, and every reopen revalidates and is answered 304 after a full render, as import rows and every `?v`-less open already are.
- **The filter is not on this path.** It files with `FileArticleIntoReadlistCommand` since `6dca0016a`, which never publishes the event.

No Pulumi resource changes: the event, its subscription and the bus grants all stay.

---

## Legend

Amber marks what this change adds or changes. Everything else is existing infrastructure shown for context.

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

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P["Policy / reaction"]:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    U["Client action"]:::ui
    N["Added or changed by this change"]:::new
```

</details>

---

## 1. From every save surface to the related passes

Each surface now states who picked the link. The gate reads that one fact, plus whether the save created the reader's row.

![From every save surface to the related passes](diagrams/end-to-end-flow.svg)

[BPMN image](diagrams-bpmn/end-to-end-flow.png) · [Editable BPMN](diagrams-bpmn/end-to-end-flow.bpmn)

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

    WEB["Web save bar, extension,<br/>save-all-tabs, MCP save_link"]:::ui
    CAP["save-content upload<br/>captureTrigger on the request"]:::ui
    TAP["Inbox page per-link Save,<br/>reader issue-links Save"]:::ui
    IMP["Import tab commit"]:::ui
    EXT["extract-email-links Lambda<br/>inbox address, Gmail live, Gmail history"]:::system

    TMAN["saveTrigger manual"]:::new
    TCAP["saveTrigger equals captureTrigger"]:::new
    TAUTO["saveTrigger automatic"]:::new

    SLC["SubmitLinkCommand<br/>saveTrigger required when a user owns it"]:::new
    SLQ[("submit-link queue<br/>480 s visibility, 3 receives")]:::queue
    SLL["submit-link Lambda"]:::system
    SAVE["saveArticleFromUrl<br/>hutch inline or the submit-link Lambda"]:::system
    ROW[("user-articles row")]:::store
    GATE{"createdUserArticle and<br/>saveTrigger is manual?"}:::new
    QEC(("QueueEntryCreatedEvent")):::event
    MEAS["markCrawlPending measured<br/>same gate, first save of a URL"]:::new
    CRQ[("compute-related-articles queue<br/>batch size 1")]:::queue
    CRL["compute-related-articles Lambda"]:::system
    NEXT["next_read pass<br/>DeepSeek"]:::system
    PAST["past_reads pass<br/>DeepSeek"]:::system
    NONE["No queue entry event<br/>the save still queues and crawls"]:::new

    WEB --> TMAN
    TAP --> TMAN
    CAP --> TCAP
    IMP --> TAUTO
    EXT --> TAUTO
    TMAN --> SAVE
    TCAP --> SAVE
    TAUTO --> SAVE
    TMAN --> SLC
    TAUTO --> SLC
    TCAP -->|"unresolved link"| SLC
    SLC --> SLQ
    SLQ --> SLL
    SLL --> SAVE
    SAVE --> ROW
    SAVE --> GATE
    SAVE --> MEAS
    GATE -->|"yes"| QEC
    GATE -->|"no"| NONE
    QEC --> CRQ
    CRQ --> CRL
    CRL --> NEXT
    CRL --> PAST
```

</details>

---

## 2. The newsletter issue save

The issue save never reads a trigger, because only the extract step publishes it. Its publish is removed, and its crawl goes unmeasured on every save.

![The newsletter issue save](diagrams/email-issue.svg)

[BPMN image](diagrams-bpmn/email-issue.png) · [Editable BPMN](diagrams-bpmn/email-issue.bpmn)

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

    EXT["extract-email-links Lambda"]:::system
    SEI["SaveEmailIssueCommand"]:::command
    SEL["save-email-issue-command Lambda"]:::system
    ROW[("user-articles row, issue metadata")]:::store
    CP["markCrawlPending measured false<br/>when content is pending"]:::new
    SP["markSummaryPending"]:::system
    OSA(("EmailOutputSavedToAllEvent")):::event
    GONE["QueueEntryCreatedEvent from the issue save<br/>removed"]:::new
    TCE(("TierContentExtractedEvent<br/>when content is pending")):::event
    SEL2["Content selection of the issue body"]:::system

    EXT --> SEI
    SEI --> SEL
    SEL --> ROW
    SEL --> CP
    SEL --> SP
    SEL --> OSA
    SEL --> TCE
    TCE --> SEL2
    SEL -.->|"no longer published"| GONE
```

</details>

---

## 3. What still computes after an automatic save

Past reads still fill on first open. Next read has no on-open path, so an automatic save never gets one.

![What still computes after an automatic save](diagrams/past-reads-on-open.svg)

[BPMN image](diagrams-bpmn/past-reads-on-open.png) · [Editable BPMN](diagrams-bpmn/past-reads-on-open.bpmn)

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

    OPEN["Reader opens the article"]:::ui
    TR["POST /:id/topic-reads"]:::system
    CMD["ComputeRelatedPastReadsCommand"]:::command
    CRL["compute-related-articles Lambda"]:::system
    PAST["past_reads pass"]:::system
    POLL["GET /:id/related polls<br/>Next read slot stays hidden"]:::new
    STOP["Stops at MAX_POLLS"]:::system
    CAND[("Automatic saves stay candidates<br/>for other saves' passes")]:::store

    OPEN --> TR
    TR --> CMD
    CMD --> CRL
    CRL --> PAST
    OPEN --> POLL
    POLL --> STOP
    PAST -.->|"reads"| CAND
```

</details>

---

## 4. A record in flight at deploy

hutch, inbox and save-link deploy in parallel with no ordering. A user-owned command from an old producer has no `saveTrigger`, so the new consumer refuses it after three receives at 480 s visibility, about 24 minutes. An inbox link then shows failed with Save offered again, because inbox subscribes to `LinkQueueFailedEvent`. Nothing in hutch reads that event, so an unresolved save from hutch's old bundle (web, extension, MCP, import) is lost with no failure shown. A dead-lettered record with `emailOutput` also never publishes `EmailOutputSavedToAllEvent`, so a Gmail import's completion can stay `not-saved`. The reverse order is harmless, because the old consumer strips the unknown key.

![A record in flight at deploy](diagrams/deploy-drain.svg)

[BPMN image](diagrams-bpmn/deploy-drain.png) · [Editable BPMN](diagrams-bpmn/deploy-drain.bpmn)

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

    OLD["Old producer<br/>SubmitLinkCommand without saveTrigger"]:::command
    SLQ[("submit-link queue<br/>3 receives")]:::queue
    SLL["New submit-link Lambda<br/>matches neither union branch"]:::new
    DLQ[("submit-link DLQ")]:::dlq
    DLH["submit-link DLQ consumer<br/>parses url and optional userId"]:::system
    LQF(("LinkQueueFailedEvent")):::event
    UI["Inbox link shows failed, Save offered again"]:::ui
    LOST["Hutch save lost, no failure shown<br/>nothing in hutch reads the event"]:::dlq

    OLD --> SLQ
    SLQ --> SLL
    SLL -->|"batch item failure"| SLQ
    SLQ --> DLQ
    DLQ --> DLH
    DLH --> LQF
    LQF -->|"inbox record-link-queued"| UI
    LQF -->|"no hutch subscriber"| LOST
```

</details>

---

## Command → System → Event(s) reference

| Command or event | System | Emits | Next |
|---|---|---|---|
| `SubmitLinkCommand` with `saveTrigger` | submit-link Lambda | `LinkQueued`, `QueueEntryCreatedEvent` when manual and new, `LinkSaved` on the new branch | Crawl and summary, compute-related-articles when the event fires |
| `SubmitLinkCommand` without `saveTrigger`, user-owned | submit-link Lambda refuses it | Dead letter, then `LinkQueueFailedEvent` | Inbox link shows failed; a hutch save is lost silently |
| Inline save from a hutch route | hutch | `LinkQueued`, `QueueEntryCreatedEvent` when manual and new | compute-related-articles when the event fires |
| `SaveEmailIssueCommand` | save-email-issue-command Lambda | `EmailOutputSavedToAllEvent`, `TierContentExtractedEvent` when content is pending | Content selection of the issue body |
| `QueueEntryCreatedEvent` | compute-related-articles Lambda | Related rows | `next_read` and `past_reads` passes |
| `ComputeRelatedPastReadsCommand`, on first open | compute-related-articles Lambda | Related rows | `past_reads` pass only |
