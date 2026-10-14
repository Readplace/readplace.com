# Capture trigger: from save-content to the tier-0 manifest

Snapshot of the uncommitted working tree over `802b4e7d1` (`main`), whose 2026-10-13 subject is **feat(hutch,@packages/domain): price-anchor the homepage AI comparison (#1207)**. Generated 2026-10-14. The base commit already selects content by a tier-0 manifest's `captureTrigger` (that selection change landed in `d56cf6769`), but nothing writes the field yet. This change carries it from the save-content form to the manifest.

A capture the reader tapped keeps the reader's "this is the page I saw" trust: selection may serve it as the article's first content without asking the judge, and may keep it when the judge finds nothing readable. The iOS and Android apps are about to capture a failed article on their own when the reader opens it. Nobody chose that page, so selection must be able to tell the two apart. This change gives it the information to do so.

- **The save-content form gains an optional `captureTrigger` text part**, `automatic` or `manual`. An absent part means `manual`, which is what every shipped client sends today. Any other value is refused with a 422 `invalid-save-content` before anything is staged. The part is used on the inline form and on the upload-slot completion request. A slot request does not use the value but still refuses a malformed one with the same 422, and the upload-slot entity does not echo it. The Siren `save-content` action advertises the new field. The change is additive: old clients keep working unchanged.
- **`SaveLinkRawHtmlCommand` gains a required `captureTrigger`.** This is a wire-format change to one existing command. Its `source` and `detail-type` stay the same, so no EventBridge rule moves. The bulk Save All Tabs path always sends `manual`. The PDF command is unchanged and carries no trigger: the apps' page capture stops without HTML when the page is a PDF, so the automatic capture this field is for is always HTML.
- **The raw-html worker writes the trigger into the tier-0 manifest** through candidate provenance, and names it on its "tier-0 source written" log line. Selection then treats an automatic capture as a crawl candidate: it gets no `first-capture`, no `own-capture-over-verdict` and never raises `ownCaptureFailed`.
- **The raw-html dead-letter handler parses only `url`.** A dead letter published before the deploy has no `captureTrigger`. With the narrowed parse it is still terminalised, instead of bouncing between the shared DLQ and the router.
- **No Lambda, queue, rule, grant or environment variable is added, removed or re-wired.**

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
    N["Added or changed by this commit"]:::new
```

</details>

---

## 1. Save-content intake reads the trigger

Clients find `save-content` on the collection's Siren actions. The browser extensions upload a page's HTML inline, or through an upload slot when it is over the inline budget. The apps upload through the share sheet, through their deferred upload drain, and through the reader's "Capture it here" rescue. The daily Tier 1+ canary uploads a page too. None of them sends a trigger yet, so every one of these uploads stays a tap capture.

The route reads the trigger once, right after the multipart parse and before it decides which leg the request is. A malformed value is refused on every leg, including a slot request. A slot request never uses the trigger, and its response does not echo it back. A client that wants the trigger on the completion adds the part to the completion form itself.

![Save-content intake reads the trigger](diagrams/save-content-intake.svg)

[BPMN image](diagrams-bpmn/save-content-intake.png) · [Editable BPMN](diagrams-bpmn/save-content-intake.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    EXT["Browser extension upload<br/>inline or through an upload slot"]:::ui
    APP["iOS and Android uploads<br/>share sheet, deferred drain, reader capture"]:::ui
    CANARY["Tier 1+ canary upload"]:::ui
    SIREN["Siren save-content action<br/>url, content, mediaType, title, size, captureTrigger"]:::new
    SC["POST /queue/save-content<br/>hutch web Lambda"]:::system
    MP{"multipart body?"}
    R422M["422 invalid-save-content<br/>multipart body required"]:::policy
    TRIG{"captureTrigger part"}:::new
    MANUAL["manual<br/>what every shipped client sends"]:::new
    SENT["automatic or manual<br/>as sent"]:::new
    R422T["422 invalid-save-content<br/>captureTrigger must be automatic or manual<br/>nothing staged"]:::new
    LEG{"which leg?"}
    INLINE["inline capture<br/>validate URL, refresh freshness"]:::system
    SUBMIT["SubmitLinkCommand<br/>unresolved wrapper: 409 queued notice, bytes dropped"]:::command
    SLOT["upload-slot request<br/>trigger checked, not used"]:::system
    SLOTENT["200 upload-slot entity<br/>upload-content PUT and save-uploaded-content POST"]:::policy
    DONE["upload completion<br/>stat the staged object, size and age checks"]:::system
    PEND[("pending-html bucket<br/>keyed by url and saveAttemptId")]:::store
    ATTACH["attach the save<br/>article and user-article rows"]:::system
    ROWS[("articles and user-articles tables")]:::store
    SLC["SaveLinkCommand<br/>tier-1 crawl on a first save, unchanged"]:::command
    RAW["SaveLinkRawHtmlCommand<br/>url, saveAttemptId, sourceUrl, sourceOriginalUrl,<br/>userId, title, captureTrigger"]:::new
    PDF["SaveLinkRawPdfCommand<br/>PDF bytes, unchanged, no trigger"]:::command
    R201["201 saved article entity"]:::policy
    BULK["Browser extension Save All Tabs"]:::ui
    SA["POST /queue/save-articles<br/>one staged page per captured tab"]:::system
    BULKM["captureTrigger manual"]:::new

    EXT --> SIREN
    APP --> SIREN
    CANARY --> SIREN
    SIREN -->|"follow the action"| SC
    SC --> MP
    MP -->|"no"| R422M
    MP -->|"yes"| TRIG
    TRIG -->|"absent"| MANUAL
    TRIG -->|"automatic or manual"| SENT
    TRIG -->|"anything else"| R422T
    MANUAL --> LEG
    SENT --> LEG
    LEG -->|"content part"| INLINE
    LEG -->|"size"| SLOT
    LEG -->|"uploaded=true"| DONE
    INLINE -->|"original unresolved"| SUBMIT
    INLINE -->|"text/html: stage the bytes"| PEND
    INLINE -->|"application/pdf"| PDF
    SLOT --> SLOTENT
    SLOTENT -.->|"client PUTs the bytes"| PEND
    PEND -.->|"stat"| DONE
    INLINE --> ATTACH
    DONE --> ATTACH
    ATTACH --> ROWS
    ATTACH -->|"first save"| SLC
    ATTACH -->|"after the rows exist"| RAW
    ATTACH --> R201
    BULK --> SA
    SA --> BULKM
    BULKM --> RAW
```

</details>

---

## 2. The raw-html worker writes the trigger into the manifest

The command handler parses the full detail, so the trigger is required on every message it accepts. It reads the staged capture and finalizes it, then stamps the candidate's provenance with `kind: extension` and the trigger. It writes the tier-0 manifest with the reader and evaluation bodies, and announces the candidate through the unchanged `TierContentExtractedEvent`. A terminal parse error, unless the capture came from a wrapper URL, marks the crawl failed and is retried. A detail that does not parse is retried too, until it dead-letters (section 4).

![The raw-html worker writes the trigger into the manifest](diagrams/raw-html-worker.svg)

[BPMN image](diagrams-bpmn/raw-html-worker.png) · [Editable BPMN](diagrams-bpmn/raw-html-worker.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    RAW["SaveLinkRawHtmlCommand<br/>captureTrigger required"]:::new
    BUS["hutch event bus<br/>save-link-raw-html-command-rule on source and detail-type, unchanged"]:::system
    Q[("save-link-raw-html-command queue<br/>visibility 480 s, 3 receives, shared DLQ")]:::queue
    W["save-link-raw-html-command Lambda<br/>parses the full detail"]:::system
    PARSE{"detail parses?"}
    RETRY["batch item failure<br/>SQS redelivers"]:::policy
    PEND[("pending-html bucket")]:::store
    FIN["finalizeArticle<br/>readability parse of the staged capture"]:::system
    OK{"parsed, or a wrapper source?"}
    MCF["markCrawlFailed parse-error<br/>then a batch item failure"]:::policy
    ART[("articles table")]:::store
    PROV["candidateProvenance<br/>kind extension, attemptId, contentHash, captureTrigger"]:::new
    MAN[("content bucket<br/>tier-0 manifest with captureTrigger,<br/>reader and evaluation bodies")]:::new
    LOG["log line: tier-0 source written<br/>url, capturedTitle, captureTrigger"]:::new
    TCE(("TierContentExtractedEvent<br/>saveAttemptId, candidates, url, userId, extractedAt")):::event

    RAW --> BUS
    BUS --> Q
    Q --> W
    W --> PARSE
    PARSE -->|"no"| RETRY
    RETRY -.->|"next receive"| Q
    PARSE -->|"yes: read the capture"| PEND
    PEND --> FIN
    FIN --> OK
    OK -->|"no"| MCF
    MCF --> ART
    MCF -.-> RETRY
    OK -->|"yes"| PROV
    PROV --> MAN
    MAN --> LOG
    LOG --> TCE
```

</details>

---

## 3. Selection reads the trigger

This part landed with `d56cf6769` and is unchanged here. It is drawn because this change is what feeds it. The selector verifies every listed candidate. A tier-0 candidate must keep `kind: extension`, so the trigger has to live on its own field rather than on a new kind. A tier-0 candidate whose `captureTrigger` is `manual` or absent is a tapped capture, and it keeps both trust rules: `first-capture` serves a lone tapped capture as the article's first content without the judge, and `own-capture-over-verdict` keeps a readable tapped capture from this save when the judge answers `none` and there is no canonical yet. An automatic capture goes to the judge like a crawl copy. When the judge answers `none` and nothing else is kept, the article is marked failed, with the reason this save's live fetch recorded or `parse-error` when there is none. `ownCaptureFailed` stays false for an automatic capture, so the alarm stays quiet. Each candidate on the comparison log line names its `captureTrigger`.

![Selection reads the trigger](diagrams/selection.svg)

[BPMN image](diagrams-bpmn/selection.png) · [Editable BPMN](diagrams-bpmn/selection.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    TCE(("TierContentExtractedEvent")):::event
    SQ[("select-most-complete-content queue<br/>shared DLQ")]:::queue
    SEL["select-most-complete-content Lambda<br/>lists this save's candidates and the canonical"]:::system
    MAN[("tier-0 manifest<br/>captureTrigger")]:::new
    VER["verify provenance<br/>a tier-0 candidate must keep kind extension"]:::system
    RULE{"which rule applies?"}
    FC["first-capture<br/>a lone tapped capture is the first content:<br/>kind extension, captureTrigger not automatic"]:::policy
    TIE["unchanged-content<br/>tie resolved without the judge"]:::policy
    JUDGE["content judge"]:::system
    FALLBACK["provider-rejected-fallback<br/>readable candidates with a 2xx or no status"]:::policy
    RETRY["batch item failure<br/>retried, then the shared DLQ"]:::policy
    OWN["own-capture-over-verdict<br/>a readable tapped capture of this save, no canonical yet"]:::policy
    PROMO["promoteTier<br/>canonical written, crawl ready"]:::system
    NR["markNoReadableArticle<br/>crawl failed, summary skipped"]:::system
    RET["canonical retained"]:::policy
    ART[("articles table")]:::store
    CAC(("CrawlArticleCompletedEvent")):::event
    CHG(("CanonicalContentChangedEvent and LinkSavedEvent<br/>when the canonical changes")):::event
    LOGC["COMPARISON_COMPLETED log line<br/>each candidate's captureTrigger, selectionRule, ownCaptureFailed"]:::policy
    ALARM["select-content-own-capture-failed-alarm<br/>raised by a failed tapped capture only"]:::policy

    TCE --> SQ
    SQ --> SEL
    SEL -->|"read"| MAN
    SEL --> VER
    VER --> RULE
    RULE -->|"a lone tapped capture, first content"| FC
    RULE -->|"every candidate repeats the committed prose"| TIE
    RULE -->|"anything else, including every automatic capture"| JUDGE
    FC --> PROMO
    TIE --> PROMO
    JUDGE -->|"winner"| PROMO
    JUDGE -->|"provider rejected"| FALLBACK
    FALLBACK --> PROMO
    JUDGE -.->|"judge error"| RETRY
    JUDGE -->|"none, readable tapped capture of this save"| OWN
    OWN --> PROMO
    JUDGE -->|"none, committed content"| RET
    JUDGE -->|"none, nothing kept, no canonical"| NR
    PROMO --> ART
    NR --> ART
    PROMO --> CAC
    PROMO --> CHG
    NR --> CAC
    SEL --> LOGC
    LOGC --> ALARM
```

</details>

---

## 4. Retry exhaustion reaches the narrowed dead-letter parse

The raw-html queue sets no receive count of its own, so the shared default of three applies. After the third failed receive a message moves to the save-link shared failures DLQ, which keeps messages for 14 days and has no redrive of its own. Its single consumer is the dead-letter router, which hands each dead letter to the handler registered for its source queue. The raw-html handler needs only the URL to terminalise a crawl, so it now parses only `url`. `markCrawlExhausted` does nothing to a `ready` row. It moves a `pending` row to `failed` with `exhausted-retries`, and moves a pending summary to failed. It keeps a `failed` row's existing reason. It publishes `CrawlArticleFailedEvent` for every row that is not `ready`. A dead letter with no URL at all is still returned as a batch item failure.

![Retry exhaustion reaches the narrowed dead-letter parse](diagrams/dead-letter.svg)

[BPMN image](diagrams-bpmn/dead-letter.png) · [Editable BPMN](diagrams-bpmn/dead-letter.bpmn)

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

    Q[("save-link-raw-html-command queue")]:::queue
    FDLQ[("save-link-failures shared DLQ<br/>arrival alarm emails the operator")]:::dlq
    ROUTER["save-link-failures-dlq Lambda<br/>dead-letter router, routes by source queue"]:::system
    DH["raw-html dead-letter handler<br/>parses only url"]:::new
    BAD["batch item failure<br/>no url in the detail"]:::policy
    MCE["markCrawlExhausted<br/>reason exhausted-retries"]:::system
    ROW{"crawl state of the row"}
    READY["ready: no change, no event"]:::policy
    PENDING["pending: failed with exhausted-retries,<br/>a pending summary fails too"]:::policy
    FAILED["failed: the existing reason is kept"]:::policy
    ART[("articles table")]:::store
    CAF(("CrawlArticleFailedEvent<br/>every row that is not ready")):::event

    Q -->|"third failed receive"| FDLQ
    FDLQ --> ROUTER
    ROUTER --> DH
    DH -->|"no url"| BAD
    BAD -.->|"redelivered from the shared DLQ"| FDLQ
    DH -->|"url"| MCE
    MCE --> ROW
    ROW --> READY
    ROW --> PENDING
    ROW --> FAILED
    PENDING --> ART
    PENDING --> CAF
    FAILED --> CAF
```

</details>

---

## 5. The deploy window

The CI matrix deploys hutch and save-link in parallel, in no fixed order. A required field is safe in one order only.

- **hutch first.** For a short time the new hutch publishes `captureTrigger` to the old raw-html Lambda. That Lambda's schema strips unknown keys, so it ignores the field and writes a manifest with no trigger, which is a tapped capture. Nothing is lost: no client sends `automatic` until the app builds are through store review.
- **save-link first, or a message already in flight.** A `SaveLinkRawHtmlCommand` published by the old hutch has no `captureTrigger`. The new Lambda rejects it on all three receives, and it lands in the shared DLQ. Before this change the raw-html dead-letter handler parsed the same full schema. It would have rejected the dead letter too. The shared DLQ has no redrive of its own, so the router would have received the same message again and again until the queue's 14-day retention expired, holding the arrival alarm in alarm and never touching the article. With the narrowed parse the dead letter is terminalised on its first delivery. That capture is lost: unless another candidate made the article readable, the reader sees the failed notice and captures the page again. The arrival alarm emails the operator when such dead letters arrive. The expected count is zero to a few: only tap captures and extension saves use the raw-html queue, and the window is the gap between two parallel deploy jobs.

![The deploy window](diagrams/deploy-window.svg)

[BPMN image](diagrams-bpmn/deploy-window.png) · [Editable BPMN](diagrams-bpmn/deploy-window.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef ui      fill:#fff,stroke:#555,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    OLDH["hutch before its deploy<br/>publishes no captureTrigger"]:::system
    NEWH["hutch after its deploy<br/>always publishes captureTrigger"]:::new
    OLDMSG["SaveLinkRawHtmlCommand<br/>without captureTrigger"]:::command
    NEWMSG["SaveLinkRawHtmlCommand<br/>with captureTrigger"]:::new
    Q[("save-link-raw-html-command queue")]:::queue
    OLDW["raw-html Lambda before its deploy<br/>strips the unknown key"]:::system
    NEWW["raw-html Lambda after its deploy<br/>requires captureTrigger"]:::new
    TAPPED["manifest without a trigger<br/>read as a tapped capture, nothing lost"]:::policy
    REJECT["rejected on three receives"]:::policy
    FDLQ[("save-link-failures shared DLQ<br/>arrival alarm emails the operator")]:::dlq
    DH["raw-html dead-letter handler<br/>parses only url"]:::new
    TERM["markCrawlExhausted<br/>terminal: the capture is lost"]:::system
    READER["reader captures the page again<br/>unless another candidate made it readable"]:::ui

    OLDH --> OLDMSG
    NEWH --> NEWMSG
    OLDMSG --> Q
    NEWMSG --> Q
    Q -->|"hutch deployed first"| OLDW
    OLDW --> TAPPED
    Q -->|"save-link deployed first"| NEWW
    NEWW -->|"old message"| REJECT
    REJECT --> FDLQ
    FDLQ --> DH
    DH --> TERM
    TERM --> READER
```

</details>

---

## Command → System → Event(s) reference

| Command or input | System and durable result | Emitted events or next actions |
|---|---|---|
| `POST /queue/save-content` with an HTML capture, inline or completing an upload slot | hutch web Lambda reads `captureTrigger` (absent means `manual`; a malformed value is refused with a 422 before anything is staged), stages the bytes in the pending-html bucket and attaches the save to the article and user-article rows | **`SaveLinkRawHtmlCommand` carrying `captureTrigger`**; on a first save also `SaveLinkCommand` for the tier-1 crawl; an unresolved wrapper publishes `SubmitLinkCommand` instead and answers with a 409 notice |
| `POST /queue/save-content` with a PDF | hutch web Lambda stages the bytes in the pending-pdf bucket | `SaveLinkRawPdfCommand`, unchanged and without a trigger |
| `POST /queue/save-content` asking for an upload slot | hutch web Lambda refuses a malformed `captureTrigger` with a 422 `invalid-save-content`, otherwise mints a presigned PUT into the pending bucket without using the value | none; a 200 `upload-slot` entity whose completion action does not echo `captureTrigger` |
| `POST /queue/save-articles` | hutch web Lambda stages each captured tab and saves every listed URL | **`SaveLinkRawHtmlCommand` with `captureTrigger: manual`** for each HTML tab |
| `SaveLinkRawHtmlCommand` | save-link `save-link-raw-html-command` Lambda finalizes the staged HTML and writes the tier-0 candidate: **the manifest carries `captureTrigger`**, with the reader and evaluation bodies | `TierContentExtractedEvent`, unchanged; a terminal parse error marks the crawl failed and the message is retried |
| `TierContentExtractedEvent` | save-link `select-most-complete-content` Lambda selects among the verified candidates; an automatic capture is judged like a crawl candidate | `CrawlArticleCompletedEvent` after `promoteTier` or `markNoReadableArticle`; `CanonicalContentChangedEvent` and `LinkSavedEvent` or `AnonymousLinkSavedEvent` when the canonical changes |
| Dead-lettered `SaveLinkRawHtmlCommand` | `save-link-failures-dlq` router hands it to the raw-html dead-letter handler, which **parses only `url`** and applies `markCrawlExhausted` | `CrawlArticleFailedEvent` for every row that is not `ready` |

---

## Known gaps recorded with the change

- **No client sends `automatic` yet.** The iOS and Android rescue and the extension's background-tab capture start sending it in their own changes, after store review. Until then every manifest the raw-html path writes says `manual`.
- **The upload-slot entity does not echo the trigger.** A client that completes an upload by posting only the completion action's declared fields sends no trigger, and the server reads that as a tap. A client that wants the trigger on a completion appends the part to the completion form itself; the extension's background-tab capture is to do so in its own change.
- **The deploy window loses in-flight captures from before the deploy.** The loss is terminal, not self-healing: the reader captures the page again. The alternative was to make the field optional for one release, which weakens an internal contract for a window of minutes, and it was not taken.
- **A judged-none automatic capture rewrites a blocked reason to `parse-error`.** This is what a tapped blank page already does, and it is recorded rather than changed.

---

## Source evidence at capture time

| Boundary | Evidence |
|---|---|
| Intake | [Readlist routes, save-content and save-articles](../../projects/hutch/src/runtime/web/pages/readlist/readlist.page.ts), [collection Siren actions](../../projects/hutch/src/runtime/web/api/collection-siren.ts), [upload-slot entity](../../projects/hutch/src/runtime/web/api/upload-slot-siren.ts) |
| Command contract | [Event catalogue](../../src/packages/hutch-infra-components/src/events.ts), [publisher contract](../../src/packages/provider-contracts/src/events.ts), [capture trigger schema](../../src/packages/domain/src/article/article.schema.ts) |
| Raw-html worker | [Command handler](../../projects/save-link/src/runtime/domain/save-link-raw-html/save-link-raw-html-command-handler.ts), [candidate provenance](../../projects/save-link/src/runtime/domain/select-content/candidate-provenance.ts), [manifest schema](../../projects/save-link/src/runtime/domain/select-content/tier-source.types.ts) |
| Selection | [Selection preparation and comparison log line](../../projects/save-link/src/runtime/domain/select-content/prepare-content-selection.ts), [selection outcomes](../../projects/save-link/src/runtime/domain/select-content/select-content-work.ts) |
| Dead letters | [Raw-html dead-letter handler](../../projects/save-link/src/runtime/domain/crawl-article-state/save-link-raw-html-dlq-handler.ts), [shared DLQ router composition root](../../projects/save-link/src/runtime/save-link-failures-dlq.main.ts), [crawl-exhausted transition](../../src/packages/domain/src/article-aggregate/transitions/mark-crawl-exhausted.ts) |
| Infrastructure | [save-link infrastructure](../../projects/save-link/src/infra/index.ts), [queue component and its default receive count](../../src/packages/hutch-infra-components/src/infra/sqs-queue.ts), [event bus rules](../../src/packages/hutch-infra-components/src/infra/event-bus.ts) |
