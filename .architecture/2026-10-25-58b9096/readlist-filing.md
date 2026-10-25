# Readlist filing: one command files an article into a readlist

Snapshot of the uncommitted working tree over `58b9096` (`rp/determined-franklin-7crvbn`), whose 2026-10-25 subject is **feat(@packages/article-store,@packages/provider-contracts): find a reader's saved article for a link through its alias**. Generated 2026-10-25.

This change adds the one way a readlist decision puts an article into a readlist. Nothing publishes the command yet: the email filter starts publishing it when it switches to the shared fit contract, and the email page's reader controls publish it later.

- **`FileArticleIntoReadlistCommand` is new.** It names the reader, the link as it arrived, the readlist and the save provenance, plus the fit that justified the filing: an email keep with its reason and purpose version, a reader keep, or a readlist with no purpose.
- **The `file-article-into-readlist` Lambda handles it** from its own queue, with five receives and its own dead-letter queue, topic, email subscription and alarm. It looks the link up the way a save keys it: it prepares the URL, follows an alias row to its canonical, then reads the reader's row in All. A link whose article is not in All yet is redelivered. Otherwise the article is filed into the readlist, and a read article resurfaces as unread in every readlist that holds it.
- **`ArticleFiledIntoReadlistEvent` is new.** The handler publishes it after every completed filing, including one that finds the article already filed. Nothing subscribes to it yet.

---

## Legend

Amber marks what this change adds. Everything else is existing infrastructure shown for context.

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
    P["Policy / reaction"]:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    N["Added by this commit"]:::new
```

</details>

---

## 1. The filing flow

No publisher exists yet, so the command enters from the bus with nothing upstream. The lookup reads the canonical alias rows in the articles table before it reads the reader's All row, because a tracker wrapper or an adopted terminal URL is saved under its canonical.

![The filing flow](diagrams/filing-flow.svg)

[BPMN image](diagrams-bpmn/filing-flow.png) · [Editable BPMN](diagrams-bpmn/filing-flow.bpmn)

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

    BUS["EventBridge bus<br/>no publisher yet"]:::policy
    CMD["FileArticleIntoReadlistCommand<br/>userId, url, readlist, provenance, fit"]:::new
    RULE["file-article-into-readlist-command-rule"]:::new
    Q[("file-article-into-readlist-q<br/>300 s visibility, 5 receives")]:::new
    DLQ[("file-article-into-readlist-dlq<br/>14 days, topic, email, alarm")]:::new
    L["file-article-into-readlist Lambda"]:::new
    LOOKUP["Prepare the URL as a save does,<br/>follow its alias, read the All row"]:::new
    ALIAS[("Articles table<br/>article and alias rows")]:::store
    ALL[("User-articles table<br/>All and readlist rows")]:::store
    WAIT["Not in All yet:<br/>INFO wait line, record fails, SQS redelivers"]:::policy
    FILE["File into the readlist;<br/>a read article resurfaces as unread"]:::new
    FACT(("ArticleFiledIntoReadlistEvent<br/>userId, readlist, resolved url, source")):::new
    NONE["No subscriber yet"]:::policy

    BUS --> CMD --> RULE --> Q --> L
    Q -- "after 5 receives" --> DLQ
    L --> LOOKUP
    LOOKUP --> ALIAS
    LOOKUP --> ALL
    LOOKUP -- "not saved" --> WAIT --> Q
    LOOKUP -- "saved" --> FILE --> ALL
    FILE --> FACT --> NONE
```

</details>

---

## Command → System → Event(s) reference

| Command or event | Handled by | Emits | Triggers next |
|---|---|---|---|
| `FileArticleIntoReadlistCommand` | `file-article-into-readlist` Lambda, through its own queue | `ArticleFiledIntoReadlistEvent` after every completed filing | Nothing yet |
| `ArticleFiledIntoReadlistEvent` | No subscriber | — | — |
