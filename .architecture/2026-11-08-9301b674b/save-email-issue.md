# A newsletter issue save is safe to redrive from its dead-letter queue

Snapshot of the uncommitted working tree over `9301b674b` (`main`), whose 2026-11-08 subject is **fix(save-link,inbox): redrive a dead-lettered email triage only while it still applies**. Generated 2026-11-08. Nothing here is deployed yet.

The inbox extract step publishes `SaveEmailIssueCommand` once per received newsletter. The save-email-issue-command Lambda saves the issue itself as a card in All, files it into the email's readlists, and commits the stored email body as a tier-0 candidate. Before this change the handler asserted the body was present, overwrote the card's position on every receive and filed into every readlist unconditionally, so a redrive days later could resurrect a card the reader had removed, file into a deleted readlist, or save for an account that had lost write access. The handler now reads where the issue stands before it writes.

- **Body gone.** When the stored email body no longer exists, the handler logs a warning and publishes `EmailIssueSaveSkippedEvent` (`body-gone`). Nothing is written.
- **Standing first.** The handler reads the issue's stored display URL and the user's saves for the issue URL. The issue counts as **removed by the reader** when it was saved once (it has a display URL) but no All row remains. It counts as **saved to All** when an All row exists, and it records which readlists already hold it.
- **Write access lapsed.** When the issue is neither in All nor removed, the handler reads the user's subscription. A `read-only` account gets `EmailIssueSaveSkippedEvent` (`write-access-lapsed`) and nothing is written.
- **Removed by the reader.** The card is not re-created. Crawl and summary are still marked pending when the content is pending, `EmailOutputSavedToAllEvent` still fires so a Gmail import can complete, the tier-0 body is still committed, and `EmailIssueSaveSkippedEvent` (`removed-by-reader`) is published.
- **Saved.** The All row is written while keeping an existing row's position, the display URL is set, and each readlist the issue is not already in is filed through a live-readlist check stamped with the command's envelope time. A filing that lands as `readlist-gone`, `removed-after-request` or `not-in-all` is logged as a skipped filing. No event is published for it.
- **The new event has no subscriber yet.** `EmailIssueSaveSkippedEvent` goes to the event bus and nothing consumes it.

Pulumi changes: the Lambda gains read access to the subscription-providers table and its table name, and `ConditionCheckItem` on the user-articles table.

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
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P{"Policy / decision"}:::policy
    R[("Read model / store")]:::store
    Q[["Queue"]]:::queue
    D[["DLQ"]]:::dlq
    N(("Added or changed by this change")):::new
```

</details>

---

## The newsletter issue save

![The newsletter issue save](diagrams/save-email-issue.svg)

[BPMN image](diagrams-bpmn/save-email-issue.png) · [Editable BPMN](diagrams-bpmn/save-email-issue.bpmn)

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

    EXT["extract-email-links Lambda (inbox)"]:::system
    SEI["SaveEmailIssueCommand"]:::command
    Q[["save-email-issue-command-q"]]:::queue
    DLQ[["save-email-issue-command-dlq<br/>after 3 receives, alarm emails"]]:::dlq
    SEL["save-email-issue-command Lambda"]:::system
    BODY[("Content bucket: stored email body")]:::store
    PB{"Body present?"}:::new
    SK1(("EmailIssueSaveSkippedEvent<br/>reason body-gone")):::new
    STAND["Read the issue's standing:<br/>stored display URL + user's saves for the URL"]:::new
    ALIAS[("Articles table: canonical alias row")]:::store
    UA[("User-articles table: All and readlist rows")]:::store
    PS{"In All, removed by reader,<br/>or neither?"}:::new
    SUB[("Subscription-providers table")]:::new
    PW{"Write access?"}:::new
    SK2(("EmailIssueSaveSkippedEvent<br/>reason write-access-lapsed")):::new
    CS[("Articles table: crawl status")]:::store
    MP["markCrawlPending + markSummaryPending<br/>when content is pending"]:::system
    SAVE["saveArticleKeepingPosition<br/>+ setDisplayUrl"]:::new
    OSA(("EmailOutputSavedToAllEvent<br/>when the email has an output")):::event
    GIC["inbox gmail-import-completion Lambda"]:::system
    FILE{"For each readlist:<br/>already filed?"}:::new
    FLR["fileIntoLiveReadlist<br/>stamped with the command's envelope time"]:::new
    FO{"Filing outcome"}:::new
    LOGF["Log: filing skipped<br/>readlist-gone, removed-after-request, not-in-all"]:::new
    TIER["Commit tier-0 email body via putTierSource<br/>only when content is pending"]:::system
    TCE(("TierContentExtractedEvent<br/>when content is pending")):::event
    SMC["select-most-complete-content"]:::system
    SK3(("EmailIssueSaveSkippedEvent<br/>reason removed-by-reader")):::new
    ONB[("Onboarding table: inbox article queued stamp")]:::store
    NOSUB["No subscriber yet"]:::new

    EXT --> SEI --> Q --> SEL
    Q -.->|"3 failed receives"| DLQ
    DLQ -.->|"manual redrive"| Q
    SEL --> BODY --> PB
    PB -->|"gone"| SK1
    PB -->|"present"| STAND
    STAND --> ALIAS
    STAND --> UA
    STAND --> PS
    PS -->|"neither"| SUB --> PW
    PW -->|"read-only"| SK2
    PW -->|"has access"| CS
    PS -->|"in All"| CS
    PS -->|"removed by reader"| CS
    CS -->|"in All or new"| SAVE
    SAVE --> UA
    SAVE --> MP
    CS -->|"removed by reader: no card written"| MP
    MP --> OSA
    OSA --> GIC
    OSA -->|"saved"| FILE
    FILE -->|"yes"| TIER
    FILE -->|"no"| FLR --> UA
    FLR --> FO
    FO -->|"filed, newer-row-won"| TIER
    FO -->|"skipped"| LOGF --> TIER
    OSA -->|"removed by reader"| TIER
    TIER --> TCE --> SMC
    TIER -->|"removed by reader"| SK3
    TIER --> ONB
    SK1 --> NOSUB
    SK2 --> NOSUB
    SK3 --> NOSUB
```

</details>

---

## Command → System → Event(s) reference

| Command or event | System | Emits | Next |
|---|---|---|---|
| `SaveEmailIssueCommand` | save-email-issue-command Lambda, via its own queue and dead-letter queue | One of the outcomes below | — |
| `SaveEmailIssueCommand`, body gone | save-email-issue-command Lambda | `EmailIssueSaveSkippedEvent` (`body-gone`) | Nothing subscribes yet |
| `SaveEmailIssueCommand`, not in All, not removed, read-only account | save-email-issue-command Lambda | `EmailIssueSaveSkippedEvent` (`write-access-lapsed`) | Nothing subscribes yet |
| `SaveEmailIssueCommand`, removed by the reader | save-email-issue-command Lambda: no card written, crawl and summary marked pending when content is pending | `EmailOutputSavedToAllEvent` when the email has an output, `TierContentExtractedEvent` when content is pending, `EmailIssueSaveSkippedEvent` (`removed-by-reader`) | Gmail import completion; content selection of the issue body |
| `SaveEmailIssueCommand`, saved | save-email-issue-command Lambda: All row kept in position, display URL set, each readlist not already holding it filed through the live-readlist check | `EmailOutputSavedToAllEvent` when the email has an output, `TierContentExtractedEvent` when content is pending; a skipped filing is a log line only | Gmail import completion; content selection of the issue body |
| `EmailOutputSavedToAllEvent` | inbox gmail-import-completion Lambda | Import completion progress | — |
| `TierContentExtractedEvent` | select-most-complete-content | Content selection outcome | Existing content pipeline |
| `EmailIssueSaveSkippedEvent` | Event bus only | — | Nothing subscribes yet |
