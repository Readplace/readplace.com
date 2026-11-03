# The reader reverses a readlist call from the email page

Snapshot of the uncommitted working tree over `e91b68fb8` (`main`), whose 2026-11-03 subject is **feat: remember a reader's readlist choices**. Generated 2026-11-03.

The email filter decides, per readlist, which of an email's links fit. The email page now shows that call on each card and lets the reader reverse it, with Undo. The inbox web Lambda becomes a publisher of `FileArticleIntoReadlistCommand`, beside the filter handler, the submit-link handler, the email-issue save and the hutch readlist page.

- **Keep.** The route records the reader's choice and publishes `FileArticleIntoReadlistCommand` with a reader source. The existing file-article-into-readlist Lambda files the article.
- **Drop.** The route records the choice and removes the article from that readlist directly, when the reader has it saved. Nothing is published.
- **Undo.** The route deletes the choice. When the engine had kept the link, it republishes the engine's keep with its reason, purpose version and email source; otherwise it removes the article from the readlist.
- **Guards.** The route sits behind the locked-account and write-access gates. A link the filter did not decide for that readlist, an email whose saves are held, or an Undo with no choice to reverse answers 404 and changes nothing.

Only the inbox web Lambda's code changes. Its bus grant, table grants and the command's subscription already exist.

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
    P["Policy / reaction"]:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    N["Added or changed by this change"]:::new
```

</details>

---

## 1. The reader's choice on a card

The reader presses Keep, Drop or Undo on a card. The route checks the email's stored outcome for that readlist, then records or deletes the reader's choice and either publishes the filing command or removes the article from the readlist. An htmx request gets the card, the readlist line and a toast back; a plain form post is redirected to the email page with a confirmation that shows the toast.

![The reader's choice on a card](diagrams/fit-choice.svg)

[BPMN image](diagrams-bpmn/fit-choice.png) · [Editable BPMN](diagrams-bpmn/fit-choice.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    U["Reader presses Keep, Drop or Undo"]:::command --> G["Locked-account and write-access gates"]:::policy
    G --> W["inbox web Lambda: fit route"]:::new
    EM[("inbox emails and links: stored readlist outcome")]:::store --> W
    W -- "no decided outcome, saves held, or nothing to undo" --> NF["404, nothing changes"]:::system
    W -- "keep" --> K["Record the reader's choice"]:::new
    W -- "drop" --> DR["Record the reader's choice"]:::new
    W -- "undo" --> UN["Delete the reader's choice"]:::new
    K --> OV[("readlist fit overrides")]:::store
    DR --> OV
    UN --> OV
    K --> FC["FileArticleIntoReadlistCommand, reader source"]:::command
    UN -- "engine had kept the link" --> FE["FileArticleIntoReadlistCommand, engine keep with reason and email source"]:::command
    UN -- "engine had dropped it, or no engine fit" --> RM["Remove the article from the readlist"]:::system
    DR -- "reader has it saved" --> RM
    RM --> UA[("user articles: readlist row")]:::store
    W --> LG["Readlist fit overridden log line, no URL"]:::system
    W --> RS["htmx: card, readlist line and toast with Undo. Form post: redirect with the confirmation"]:::new
```

</details>

---

## 2. Filing a reader's keep

The command goes over the bus to the existing file-article-into-readlist queue. The worker finds the reader's saved copy and files it into the readlist, then publishes the filed fact. When the article is not in All yet, it fails the record and waits for redelivery.

![Filing a reader's keep](diagrams/filing.svg)

[BPMN image](diagrams-bpmn/filing.png) · [Editable BPMN](diagrams-bpmn/filing.bpmn)

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

    IW["inbox web Lambda"]:::new --> C["FileArticleIntoReadlistCommand"]:::command
    FL["filter-email-links Lambda"]:::system --> C
    OT["Other publishers: submit-link, email-issue save, readlist page"]:::system --> C
    C --> B["Event bus rule"]:::system --> Q[("file-article-into-readlist queue")]:::queue --> H["file-article-into-readlist Lambda"]:::system
    H --> F[("articles and user articles: find the saved copy")]:::store
    H -- "saved" --> A[("user articles: file into the readlist")]:::store
    A --> E(("ArticleFiledIntoReadlistEvent")):::event
    H -- "not in All yet" --> R["Fail the record; the queue redelivers"]:::system --> Q
    Q -- "after 5 receives" --> D[("file-article-into-readlist-dlq")]:::dlq --> AL["DLQ alarm email"]:::system
```

</details>

---

## Command → System → Event(s) reference

| Command or event | System | Emits | Triggers next |
|---|---|---|---|
| Reader's Keep on a card | inbox web Lambda, fit route | `FileArticleIntoReadlistCommand` with a reader source; a fit override row; a log line | file-article-into-readlist Lambda |
| Reader's Drop on a card | inbox web Lambda, fit route | A fit override row; the readlist row removed when saved; a log line | none |
| Reader's Undo of a keep the engine made | inbox web Lambda, fit route | `FileArticleIntoReadlistCommand` with the engine's reason and email source; the override deleted | file-article-into-readlist Lambda |
| Reader's Undo of any other call | inbox web Lambda, fit route | The readlist row removed; the override deleted | none |
| `FileArticleIntoReadlistCommand` | file-article-into-readlist Lambda | `ArticleFiledIntoReadlistEvent`, or a failed record while the article is not in All | none; the event has no subscriber |
| Message out of receives | `file-article-into-readlist-dlq` | none | DLQ alarm email |
