# Import the missing part of a Gmail newsletter

Captured from the working tree over `79e3a0c33` for a PR against `main`.

## Legend

![Legend](diagrams/legend.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
  C["Command"]:::cmd
  S["System"]:::sys
  E["Event"]:::evt
  P["Policy"]:::pol
  D[("Store")]:::store
  Q["Queue"]:::queue
  F["Dead-letter queue"]:::dlq
  N["Changed in this snapshot"]:::new
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8
  classDef sys fill:#fff2a8,stroke:#a08a00
  classDef evt fill:#ffb976,stroke:#a85800
  classDef pol fill:#d6b8ff,stroke:#6b3fb0
  classDef store fill:#b8e8c5,stroke:#2f7a45
  classDef queue fill:#e8e8e8,stroke:#666
  classDef dlq fill:#f8c8c8,stroke:#a83434
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px
```

</details>

## Import and save

![Import and save](diagrams/import-and-save.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  UI["Import unread messages form"]:::cmd --> WEB["Gmail newsletters route"]:::sys
  WEB --> START["Start or continue Gmail history import"]:::cmd
  START --> IMPORT["Import queue and worker"]:::queue
  IMPORT --> GMAIL["Gmail API checks unread messages in the last 30 days"]:::sys
  GMAIL --> RAW[("Raw message in S3")]:::store
  RAW --> FETCHED["GmailHistoryImportMessageFetched"]:::evt
  FETCHED --> INGEST["Ingest queue and Lambda"]:::queue
  INGEST --> ID[("Existing email identity and canonical inbox entry")]:::store
  ID --> COVERED{"Does the original delivery cover the request?"}
  COVERED -->|"Yes"| ALREADY["Already imported"]:::pol
  COVERED -->|"Missing part"| CLAIM[("Conditionally store missing mode, destinations and origin")]:::new
  CLAIM -->|"Winner or same attempt"| ACCEPT["Imported"]:::pol
  CLAIM -->|"Other attempt already won"| ALREADY
  COVERED -->|"New email"| INITIAL["Store initial inbox entry and routing"]:::sys
  INITIAL --> ACCEPT
  ACCEPT --> OUTCOME["GmailHistoryImportMessageIngested"]:::evt
  ALREADY --> OUTCOME
  OUTCOME --> SUMMARY[("Import job counters")]:::store
  ACCEPT --> RECEIVED["EmailReceived carries supplemental for missing work"]:::new
  RECEIVED --> EXTRACT["Extract queue and Lambda"]:::queue
  EXTRACT --> PLAN[("Reuse completed link rows and freeze the missing output selection")]:::new
  PLAN --> SAVES["SaveEmailIssue or SubmitLink for unacknowledged outputs"]:::cmd
  PLAN --> TRIAGE["EmailLinksTriaged for the selected article readlists"]:::evt
  TRIAGE --> FILTER["Readlist matching queue and worker"]:::queue
  FILTER --> MATCH["File kept links and record each readlist decision"]:::sys
  PLAN --> SELECTED["EmailOutputsSelected carries supplemental, including zero outputs"]:::new
  INGEST -.-> DLQ["Existing queue failure routes"]:::dlq
  EXTRACT -.-> DLQ
  classDef cmd fill:#a6d8ff,stroke:#1e6fb8
  classDef sys fill:#fff2a8,stroke:#a08a00
  classDef evt fill:#ffb976,stroke:#a85800
  classDef pol fill:#d6b8ff,stroke:#6b3fb0
  classDef store fill:#b8e8c5,stroke:#2f7a45
  classDef queue fill:#e8e8e8,stroke:#666
  classDef dlq fill:#f8c8c8,stroke:#a83434
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px
```

</details>

## Completion and Gmail update

![Completion and Gmail update](diagrams/completion.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  SAVE["Issue or article saver writes to All"]:::sys --> ACK["EmailOutputSavedToAll"]:::evt
  SELECT["EmailOutputsSelected"]:::evt --> WORKER["Import completion queue and Lambda"]:::queue
  ACK --> WORKER
  WORKER --> STATE[("Accumulate saved outputs and check the relevant selection")]:::new
  STATE -->|"All selected outputs present and selection complete"| MARK["MarkGmailEmailImported carries supplemental for missing work"]:::new
  MARK --> UPDATE["Gmail message update queue and Lambda"]:::queue
  UPDATE --> OPT{"Automatic marking enabled?"}
  OPT -->|"Yes"| RECORD[("Per-origin update record with a separate key for supplemental work")]:::new
  RECORD -->|"Pending with modify access"| API["Gmail adds the imported label and removes UNREAD"]:::sys
  RECORD -->|"Pending without modify access"| GRANT["GmailModifyPermissionGranted resumes pending updates"]:::evt
  GRANT --> UPDATE
  API --> DONE["GmailEmailMarkedImported"]:::evt
  UPDATE -.-> DLQ["Gmail update dead-letter handler"]:::dlq
  classDef sys fill:#fff2a8,stroke:#a08a00
  classDef evt fill:#ffb976,stroke:#a85800
  classDef queue fill:#e8e8e8,stroke:#666
  classDef dlq fill:#f8c8c8,stroke:#a83434
  classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px
```

</details>

EventBridge routes the messages to the existing queues. The extraction worker
can query the links table for the canonical email’s preview rows. Each import attempt
uses its staged raw key to resume its accepted work and destinations. Other
attempts report that the request is covered. The original output selection
and saved-output acknowledgments stay on the canonical row. Records with no
delivery mode use their stored output selection and the legacy links default.

| Command or event | System | Outcome or next command |
|---|---|---|
| `StartGmailHistoryImport`, `ProcessGmailHistoryImportPage` | Gmail history import | Stage unread messages, publish `GmailHistoryImportMessageFetched`, and continue paging |
| `GmailHistoryImportMessageFetched` | Inbox ingestion | Dispatch `EmailReceived` for accepted work and report `GmailHistoryImportMessageIngested` |
| `GmailHistoryImportMessageIngested` | Import outcome recorder | Update the job counters and complete the job once all messages settle |
| `EmailReceived` | Link extraction | Select outputs, dispatch `SaveEmailIssue` or `SubmitLink`, publish `EmailLinksTriaged` and `EmailOutputsSelected` |
| `EmailLinksTriaged` | Readlist matching | File matches and publish the readlist decision |
| `SaveEmailIssue`, `SubmitLink` | Save workers | Publish `EmailOutputSavedToAll` after the saved output is available in All |
| `EmailOutputsSelected`, `EmailOutputSavedToAll` | Import completion | Dispatch `MarkGmailEmailImported` when the relevant selection is complete |
| `MarkGmailEmailImported`, `GmailModifyPermissionGranted` | Gmail message update | Apply or resume the opted-in Gmail update, then report its outcome |
