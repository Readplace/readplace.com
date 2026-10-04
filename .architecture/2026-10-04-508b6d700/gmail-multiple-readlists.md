# Gmail newsletters: mandatory All and multiple readlists

Snapshot of the uncommitted working tree over `508b6d70027f4488b4eec9d3a3b9e05b18418add` (`main`), whose 2026-10-04 subject is **feat: notify readers about approved Gmail newsletters**. Generated 2026-10-04. The base commit identifies the starting point; the highlighted routing changes are not committed at capture time.

Every mapped Gmail newsletter sends eligible articles to All and optionally several independently filtered custom readlists. Existing scalar mappings and imports remain readable. Changes apply to future deliveries and newly consented imports; previously handled messages are not replayed. The [approved-newsletter notification snapshot](../2026-10-04-f532f07f0/gmail-newsletter-notifications.md) remains the record of the monitoring infrastructure, baseline and receipt protocol. New notification content describes multiple readlists and uses sender-bound confirmation; already-claimed payloads and stable retry keys are retained.

## Legend

Gold outlines identify behavior added or materially changed in this working tree; role colors identify the established infrastructure and contracts.

![Legend](diagrams/legend.svg)

[BPMN image](diagrams-bpmn/legend.png) · [Editable BPMN](diagrams-bpmn/legend.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
  C[Command]:::command --> S[System or aggregate]:::system --> E((Event)):::event --> P[Policy or reaction]:::policy
  R[(Read model or store)]:::store
  Q[(SQS queue)]:::queue
  D[(Dead letter queue)]:::dlq
  U[Reader action]:::ui
  N[Changed behavior]:::new
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#111;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#111;
  classDef event fill:#ffb976,stroke:#a85800,color:#111;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#111;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#111;
  classDef queue fill:#e8e8e8,stroke:#666,color:#111;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#111;
  classDef ui fill:#fff,stroke:#555,color:#111;
  classDef new fill:#ffe599,stroke:#c78c00,stroke-width:3px,color:#111;
```

</details>

## Mapping selection and notification choice

All is always selected and locked. URL state carries repeated `readlist` values; ownership checks apply to every custom selection. Saved destinations are identified by `mappedAddresses`: they control picker preselection and satisfy the notification choice requirement. A notification for a sender without saved destinations, with custom lists available, starts with a sender-bound pending choice. GET confirmation explicitly accepts All-only; a JavaScript checkbox change submits the same action. Saved destinations and ordinary valid sender entry can Save immediately. Only-All accounts also Save immediately. Search, polling, login return, browser history, validation and failed inline creation preserve selections and the pending sender; highlight dismissal is a separate transient concern.

The resolver stores custom destinations, with All implicit, or the existing All address for All-only. `addedToFilterAt` remains authoritative for Gmail monitoring, saved-sender eligibility and import activation under the existing filter contract. Mapping changes preserve that timestamp, sightings, observations, receipts and checkpoints. Reordering the destination set preserves the saved order and mapping timestamp. An actual change cancels unfinished imports for that sender. The first filter activation starts a history import only when the reader explicitly chose the import checkbox.

![Mapping selection and notification choice](diagrams/mapping-selection.svg)

[BPMN image](diagrams-bpmn/mapping-selection.png) · [Editable BPMN](diagrams-bpmn/mapping-selection.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Entry[Ordinary entry, existing mapping, or newsletter notice]:::ui --> Auth[API Gateway and web Lambda<br/>Authenticate with full return URL]:::system
  Auth --> State[Native selection form<br/>All locked; preselect saved mappedAddresses<br/>independent custom checkboxes]:::new
  State --> Choice{Notification awaiting destination choice?}
  Choice -->|no saved destinations; custom lists available| Pending[Save disabled<br/>readlist_choice_for bound to sender]:::new
  Pending --> Confirm[GET Confirm readlists<br/>All-only is explicit; JS checkbox submits same action]:::command
  Confirm --> State
  State --> Preserve[GET search, polling and browser history<br/>retain repeated readlists and pending sender]:::policy
  Preserve --> State
  State --> Create[POST /gmail/readlists/create]:::command
  Create --> Created[Create or reuse owned readlist<br/>append selection; fulfill matching pending choice]:::new
  Create -->|validation or limit failure| Preserve
  Created --> State
  Choice -->|ordinary, saved destinations, confirmed, or only All| Save[POST /gmail/senders/add<br/>optional explicit import consent]:::command
  Save --> Validate[Validate sender against current mailbox or observations<br/>validate ownership of every selected custom list]:::system
  Validate -->|invalid or pending| Preserve
  Validate --> Resolve[Resolve distinct custom addresses<br/>All address when no customs selected]:::new
  Resolve --> Rows[(Existing sender and readlist address tables<br/>scalar primary plus optional additional addresses)]:::store
  Resolve --> Changed{Existing complete set changed?}
  Changed -->|yes| Cancel[Cancel unfinished sender imports<br/>destination-changed]:::new
  Changed -->|no or first mapping| Filter[RewriteGmailFilterCommand]:::command
  Cancel --> Filter
  Filter --> FilterQ[(Existing rewrite-gmail-filter queue)]:::queue
  FilterQ --> Reconcile[Reconcile Gmail forwarding rule to gateway<br/>create replacement, verify, remove old rule]:::system
  Reconcile --> Gmail[(Gmail filter API and connection status)]:::store
  FilterQ -. retry exhaustion .-> FilterDLQ[(Existing alarmed DLQ)]:::dlq
  Resolve --> Catalog{Catalog exact match?}
  Catalog -->|no or unavailable| Suggest[SubmitNewsletterSenderCommand]:::command
  Suggest --> CatalogQ[(Existing newsletter suggestion queue)]:::queue
  CatalogQ --> CatalogWrite[ETag-conditional pending catalog suggestion]:::system
  CatalogWrite --> CatalogStore[(Existing S3 newsletter catalog)]:::store
  Save --> Import{First filter activation with explicit import consent?}
  Import -->|yes| ImportStart[Snapshot destinations and request import consent/start]:::new
  Import -->|no| Redirect[303 registry; All first then custom names]:::policy
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#111;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#111;
  classDef event fill:#ffb976,stroke:#a85800,color:#111;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#111;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#111;
  classDef queue fill:#e8e8e8,stroke:#666,color:#111;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#111;
  classDef ui fill:#fff,stroke:#555,color:#111;
  classDef new fill:#ffe599,stroke:#c78c00,stroke-width:3px,color:#111;
```

</details>

## One accepted message and its destination snapshot

SES stores forwarded raw mail in the existing S3 bucket and notifies the receive queue through SNS. Confirmation mail is intercepted before remote images. Gateway arrivals from unmapped senders are held without extraction. Legacy Gmail-mapped addresses use the sender mapping when present, otherwise their addressed destination. Ordinary inbox delivery keeps its separate routing variant.

A Gmail arrival is ingested once with the complete destination snapshot. The email identity claim joins forwarded and imported copies by reader, normalized message id and sender, adopts pre-claim received rows, and permits retry or takeover only when no accepted row exists. A retry of the same raw object first looks for its accepted Gmail row and republishes that row's original destinations before current mapping, destination retirement or import cancellation gates. Different delivery copies still follow the identity claim. This prevents a later mapping edit from rerouting or stranding an accepted message. Previously handled mail is never reprocessed by mapping edits.

![One accepted message and its destination snapshot](diagrams/message-ingress.svg)

[BPMN image](diagrams-bpmn/message-ingress.png) · [Editable BPMN](diagrams-bpmn/message-ingress.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Mail((Gmail forwarded mail or ordinary inbox mail)):::event --> SES[SES catch-all receipt]:::system
  SES --> Raw[(Existing immutable raw-email S3 bucket)]:::store
  SES --> SNS[(SNS notification topic)]:::queue
  SNS --> ReceiveQ[(Existing inbox-receive-email SQS queue)]:::queue
  ReceiveQ --> Receive[Receive Lambda<br/>resolve live recipients, byte cap, MIME parse]:::system
  Receive --> Invalid{Deliverable and parseable?}
  Invalid -->|unknown, disabled, no recipient| Audit[Audit row where applicable; acknowledge]:::policy
  Invalid -->|oversize or malformed deliverable| AuditError[Audit row then retry and alarm]:::policy
  AuditError -. exhausted .-> ReceiveDLQ[(Existing receive DLQ)]:::dlq
  Invalid -->|yes| Confirmation{Gmail confirmation mail?}
  Confirmation -->|yes| Confirm[Existing confirmation worker<br/>confirm forwarding and reconcile rule]:::system
  Confirmation -->|no| Kind{Address purpose?}
  Kind -->|ordinary| Ordinary[Required routing kind inbox]:::new
  Kind -->|gateway or legacy Gmail-mapped| Accepted[Look up accepted Gmail row<br/>same email key and raw object]:::new
  Accepted -->|matching received row| Resume[Republish original accepted snapshot<br/>before current routing gates]:::new
  Accepted -->|none| Route[Record sighting; resolve nonempty sender destinations]:::new
  Route --> Mapping[(Existing Gmail sender table)]:::store
  Route -->|unmapped gateway| Held[(Existing held-mail table<br/>no image fetch or event)]:::store
  Route -->|mapped or legacy addressed fallback| Snapshot[Required routing kind gmail<br/>complete destinationAddresses snapshot]:::new
  Snapshot --> Identity[Conditional message identity claim<br/>adopt old received row or retry incomplete attempt]:::system
  Ordinary --> Identity
  Identity -->|already accepted elsewhere| Duplicate[Acknowledge without reprocessing]:::policy
  Identity -->|proceed, or unclaimable forwarded identity| Ingest[Download images once, sanitize body<br/>conditional email write with destinations]:::new
  Raw --> Ingest
  Ingest --> Body[(Existing content S3 and inbox email table)]:::store
  Ingest -->|empty sanitized body| Unparsed[Store unparsed email; no EmailReceivedEvent]:::policy
  Ingest -->|stored or same-attempt retry| Received((EmailReceivedEvent<br/>accepted row supplies original snapshot)):::new
  Resume --> Received
  Received --> ExtractQ[(Existing inbox-extract-email-links queue)]:::queue
  Fetched((GmailHistoryImportMessageFetchedEvent)):::event --> ImportQ[(Existing inbox-ingest-gmail-import queue)]:::queue
  ImportQ --> ImportRead[Load known job, cap and parse raw mail<br/>verify sender and message id]:::system
  ImportRead --> ImportAccepted{Same raw accepted Gmail row?}
  ImportAccepted -->|yes| Resume
  ImportAccepted -->|no| ImportIngest[Validate running generation and destination set<br/>every live owned destination]:::new
  ImportIngest -->|valid| Identity
  ImportIngest -->|cancelled, mismatch, missing id| Outcome((GmailHistoryImportMessageIngestedEvent)):::event
  Ingest -->|import attempt| Outcome
  ImportQ -. exhausted .-> ImportDLQ[(Existing inbox failure DLQ<br/>publish failed ingestion outcome)]:::dlq
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#111;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#111;
  classDef event fill:#ffb976,stroke:#a85800,color:#111;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#111;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#111;
  classDef queue fill:#e8e8e8,stroke:#666,color:#111;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#111;
  classDef ui fill:#fff,stroke:#555,color:#111;
  classDef new fill:#ffe599,stroke:#c78c00,stroke-width:3px,color:#111;
```

</details>

## Triage, mandatory All, previews and custom fan-out

Email extraction re-derives links from the immutable raw mail. Normal action-link classification and article triage still determine eligibility; non-article and unsafe links are not made eligible by the mandatory-All rule. Article triage unavailability keeps the existing fail-open behavior. Backfill and unrouted audit mail remain preview-only. Readers with insufficient write access receive the existing saves-held notice.

For an eligible full-access Gmail article, the extractor publishes `SubmitLinkCommand` for All before its preview command. After all preview rows and counts are written, Gmail extraction records its complete selected custom-list snapshot with display labels, `eligibleArticleCount` and `savesHeld`. Only a successful metadata write permits the independent `EmailLinksTriagedEvent` for each custom list, including an empty event when no eligible links remain. This ordering prevents late custom results from mistaking an extraction-failure marker for historical scalar metadata. Ordinary custom inbox routing retains its established event-before-metadata order. This is one extraction and one preview per article, not one per list. A held delivery records the same selection without save or filter commands; its UI shows the held state without polling custom decisions. Zero-eligible mail does not trigger the first-inbox-email notice. A crash can republish commands while a link stays pending; duplicate submissions converge to membership through the existing save pipeline, while duplicate crawling remains possible.

![Triage, mandatory All, previews and custom fan-out](diagrams/extract-and-save-all.svg)

[BPMN image](diagrams-bpmn/extract-and-save-all.png) · [Editable BPMN](diagrams-bpmn/extract-and-save-all.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Received((EmailReceivedEvent)):::event --> Q[(Existing extraction queue)]:::queue
  Q --> Extract[Extract Lambda<br/>read received row and raw mail; parse and sanitize]:::system
  Extract --> Links[Extract and cap URLs<br/>skip action links; batch normal article triage]:::system
  Links --> LinkRows[(Existing email-links partition<br/>conditional ordinal rows)]:::store
  Links --> Eligible{Article candidate and saveable URL?}
  Eligible -->|no| Skip[Terminal normal skipped row<br/>no save or preview for excluded links]:::policy
  Eligible -->|yes| Access{Origin, owner and write access?}
  Access -->|backfill or audit| Preview[CrawlEmailLinkPreviewCommand]:::command
  Access -->|read only| Hold[Existing SendSavesHeldNoticeCommand<br/>once per email]:::command
  Hold --> Preview
  Access -->|full Gmail| All[SubmitLinkCommand readlist All<br/>publish before preview]:::new
  All --> Preview
  All --> First[Existing SendFirstInboxEmailNoticeCommand]:::command
  Access -->|full ordinary inbox| InboxRoute{Named inbox has custom route?}
  InboxRoute -->|no or All| All
  InboxRoute -->|custom| Preview
  LinkRows --> Pending{Stored link is pending?}
  Pending -->|terminal duplicate| NoPublish[Keep existing terminal result]:::policy
  Pending -->|pending| Preview
  Preview --> PreviewQ[(Existing preview queue)]:::queue
  PreviewQ --> Crawl[Preview Lambda<br/>crawl metadata; update preview outcome only]:::system
  Crawl --> LinkRows
  PreviewQ -. exhausted .-> PreviewDLQ[(Existing inbox failure DLQ<br/>conditional pending-to-failed outcome)]:::dlq
  Extract --> Custom[Snapshot full custom selection with labels<br/>including zero eligible and held deliveries]:::new
  Custom --> Kind{Gmail routing snapshot?}
  Kind -->|yes| GmailBarrier[Write counts and metadata after preview rows<br/>preserve selected labels, eligible count and saves held]:::new
  GmailBarrier --> Meta[(Existing email-links extraction metadata)]:::store
  GmailBarrier -->|write succeeded| CustomAccess{Full write access and custom selections?}
  CustomAccess -->|yes| Fanout[EmailLinksTriagedEvent<br/>one per Gmail custom list; empty input allowed]:::new
  CustomAccess -->|held or no custom selections| Done[Extraction complete or saves held]:::policy
  Fanout --> FilterQ[(Existing filter-email-links queue)]:::queue
  Kind -->|ordinary inbox| OrdinaryAccess{Full write access and routed custom links?}
  OrdinaryAccess -->|yes| OrdinaryFanout((EmailLinksTriagedEvent<br/>ordinary scalar route)):::event
  OrdinaryFanout --> FilterQ
  OrdinaryFanout --> OrdinaryBarrier[Existing counts and scalar metadata write<br/>after ordinary filtering publication]:::system
  OrdinaryAccess -->|no| OrdinaryBarrier
  OrdinaryBarrier --> Meta
  Extract --> Truncated{Link cap exceeded?}
  Truncated -->|yes| Alert[(Existing truncation alert queue and alarm)]:::dlq
  Q -. retry exhaustion .-> DLQ[(Existing inbox failure DLQ)]:::dlq
  DLQ --> Failed[Conditional extraction-failed barrier<br/>only if no completed metadata exists]:::system
  Failed --> Meta
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#111;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#111;
  classDef event fill:#ffb976,stroke:#a85800,color:#111;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#111;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#111;
  classDef queue fill:#e8e8e8,stroke:#666,color:#111;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#111;
  classDef ui fill:#fff,stroke:#555,color:#111;
  classDef new fill:#ffe599,stroke:#c78c00,stroke-width:3px,color:#111;
```

</details>

## Independent custom decisions and terminal results

The existing filter worker evaluates each custom list separately. A list with no purpose keeps all links without a model call; a deleted list falls back to All. Empty input emits a terminal zero result without a model request or save command. Otherwise one thinking-mode model request must classify every input ordinal. It publishes save commands for kept links before the successful filtering event. Exhaustion publishes the failure event for that list.

For Gmail snapshots, filtering publication follows a successful extraction metadata write. The recorder reads the existing primary email-links partition with a consistent Query, so a completed Gmail barrier cannot be mistaken for an older scalar-shaped extraction-failure marker. It still retries out-of-order facts when metadata is absent, verifies that the list belongs to the accepted selection, and conditionally inserts its first terminal outcome in a reserved `readlist#<slug>` row in the existing email-links partition. Extraction exhaustion cannot overwrite completed Gmail metadata with a scalar-shaped failure marker. A custom rejection does not change the base preview row or email counts, so an article retained in All remains visible. The read side shows each list's pending, accepted, rejected or failed result. Historical scalar decisions and ordinary routed inbox mail keep the existing dropped-row and recount behavior.

![Independent custom decisions and terminal results](diagrams/custom-filtering-results.svg)

[BPMN image](diagrams-bpmn/custom-filtering-results.png) · [Editable BPMN](diagrams-bpmn/custom-filtering-results.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Triaged((EmailLinksTriagedEvent<br/>one email and one custom readlist)):::event --> Q[(Existing filter-email-links queue<br/>two receives before shared failure DLQ)]:::queue
  Q --> Filter[Filter Lambda<br/>load owned list definition]:::system
  Filter --> Purpose{Current list and purpose?}
  Purpose -->|missing| Missing[Keep all; destination All]:::policy
  Purpose -->|no purpose| Keep[Keep all; destination custom list]:::policy
  Purpose -->|purpose| HasLinks{Eligible input links?}
  HasLinks -->|yes| Model[DeepSeek thinking request<br/>validate complete ordinal decisions]:::system
  HasLinks -->|none| Zero[Terminal zero result<br/>no model call or save command]:::new
  Model --> Verdict[Independent kept ordinals and dropped reasons]:::new
  Missing --> Verdict
  Keep --> Verdict
  Verdict --> Save[SubmitLinkCommand<br/>one per kept link, before success fact]:::command
  Verdict --> Filtered((EmailLinksFilteredEvent)):::event
  Zero --> Filtered
  Q -. exhausted .-> DLQ[(Existing save-link shared failures DLQ)]:::dlq
  DLQ --> FailWorker[Existing filter DLQ handler]:::system
  FailWorker --> Failed((EmailLinksFilterFailedEvent)):::event
  Filtered --> RecordQ[(Existing inbox-record-email-links-filtered queue<br/>two EventBridge rules, union queue policy)]:::queue
  Failed --> RecordQ
  RecordQ --> Recorder[Outcome recorder Lambda<br/>consistent primary partition Query for extraction barrier]:::new
  Recorder --> Ready{Extraction metadata exists?}
  Ready -->|no| Retry[Retry out-of-order fact<br/>until extraction metadata exists]:::policy
  Retry --> RecordQ
  Ready -->|yes| Format{Gmail selectedReadlists snapshot?}
  Format -->|yes| Membership[Verify result belongs to snapshot<br/>conditional first-terminal outcome insertion]:::new
  Membership --> Outcomes[(Existing email-links partition<br/>reserved row per list; base previews unchanged)]:::new
  Outcomes --> UI[Retained All articles stay visible<br/>named per-list results; zero and held states use metadata]:::new
  Format -->|historical scalar or ordinary inbox| Scalar[Mark rejected link rows; settle scalar decision<br/>recount kept and skipped]:::system
  Scalar --> BaseRows[(Existing preview rows and email counts)]:::store
  RecordQ -. exhausted .-> RecordDLQ[(Existing alarmed recorder DLQ)]:::dlq
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#111;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#111;
  classDef event fill:#ffb976,stroke:#a85800,color:#111;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#111;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#111;
  classDef queue fill:#e8e8e8,stroke:#666,color:#111;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#111;
  classDef ui fill:#fff,stroke:#555,color:#111;
  classDef new fill:#ffe599,stroke:#c78c00,stroke-width:3px,color:#111;
```

</details>

## Consented imports, continuation, cancellation and outcomes

The optional new-mapping import and the registry import action snapshot the full destination selection, sender and mailbox identity. They list only unread mail from the previous 30 days, excluding spam and trash. Read-only OAuth consent remains explicit and incremental; mapping alone grants no import permission. Retry retains the original window and snapshot, changes generation, and re-lists only unsettled messages.

Each page checks the current mailbox and the complete unordered mapping set before taking its lease. Mapping removal, any selected destination change, mailbox switch, disconnect or explicit cancellation stop unfinished work. The existing page worker deliberately self-loops through its progress event and own SQS queue; recursive-loop detection remains Allow. Ingestion outcomes count each message once in a generation and complete the job only after listing and all message outcomes settle. Import completion describes ingestion, not eventual custom-filter or crawl completion.

![Consented imports, continuation, cancellation and outcomes](diagrams/history-import-lifecycle.svg)

[BPMN image](diagrams-bpmn/history-import-lifecycle.png) · [Editable BPMN](diagrams-bpmn/history-import-lifecycle.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Start[POST mapping with import consent<br/>or POST /gmail/imports/start]:::command --> Snapshot[Validate owned live destinations<br/>snapshot sender, mailbox and destinationAddresses]:::new
  Snapshot --> Jobs[(Existing Gmail history-import table<br/>scalar primary plus optional additional destinations)]:::store
  Snapshot --> Consent{Read-only scope already granted?}
  Consent -->|no| OAuth[Explicit incremental OAuth permission<br/>return to import state]:::ui
  OAuth -->|declined or revoked| Waiting[Await permission or show retryable error]:::policy
  OAuth -->|granted| Resume[Start/retry job with fresh generation<br/>preserve window and settled counts]:::system
  Consent -->|yes| Resume
  Resume --> Command[StartGmailHistoryImportCommand]:::command
  Command --> PageQ[(Existing gmail-history-import queue<br/>five receives; recursiveLoop Allow)]:::queue
  PageQ --> Worker[Import page Lambda<br/>check state, generation, page and connection]:::system
  Worker --> Current[Compare full unordered mapping snapshot<br/>claim page lease]:::new
  Current -->|mismatch, removed, disconnected| Cancel[Cancel unfinished sender jobs]:::new
  Cancel --> Jobs
  Current -->|current| List[Read-only Gmail API<br/>unread sender mail within 30-day window]:::system
  List --> Fetch[Fetch raw; omit gone, spam and trash<br/>write S3 before fetched record/event]:::system
  Fetch --> Raw[(Existing raw-email bucket<br/>gmail-import reader/job/message prefix)]:::store
  Fetch --> Jobs
  Fetch --> Fetched((GmailHistoryImportMessageFetchedEvent<br/>complete accepted destination snapshot)):::new
  Fetched --> IngestQ[(Existing inbox import-ingestion queue)]:::queue
  IngestQ --> Ingest[Shared one-message identity and ingestion path]:::system
  Ingest --> Ingested((GmailHistoryImportMessageIngestedEvent)):::event
  Ingested --> OutcomeQ[(Existing gmail-history-import-outcomes queue)]:::queue
  OutcomeQ --> Record[Transaction: fetched-to-terminal message<br/>increment one generation count; check settled job]:::system
  Record --> Jobs
  Record -->|listing done and all settled| Complete((GmailHistoryImportCompletedEvent<br/>reader registry reads stored counts)):::event
  Worker --> Progress((GmailHistoryImportPageProcessedEvent)):::event
  Progress --> PageQ
  PageQ --> Continue[Progress reaction sends ProcessGmailHistoryImportPageCommand<br/>directly to its own queue]:::policy
  Continue --> PageQ
  Worker -->|permission or Gmail rejection| Failed((GmailHistoryImportFailedEvent)):::event
  Worker -->|transient unavailable| Retry[Retry page with generation and lease fences]:::policy
  Retry --> PageQ
  PageQ -. exhausted .-> DLQ[(Existing shared Gmail history failure DLQ)]:::dlq
  OutcomeQ -. exhausted .-> DLQ
  DLQ --> DLQHandler[Existing router<br/>fail page job or settle outcome as failed]:::system
  DLQHandler --> Failed
  DLQHandler --> Record
  Start --> CancelUI[POST /gmail/imports/cancel]:::command
  CancelUI --> Cancel
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#111;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#111;
  classDef event fill:#ffb976,stroke:#a85800,color:#111;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#111;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#111;
  classDef queue fill:#e8e8e8,stroke:#666,color:#111;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#111;
  classDef ui fill:#fff,stroke:#555,color:#111;
  classDef new fill:#ffe599,stroke:#c78c00,stroke-width:3px,color:#111;
```

</details>

## Existing canonical save, membership and enrichment pipeline

Both mandatory-All submissions and accepted custom-list submissions reuse the existing `SubmitLinkCommand` consumer. It validates and normalizes the URL, resolves canonical identity and archive provenance, synchronously accepts the article into All, and files it into the requested custom list when applicable. Conditional per-user membership converges to one row per canonical article and destination. Repeated accepts can still bump save order or resurface read articles; at-least-once delivery can still repeat crawl work.

The submit worker keeps the existing archive behavior: capture URLs are saved under the original article, archive content becomes tier-2, live-origin content remains tier-1, and canonical selection compares every available tier. Crawl failures terminalize in process; accept failures retry and publish a queue-failed fact on exhaustion. Existing freshness, comprehensive crawl, selection, summary, related-article and reader-ready paths remain in place. No new worker, queue or permissions are introduced for saving to All.

![Existing canonical save, membership and enrichment pipeline](diagrams/submit-and-enrich.svg)

[BPMN image](diagrams-bpmn/submit-and-enrich.png) · [Editable BPMN](diagrams-bpmn/submit-and-enrich.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Commands[SubmitLinkCommand<br/>All or independently accepted custom list]:::command --> Q[(Existing submit-link queue<br/>three receives, shared save-link failure DLQ)]:::queue
  Q --> Submit[Submit Lambda<br/>validate URL; prepare normalization and freshness]:::system
  Submit --> Accept[Shared accept phase<br/>canonical identity; original URL for archive captures]:::system
  Accept --> Articles[(Existing article and per-user All membership rows)]:::store
  Accept --> List{Requested custom destination?}
  List -->|yes| File[File accepted canonical article into custom readlist]:::system
  File --> Custom[(Existing readlist memberships<br/>one row per article and destination)]:::store
  Accept --> Queued((LinkQueuedEvent)):::event
  Queued --> ReadQ[(Existing inbox saved-link recorder queues)]:::queue
  ReadQ --> Read[Accepted save outranks failure<br/>write inbox save-state read model]:::system
  Read --> ReadStore[(Existing inbox saved-link table)]:::store
  Accept -->|new reader membership, email provenance| Entry((QueueEntryCreatedEvent)):::event
  Entry --> RelatedQ[(Existing related-articles queue)]:::queue
  RelatedQ --> Related[Wait for settled content; select related saved/past articles<br/>write reader results; publish computed fact then log]:::system
  Accept --> Work{Freshness and archive enrichment?}
  Work -->|settled fresh| Done[Membership and accepted-save facts only]:::policy
  Work -->|stale| Refresh[Existing freshness and refresh worker chain<br/>live-origin or archived fallback]:::system
  Work -->|new or re-primed| Crawl[Live tier-1 crawl in process<br/>archive failure fallback stays owned by existing crawl logic]:::system
  Work -->|archive capture present| Capture[Fetch capture under original canonical article<br/>write archive tier-2; failure fact does not exhaust original]:::system
  Crawl -->|PDF or unsupported simple content| Comprehensive[SimpleCrawlUnsupportedEvent<br/>policy to ComprehensiveCrawlCommand and queued worker]:::policy
  Crawl -->|written| Tier((TierContentExtractedEvent)):::event
  Capture -->|written| Tier
  Comprehensive --> Tier
  Refresh --> Refreshed[Existing RefreshContentExtractedEvent<br/>refresh selector and canonical promotion]:::event
  Refreshed --> Canonical
  Tier --> SelectQ[(Existing content-selector queue)]:::queue
  SelectQ --> Select[Compare tier-0, live tier-1, archive tier-2<br/>promote winning content and metadata]:::system
  Select --> Canonical[(Existing canonical S3 objects and article state)]:::store
  Select --> Changed((CanonicalContentChangedEvent)):::event
  Changed --> SummaryQ[(Existing canonical-change and summary queues)]:::queue
  SummaryQ --> Summary[Re-prime summary; generate or skip<br/>write terminal article state]:::system
  Summary --> SummaryEvent((SummaryGenerated or failure<br/>terminal log consumer)):::event
  Summary --> Ready((ReaderViewLoadingSucceeded<br/>existing fanout and gated reader-ready notice)):::event
  Crawl -->|crawl error| Terminal[markCrawlExhausted<br/>CrawlArticleFailedEvent and existing failure log]:::system
  Q -. accept exhaustion .-> DLQ[(Existing save-link failure DLQ)]:::dlq
  DLQ --> QueueFailed((LinkQueueFailedEvent)):::event
  QueueFailed --> ReadQ
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#111;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#111;
  classDef event fill:#ffb976,stroke:#a85800,color:#111;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#111;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#111;
  classDef queue fill:#e8e8e8,stroke:#666,color:#111;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#111;
  classDef ui fill:#fff,stroke:#555,color:#111;
  classDef new fill:#ffe599,stroke:#c78c00,stroke-width:3px,color:#111;
```

</details>

## Destination deletion, disconnect and account erasure

Deleting a selected readlist removes only its address from affected sender selections. Remaining custom destinations are retained; a sender whose final custom destination was removed uses All. The change cancels unfinished imports before the address is retired and the list definition deleted, then reconciles the existing Gmail forwarding rule.

Disconnect cancels jobs, removes saved senders and the Gmail forwarding filter, revokes the grant, disables the gateway and deletes the connection/discovery state. Notification monitoring receipts survive reconnect as before; only account erasure deletes them. Account deletion queries the existing reader partitions, removes email/link/result/identity/import/monitoring state and S3 raw/body/image objects, retires address claims and tombstones addresses, then completes the existing saved-article, billing, schedule and credential cleanup. No backfill, table scans, new Gmail scope, table, index, queue or Lambda is added by this routing change.

![Destination deletion, disconnect and account erasure](diagrams/deletion-and-cleanup.svg)

[BPMN image](diagrams-bpmn/deletion-and-cleanup.png) · [Editable BPMN](diagrams-bpmn/deletion-and-cleanup.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Delete[Delete owned readlist definition]:::command --> Decorate[Existing deletion decorator<br/>find retiring address and reader's sender partition]:::system
  Decorate --> Affected{Sender selection includes retiring address?}
  Affected -->|yes| Remaining[Remove only deleted destination<br/>retain remaining customs or use All]:::new
  Remaining --> Senders[(Existing Gmail sender rows<br/>filter timestamp and monitoring evidence preserved)]:::store
  Remaining --> Cancel[Cancel affected unfinished imports<br/>destination-changed]:::new
  Cancel --> Jobs[(Existing Gmail history-import table)]:::store
  Cancel --> Rewrite[RewriteGmailFilterCommand<br/>readlist-deleted]:::command
  Rewrite --> Reconcile[Existing filter queue/Lambda<br/>Gmail gateway rule reconciliation]:::system
  Affected -->|none or no Gmail address| Retire[Retire hidden address then delete definition]:::system
  Cancel --> Retire
  Disconnect[POST /gmail/disconnect]:::command --> Requested[Mark disconnect requested; cancel all unfinished imports]:::system
  Requested --> DisconnectCommand[DisconnectGmailCommand]:::command
  DisconnectCommand --> DisconnectQ[(Existing rewrite/disconnect handler queue)]:::queue
  DisconnectQ --> Teardown[Delete sender mappings; remove rule before revoke<br/>disable gateway; remove credentials, connection and discovery]:::system
  Teardown --> Monitor[(Existing monitoring receipts retained<br/>reconnect does not resend claimed newsletter notices)]:::store
  Account[DeleteAccountCommand]:::command --> AccountQ[(Existing user-data-jobs queue<br/>alarmed DLQ)]:::queue
  AccountQ --> Scrub[Capture email object references before deleting rows<br/>delete raw/body/images and every email-links partition]:::system
  Scrub --> AllRows[(Existing reader-owned emails, previews and reserved list outcomes<br/>saved-link state, import jobs/messages, identities, monitoring)]:::store
  Scrub --> ImportRaw[(Delete gmail-import reader prefix from existing raw bucket)]:::store
  Scrub --> Teardown
  Teardown --> Addresses[Delete readlist-address claims; tombstone addresses]:::system
  Addresses --> Tail[Existing account scrub<br/>purge only last-saver shared content, saved rows, billing and schedules<br/>revoke tokens, destroy sessions, close identity; terminal log]:::system
  AccountQ -. exhausted .-> AccountDLQ[(Existing alarmed user-data-jobs DLQ)]:::dlq
  classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#111;
  classDef system fill:#fff2a8,stroke:#a08a00,color:#111;
  classDef event fill:#ffb976,stroke:#a85800,color:#111;
  classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#111;
  classDef store fill:#b8e8c5,stroke:#2f7a45,color:#111;
  classDef queue fill:#e8e8e8,stroke:#666,color:#111;
  classDef dlq fill:#f8c8c8,stroke:#a83434,color:#111;
  classDef ui fill:#fff,stroke:#555,color:#111;
  classDef new fill:#ffe599,stroke:#c78c00,stroke-width:3px,color:#111;
```

</details>

## Command → System → Event(s) reference

| Command or input event | System and durable result | Emitted events or next actions |
|---|---|---|
| GET picker state / Confirm readlists | Web Lambda validates URL state, preserves selections and sender-bound confirmation | HTML or HTMX fragment; explicit choice enables POST Save |
| POST create readlist | Web Lambda creates or reuses an owned readlist | 303 with appended selection; failures retain pending choice |
| POST save sender | Resolver allocates destinations, updates existing sender row and preserves eligibility | RewriteGmailFilterCommand; optional catalog suggestion; import only on explicit consent |
| RewriteGmailFilterCommand | Existing queued Gmail filter worker reconciles current truth against provider filters | Stored connection status, terminal log or queue retry/DLQ |
| SubmitNewsletterSenderCommand | Existing suggestion worker performs ETag-conditional catalog update | Pending S3 catalog entry; terminal log |
| SES receipt notification | Existing receive queue/Lambda parses and resolves addressed recipients; same-raw accepted retry reuses stored routing before mapping gates | Confirmation reaction, held unmapped sender, audit row, or EmailReceivedEvent |
| Gmail forwarding confirmation | Existing credential-free confirmation worker | Forwarding-confirmed/failed fact; existing filter reaction updates connection |
| EmailReceivedEvent | Existing extractor writes ordinal preview rows and counts; Gmail selection metadata must succeed before custom filtering publication | All SubmitLinkCommand before CrawlEmailLinkPreviewCommand; one EmailLinksTriagedEvent per custom list; ordinary event-before-metadata order preserved; existing notices |
| CrawlEmailLinkPreviewCommand | Existing preview worker writes metadata outcome without article queue access | Terminal preview row; failure router conditionally marks exhausted pending preview |
| SendSavesHeldNoticeCommand / SendFirstInboxEmailNoticeCommand | Existing notice workers re-check access and enforce existing claim gates | Resend email and existing terminal state; no new notice protocol |
| EmailLinksTriagedEvent | Existing filter queue/Lambda loads the list, evaluates purpose independently, validates ordinals; empty input bypasses the model | SubmitLinkCommand for each kept link; EmailLinksFilteredEvent, including terminal zero results |
| Filter triage exhaustion | Existing save-link shared failure router | EmailLinksFilterFailedEvent for one list |
| EmailLinksFilteredEvent / EmailLinksFilterFailedEvent | Existing inbox recorder consistently queries the primary partition, retries out-of-order facts while metadata is absent, then inserts first terminal reserved list row | Gmail per-list read model; ordinary/historical scalar settlement and counts |
| POST import start, retry or consent return | Existing web import actions snapshot destinations and mailbox, establish generation/window | StartGmailHistoryImportCommand |
| StartGmailHistoryImportCommand / ProcessGmailHistoryImportPageCommand | Existing import worker validates fences, leases page and calls read-only Gmail API | Fetched-message events; PageProcessed, Failed or Completed event |
| GmailHistoryImportPageProcessedEvent | Progress branch of same queued import worker | ProcessGmailHistoryImportPageCommand sent directly to own SQS queue |
| GmailHistoryImportMessageFetchedEvent | Existing inbox import-ingestion worker reuses a same-raw accepted snapshot before cancellation gates, otherwise validates current job and all destination ownership | EmailReceivedEvent plus GmailHistoryImportMessageIngestedEvent |
| GmailHistoryImportMessageIngestedEvent | Existing outcome worker transactionally counts one terminal outcome per generation | GmailHistoryImportCompletedEvent when listing and every message settle |
| Import page/outcome exhaustion | Existing shared Gmail history DLQ router | Failed job fact, or failed ingestion settlement and completion check |
| GmailHistoryImportCompletedEvent / GmailHistoryImportFailedEvent | Stored job state is read by registry polling; no new consumer | Reader sees current counts, retry, failure or cancellation |
| POST import cancel / mapping removal or change | Existing cancellation path marks unfinished sender jobs | Stored cancellation; future page claims stop |
| SubmitLinkCommand | Existing submit queue/Lambda validates identity, accepts into All, files custom membership, performs enrichment | LinkQueuedEvent; QueueEntryCreatedEvent on new email membership; tier extraction or existing refresh facts |
| LinkQueuedEvent / LinkQueueFailedEvent | Existing inbox saved-link recorder lets accepted save outrank failure | Saved-link read model; article Save/Save again UI |
| QueueEntryCreatedEvent | Existing related-articles worker and past-reads reaction inspect settled reader saves | Stored related results and computed fact; existing terminal log |
| TierContentExtractedEvent | Existing content selector compares available tiers and writes winning canonical source | CanonicalContentChangedEvent and existing crawl-completed/accepted content facts |
| SimpleCrawlUnsupportedEvent | Existing policy and comprehensive-crawl queue handle non-simple formats | Tier extraction or existing refresh/recrawl facts; failure terminalization |
| RefreshContentExtractedEvent | Existing refresh selector writes canonical content and article state | Existing summary dispatch and completion facts |
| CanonicalContentChangedEvent | Existing queued reaction re-primes summary | Existing GenerateSummaryCommand and summary worker |
| SummaryGenerated / summary failure / CrawlArticleFailedEvent | Existing summary and crawl completion/failure consumers | Stored terminal article state and logging; successful reader-ready fact where eligible |
| ReaderViewLoadingSucceeded | Existing reader-ready fanout and delayed gated notify worker | Existing per-reader success state, Resend notice and email-sent fact |
| Delete selected readlist | Existing deletion decorator removes one destination, preserves remaining lists/All, cancels affected imports | RewriteGmailFilterCommand; retired address and deleted definition |
| DisconnectGmailCommand | Existing queued teardown reconciles rule, revokes grant and disables gateway | Existing disconnected result/log; monitoring receipts remain |
| DeleteAccountCommand | Existing user-data-jobs queue/Lambda removes all reader partitions and referenced objects | Complete existing account scrub and terminal log; at-least-once retries/DLQ |

## Source evidence at capture time

The workspace is a pnpm/Nx TypeScript monorepo using the repository's Node 22 toolchain. EventBridge subscriptions grant queue policies through the existing infrastructure components; every asynchronous worker above retains its existing queue and alarmed DLQ. Datastore authorization grows only on existing tables: the extractor queries owned readlist definitions to snapshot display labels, and the existing custom-filter outcome recorder gains `PutItem` to insert reserved rows into the email-links table. The primary email-links partition Query uses `ConsistentRead: true`; this changes neither its existing authorization nor its key structure.

| Boundary | Evidence |
|---|---|
| Picker state and POST ownership gates | [Gmail page](../../projects/hutch/src/runtime/web/pages/integrations/gmail.page.ts), [URL state](../../projects/hutch/src/runtime/web/pages/integrations/gmail.url.ts), [mapping actions](../../projects/hutch/src/runtime/web/pages/integrations/gmail-mappings.page.ts) |
| Destination set comparison and list deletion | [Mapping resolver](../../projects/hutch/src/runtime/domain/gmail/resolve-readlist-mapping.ts), [deletion decorator](../../projects/hutch/src/runtime/domain/gmail/move-gmail-mappings-on-readlist-delete.ts) |
| Scalar-compatible persistence | [Sender store](../../src/packages/inbox-store/src/dynamodb-gmail-sender.ts), [history import store](../../src/packages/inbox-store/src/dynamodb-gmail-history-import.ts) |
| Accepted-message snapshot and identity | [Forwarded routing](../../projects/inbox/src/runtime/domain/gmail/route-gmail-forwarded-email.ts), [accepted retry](../../projects/inbox/src/runtime/domain/inbox/resume-accepted-gmail-email.ts), [identity resolution](../../projects/inbox/src/runtime/domain/inbox/resolve-email-identity.ts), [shared ingestion](../../projects/inbox/src/runtime/domain/inbox/ingest-parsed-email.ts) |
| Required routing contract | [Internal events](../../src/packages/hutch-infra-components/src/events.ts) |
| Mandatory All and custom fan-out | [Extractor](../../projects/inbox/src/runtime/domain/inbox/extract-email-links-handler.ts), [filter worker](../../projects/save-link/src/runtime/domain/filter-email-links/filter-email-links-handler.ts) |
| First-terminal list outcomes and historic scalar behavior | [Outcome recorder](../../projects/inbox/src/runtime/domain/inbox/record-email-links-filtered-handler.ts), [email-links store](../../src/packages/inbox-store/src/dynamodb-inbox-email-link.ts) |
| Import consent, fences and page continuation | [Web import actions](../../projects/hutch/src/runtime/web/pages/integrations/gmail-import-actions.ts), [worker](../../projects/hutch/src/runtime/domain/gmail/gmail-history-import.ts), [queue handler](../../projects/hutch/src/runtime/domain/gmail/gmail-history-import-handler.ts) |
| Import identity and settlement | [Ingestion worker](../../projects/inbox/src/runtime/domain/inbox/ingest-gmail-import-handler.ts), [outcome recorder](../../projects/hutch/src/runtime/domain/gmail/record-gmail-history-import-outcome-handler.ts) |
| Existing canonical/archive save | [Submit consumer](../../projects/save-link/src/runtime/domain/submit-link/submit-link-command-handler.ts), [shared accept phase](../../src/packages/save-article/src/save-article-from-url.ts) |
| Worker infrastructure and failure routing | [Hutch infrastructure](../../projects/hutch/src/infra/index.ts), [inbox infrastructure](../../projects/inbox/src/infra/index.ts), [save-link infrastructure](../../projects/save-link/src/infra/index.ts) |
| Erasure and receipt lifecycle | [Disconnect](../../projects/hutch/src/runtime/domain/gmail/disconnect-gmail.ts), [account scrub](../../projects/hutch/src/runtime/delete-account/delete-account-handler.ts) |

This snapshot describes the dirty working tree, including the monitoring infrastructure committed at the base. The routing change adds neither content backfill nor mail replay. A complete destination snapshot is a delivery decision; custom filtering, preview crawling and enrichment remain independently retried asynchronous work.
