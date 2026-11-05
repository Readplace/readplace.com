# An uploaded EPUB becomes a private tier-0 source

Snapshot of the uncommitted working tree over `9696da7db` (`main`), whose 2026-11-05 subject is **feat(hutch): settle a failed media upload on its card**. Generated 2026-11-05.

A new deployable, `media-book`, subscribes to `MediaUploadCommitted` for the `book` kind. Nothing in this tree publishes that event yet; the upload route that does lands in a later change.

- **Process.** The `media-book-process-book` Lambda reads the committed upload from the media bucket's `pending/<uploadId>/original`, conditional on the committed ETag. It refuses a DRM-protected book and a file that is not an EPUB, builds one reader body (a table of contents, then one `section-ch-N` heading per chapter, images dropped), and refuses a body over the reader's byte limit.
- **Record.** It records the chapter count on the private item row. When the row is gone or tombstoned the item was released while the book was processing: it writes nothing more and publishes nothing.
- **Announce.** Otherwise it writes the tier-0 source, bound to this save's attempt, and publishes `TierContentExtracted`, which content selection already consumes.
- **Fail.** Each refusal publishes `MediaProcessingFailed` with its reason and notice, which `settle-media-failure` settles on the card. A message that fails two receives lands in the `media-book-failures` DLQ, whose router publishes `MediaProcessingFailed` with reason `processing-exhausted`.

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
    P{{"Policy / reaction"}}:::policy
    R[("Read model / store")]:::store
    Q[("Queue")]:::queue
    D[("DLQ")]:::dlq
    N["Added by this change"]:::new
```

</details>

---

## Processing a book

The bus carries `MediaUploadCommittedEvent` to the new rule, filtered to the `book` kind. The Lambda takes one message at a time.

![Processing a book](diagrams/process-book.svg)

[BPMN image](diagrams-bpmn/process-book.png) · [Editable BPMN](diagrams-bpmn/process-book.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#000

    Committed(("MediaUploadCommitted<br/>kind = book")):::event
    Q["media-book-process-book-q"]:::new
    P["media-book-process-book<br/>Lambda"]:::new
    Media[("media bucket<br/>pending/&lt;uploadId&gt;/original")]:::store
    Row[("articles table<br/>media.sectionCount")]:::store
    Content[("content bucket<br/>tier-0 source")]:::store
    Extracted(("TierContentExtracted")):::event
    Select["select-most-complete-content"]:::system
    Failed(("MediaProcessingFailed")):::event
    Settle["settle-media-failure"]:::system
    DLQ["media-book-failures DLQ"]:::new
    Router["media-book-failures-dlq<br/>Lambda"]:::new

    Committed --> Q --> P
    P -- "GetObject IfMatch etag" --> Media
    P -- "recordPrivateItemSections" --> Row
    P -- "putTierSource" --> Content
    P --> Extracted --> Select
    P -- "staged-bytes-gone / unreadable / too-large-for-reader" --> Failed
    Q -- "after 2 receives" --> DLQ --> Router
    Router -- "processing-exhausted" --> Failed
    Failed --> Settle
```

</details>

---

## Command → System → Event(s) reference

| Command or event | Detail | System | Emits | Triggers next |
|---|---|---|---|---|
| `MediaUploadCommittedEvent` (rule for `media-book-process-book`, new, kind `book`) | `uploadId`, `kind`, `url`, `userId`, `saveAttemptId`, `etag`, `attempt` | `media-book-process-book` Lambda (new) | `TierContentExtracted`, or `MediaProcessingFailed` with `staged-bytes-gone`, `unreadable` or `too-large-for-reader` | content selection, or `settle-media-failure` |
| Private item row gone or tombstoned | — | `media-book-process-book` Lambda (new) | nothing | the record is acknowledged |
| Malformed message or a throwing step | — | `media-book-process-book` queue | nothing | retried, then the `media-book-failures` DLQ |
| `media-book-failures` DLQ message | the original command | `media-book-failures-dlq` Lambda (new) | `MediaProcessingFailed` with `processing-exhausted` | `settle-media-failure` |
| `TierContentExtracted` | tier-0 source bound to the save attempt | `select-most-complete-content` | existing selection events | existing selection chain |
| `MediaProcessingFailed` | `reason`, `notice` | `settle-media-failure` | nothing | marks the card failed with the notice |
