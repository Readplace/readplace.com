# Gmail newsletters: save the issue, its links, or both

Snapshot of the uncommitted working tree over `e5a4079` (`rp/great-ride-0fy1uz`), whose 2026-10-06 subject is **feat: let readers choose what a Gmail newsletter saves**. Generated 2026-10-06. The base commit already stores the delivery mode on a sender and offers it in the mapping picker; the snapshot plumbing, the issue save pipeline, the extractor branch and the reader panel are uncommitted at capture time.

Each Gmail sender mapping now records a delivery mode: `issue` saves the email itself as one article, `links` saves the articles it links to (the behaviour every mapping had before), and `both` does the two. A new mapping starts on `issue`; a mapping written before the field existed keeps delivering links until the reader edits it. The mode is snapshotted onto each accepted email exactly like its destinations, so a later edit never reroutes mail that already arrived. Custom inbox addresses keep saving links. The [multiple-readlists snapshot](../2026-10-04-508b6d700/gmail-multiple-readlists.md) remains the record of destination selection, filtering and imports.

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

## Choosing what a sender saves

The picker offers the three modes as radios beside the readlist choice. A sender with no mapping preselects the issue itself, an existing mapping preselects its stored mode, and a mapping stored before modes existed preselects links. The mode rides the picker's URL state, so search, polling, login return and validation redirects keep it. Saving writes the mode with the destinations. A mode change is treated like a destination change: it cancels unfinished imports for that sender before the filter is reconciled. Deleting a selected readlist moves the remaining destinations and keeps the mode.

![Choosing what a sender saves](diagrams/delivery-choice.svg)

[BPMN image](diagrams-bpmn/delivery-choice.png) · [Editable BPMN](diagrams-bpmn/delivery-choice.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Entry[Reader opens the Gmail newsletter picker<br/>for a new sender or with Edit on a mapping row]:::ui --> Picker[Picker state carries delivery<br/>issue, links or both]:::new
  Picker --> Mapped{Sender already mapped?}
  Mapped -->|no| Issue[Preselect the issue itself]:::new
  Mapped -->|yes, with a chosen mode| Current[Preselect the sender's delivery mode]:::new
  Mapped -->|yes, mapped before modes existed| Legacy[Preselect links<br/>what that mapping has been delivering]:::new
  Issue --> Save[POST /gmail/senders/add<br/>destinations plus delivery mode]:::command
  Current --> Save
  Legacy --> Save
  Save --> Resolve[Resolve destinations<br/>compare saved destinations and mode]:::new
  Resolve --> Senders[(Existing Gmail sender table<br/>deliveryMode beside mappedAddresses)]:::new
  Resolve --> Changed{Destinations or mode changed?}
  Changed -->|yes| Cancel[Cancel unfinished sender imports<br/>destination-changed]:::new
  Changed -->|no or first mapping| Filter[RewriteGmailFilterCommand]:::command
  Cancel --> Filter
  Filter --> FilterQ[(Existing rewrite-gmail-filter queue)]:::queue
  Resolve --> Row[Mapping row names what the sender saves<br/>Edit reopens the picker on it]:::new
  Delete[Delete a selected readlist]:::command --> Move[Existing deletion decorator<br/>keeps the sender's delivery mode]:::new
  Move --> Senders
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

## The mode travels with each accepted message

The forwarded-mail router returns the sender's destinations and delivery mode together. Mail it delivers as addressed, from an unreadable sender or a sender with no mapping row, is delivered as links. The accepted email row stores the mode beside its destination snapshot, and a retry of the same raw object republishes that stored routing. An email accepted before the field existed replays as links. The history-import page worker reads the sender's current mode onto every fetched message, and the import ingestion builds its routing from the event. `EmailReceivedEvent` and `GmailHistoryImportMessageFetchedEvent` both carry the mode as a required field, so a message published before the deploy fails parsing and drains through the existing DLQs.

![The mode travels with each accepted message](diagrams/message-ingress.svg)

[BPMN image](diagrams-bpmn/message-ingress.png) · [Editable BPMN](diagrams-bpmn/message-ingress.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Mail((Gmail forwarded mail)):::event --> ReceiveQ[(Existing inbox-receive-email queue)]:::queue
  ReceiveQ --> Receive[Receive Lambda<br/>resolve recipients and parse]:::system
  Receive --> Accepted{Same raw object already accepted?}
  Accepted -->|yes| Resume[Republish the accepted row's routing<br/>destinations and delivery mode]:::new
  Accepted -->|no| Route[Resolve sender destinations and delivery mode]:::new
  Route --> Senders[(Existing Gmail sender table)]:::store
  Route -->|unmapped gateway sender| Held[(Existing held-mail table)]:::store
  Route -->|unreadable sender or unknown alias sender| Addressed[Delivered as addressed<br/>delivery mode links]:::new
  Route -->|mapped sender| Snapshot[Routing kind gmail<br/>destinationAddresses and deliveryMode]:::new
  Addressed --> Snapshot
  Snapshot --> Ingest[Existing identity claim and ingestion<br/>email row stores gmailDeliveryMode]:::new
  Ingest --> Emails[(Existing inbox email table and content S3)]:::store
  Ingest --> Received((EmailReceivedEvent<br/>gmail routing carries deliveryMode)):::new
  Resume --> Received
  Worker[Existing Gmail history import page worker<br/>reads the sender's current mode]:::new --> Fetched((GmailHistoryImportMessageFetchedEvent<br/>carries deliveryMode)):::new
  Fetched --> ImportQ[(Existing inbox-ingest-gmail-import queue)]:::queue
  ImportQ --> ImportIngest[Existing import ingestion<br/>routing takes the event's mode]:::new
  ImportIngest --> Ingest
  Received --> ExtractQ[(Existing inbox-extract-email-links queue)]:::queue
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

## The extractor branches on the mode

Extraction, triage and preview crawls run in every mode, so the issue's links can be listed and saved by hand later. In `issue` mode no link is submitted, no custom readlist is asked to choose, and the metadata records no readlist selection, so the inbox page shows plain link cards. A full-access reader's issue is published as one `SaveEmailIssueCommand` before the first preview, carrying every mapped custom readlist. The first-inbox email, whose copy says the email's links were saved, is sent only by the link fan-out. A read-only reader gets the existing saves-held notice once, and backfill or unrouted mail saves nothing. `both` publishes the issue command and the existing link fan-out. A crash after the command can republish it; the save converges on the same article row.

![The extractor branches on the mode](diagrams/extract-fan-out.svg)

[BPMN image](diagrams-bpmn/extract-fan-out.png) · [Editable BPMN](diagrams-bpmn/extract-fan-out.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Received((EmailReceivedEvent)):::event --> Q[(Existing extraction queue)]:::queue
  Q --> Extract[Extract Lambda<br/>re-derive links from raw mail and triage them]:::system
  Extract --> Mode{Routing and delivery mode}
  Mode -->|inbox address or links| Links[Existing link fan-out]:::system
  Mode -->|issue| IssueOnly[Issue only<br/>no link saves and no custom filtering]:::new
  Mode -->|both| Both[Issue and link fan-out]:::new
  Both --> Links
  IssueOnly --> Access{Submitting origin and write access?}
  Both --> Access
  Access -->|backfill or unrouted audit| Quiet[Previews only]:::policy
  Access -->|read only| HeldNotice[Existing saves-held notice<br/>once per email]:::command
  Access -->|full| SaveIssue[SaveEmailIssueCommand<br/>published before the first preview]:::new
  SaveIssue --> IssueQ[(save-email-issue-command queue)]:::new
  Links --> First[Existing first-inbox-email notice<br/>link fan-out only]:::command
  Links --> Submit[SubmitLinkCommand to All]:::command
  Links --> Triaged((EmailLinksTriagedEvent<br/>one per custom readlist)):::event
  Extract --> Preview[CrawlEmailLinkPreview<br/>every pending link in every mode]:::command
  Preview --> PreviewQ[(Existing preview queue)]:::queue
  PreviewQ --> Crawl[Existing preview Lambda]:::system
  Crawl --> Rows[(Existing email-links rows<br/>read later by the reader's issue panel)]:::store
  Extract --> Meta[Counts and metadata<br/>no readlist selection snapshot in issue mode]:::new
  Meta --> MetaStore[(Existing email-links metadata)]:::store
  Q -. retry exhaustion .-> DLQ[(Existing inbox failure DLQ)]:::dlq
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

## Saving the issue as an article

A new save-link Lambda consumes the command from its own queue and DLQ. It reads the sanitized body the receive path already stored under the email's content key, derives the title from the subject, the newsletter name from the sender, an excerpt and a read time, and saves the article under that same key. Nothing fetches a URL: the `email://` key is refused by every public save surface, and the display URL points the card, the reader and the API at the email's inbox page. The issue is filed into each mapped custom readlist. When its content is not ready yet the body becomes its tier-0 source, written without an author so the reader offers no remove-my-version control, and the existing selector promotes it and the existing summary runs. A new membership publishes `QueueEntryCreatedEvent` for related reads. The save publishes no `LinkQueuedEvent`, whose consumer only accepts saveable web URLs.

![Saving the issue as an article](diagrams/save-email-issue.svg)

[BPMN image](diagrams-bpmn/save-email-issue.png) · [Editable BPMN](diagrams-bpmn/save-email-issue.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Command[SaveEmailIssueCommand<br/>reader, message, subject, sender, issue URL, readlists]:::new --> Q[(save-email-issue-command queue<br/>three receives, own DLQ and alarm)]:::new
  Q --> Lambda[Save-email-issue Lambda<br/>read the stored email body]:::new
  Body[(Existing content S3<br/>sanitized email body under the issue key)]:::store --> Lambda
  Lambda -->|body not readable yet| Retry[Fail the record for an SQS retry]:::policy
  Retry --> Q
  Lambda --> Meta[Derive title, newsletter name,<br/>excerpt and read time]:::new
  Meta --> Save[Save under the email's own key<br/>email://inbox/reader/message]:::new
  Save --> Articles[(Existing article and per-user All rows<br/>email provenance)]:::store
  Save --> Display[Display URL is the email's inbox page]:::new
  Display --> ArticleRow[(Existing article row displayUrl)]:::store
  Save --> File[Existing filing into each mapped custom readlist]:::system
  File --> Lists[(Existing readlist memberships)]:::store
  Save -->|new reader membership| Entry((QueueEntryCreatedEvent)):::event
  Entry --> RelatedQ[(Existing related-articles queue)]:::queue
  Save --> Ready{Content already ready?}
  Ready -->|yes, a repeat delivery| Done[Membership only]:::policy
  Ready -->|no| Pending[Mark crawl and summary pending]:::system
  Pending --> Source[Write the body as the tier-0 source<br/>no author, so no remove-my-version control]:::new
  Source --> Tier0[(Existing tier-source S3 objects)]:::store
  Source --> Tier((TierContentExtractedEvent)):::event
  Tier --> SelectQ[(Existing content-selector queue)]:::queue
  SelectQ --> Select[Existing selector<br/>only available tier becomes canonical]:::system
  Select --> Changed((CanonicalContentChangedEvent)):::event
  Changed --> Summary[Existing summary generation]:::system
  Lambda --> Onboarding[Stamp the inbox onboarding signal<br/>best effort]:::system
  Q -. retry exhaustion .-> DLQ[(save-email-issue-command DLQ)]:::new
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

## Reading the issue and saving its links

The owner reader always renders the panel, hidden for an ordinary article. For an issue it lists the article links the extractor stored, with the saved state from the inbox saved-link read model, and withholds the share prompt and the EPUB download, both of which build a public `/view` link. The web Lambda gains read access to the two inbox tables. A Save posts the link's ordinal to a new route, which checks the issue is the reader's, the link exists and its URL is saveable, then runs the existing inline save with the newsletter as provenance and redirects back with a marker that shows the row as saved before the read model catches up. A non-owner opening an issue's reader link gets not found instead of the public view.

![Reading the issue and saving its links](diagrams/reader-issue-links.svg)

[BPMN image](diagrams-bpmn/reader-issue-links.png) · [Editable BPMN](diagrams-bpmn/reader-issue-links.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
  Open[Reader opens a saved issue<br/>GET /queue/:id/view]:::ui --> Reader[Web Lambda owner reader]:::system
  Reader --> IsIssue{Article key is an email issue?}
  IsIssue -->|no| Hidden[Panel rendered hidden<br/>share prompt and EPUB as before]:::policy
  IsIssue -->|yes| Panel[Links in this issue panel<br/>share prompt and EPUB withheld]:::new
  Panel --> LinkRows[(Existing email-links rows and metadata<br/>new read grant for the web Lambda)]:::new
  Panel --> SaveStates[(Existing inbox saved-link read model<br/>new read grant for the web Lambda)]:::new
  Click[Reader presses Save on a link]:::ui --> Post[POST /queue/:id/issue-links<br/>ordinal and returnTo]:::new
  Post --> Check{Owned issue, known link, saveable URL?}
  Check -->|no| NotFound[404]:::policy
  Check -->|yes| Inline[Existing inline save to the top of All<br/>provenance is the newsletter]:::system
  Inline --> Articles[(Existing article and All membership rows)]:::store
  Inline --> Queued((LinkQueuedEvent)):::event
  Queued --> RecorderQ[(Existing inbox saved-link recorder queue)]:::queue
  RecorderQ --> Recorder[Existing saved-link recorder]:::system
  Recorder --> SaveStates
  Inline --> Saved((LinkSavedEvent)):::event
  Saved --> Crawl[Existing crawl and enrichment]:::system
  Inline --> Back[303 to the reader<br/>issue_link_saved marks the row saved at once]:::new
  Back --> Panel
  Stranger[Someone else opens the issue's reader link]:::ui --> Permalink[Not found instead of the public view]:::new
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
| POST save sender with a delivery mode | Web Lambda resolves destinations and stores the mode on the sender row; a changed mode cancels unfinished sender imports | RewriteGmailFilterCommand |
| Gmail forwarded mail (SES receipt) | Existing receive Lambda resolves destinations and mode, or replays an accepted row's routing; the email row stores `gmailDeliveryMode` | EmailReceivedEvent with the mode on its gmail routing |
| GmailHistoryImportMessageFetchedEvent | Existing import ingestion builds gmail routing from the event's mode | EmailReceivedEvent; GmailHistoryImportMessageIngestedEvent |
| EmailReceivedEvent | Existing extractor writes link rows, previews and metadata; the mode decides the save fan-out | SaveEmailIssueCommand for `issue` and `both`; SubmitLinkCommand and EmailLinksTriagedEvent for `links` and `both`; CrawlEmailLinkPreview in every mode; existing notices |
| SaveEmailIssueCommand | New save-email-issue Lambda saves the issue under its email key into All and its custom readlists, sets its display URL and stages its body as tier-0 | TierContentExtractedEvent when content is pending; QueueEntryCreatedEvent on a new membership |
| TierContentExtractedEvent | Existing selector promotes the only available tier | CanonicalContentChangedEvent and the existing summary chain |
| QueueEntryCreatedEvent | Existing related-articles worker | Stored related results and computed fact |
| POST /queue/:id/issue-links | Web Lambda validates the issue and link, then saves the link inline into All | LinkSavedEvent, LinkQueuedEvent, QueueEntryCreatedEvent on a new membership; 303 back to the reader |
| LinkQueuedEvent | Existing inbox saved-link recorder | Saved-link read model the issue panel reads |

## Source evidence at capture time

The new Lambda reads and writes only existing tables and buckets: the articles and user-articles tables, the onboarding table, and the content bucket. The extractor Lambda gains the app origin in its environment to build the issue's inbox URL. The hutch web Lambda gains read access to the inbox email-links and saved-links tables. No table, index or event bus changes.

| Boundary | Evidence |
|---|---|
| Delivery mode and its defaults | [Delivery mode](../../src/packages/domain/src/gmail/gmail-delivery-mode.ts), [sender store](../../src/packages/inbox-store/src/dynamodb-gmail-sender.ts), [mapping resolver](../../projects/hutch/src/runtime/domain/gmail/resolve-readlist-mapping.ts) |
| Mapping picker and rows | [Gmail page](../../projects/hutch/src/runtime/web/pages/integrations/gmail.page.ts), [URL state](../../projects/hutch/src/runtime/web/pages/integrations/gmail.url.ts), [picker view model](../../projects/hutch/src/runtime/web/pages/integrations/gmail.viewmodel.ts) |
| Routing contract | [Internal events](../../src/packages/hutch-infra-components/src/events.ts) |
| Accepted-message snapshot | [Forwarded routing](../../projects/inbox/src/runtime/domain/gmail/route-gmail-forwarded-email.ts), [receive handler](../../projects/inbox/src/runtime/domain/inbox/receive-email-handler.ts), [shared ingestion](../../projects/inbox/src/runtime/domain/inbox/ingest-parsed-email.ts), [accepted routing](../../projects/inbox/src/runtime/domain/inbox/accepted-gmail-routing.ts), [email row](../../src/packages/inbox-store/src/dynamodb-inbox-email.ts) |
| Imports | [Import worker](../../projects/hutch/src/runtime/domain/gmail/gmail-history-import.ts), [import ingestion](../../projects/inbox/src/runtime/domain/inbox/ingest-gmail-import-handler.ts) |
| Extractor branch | [Extractor](../../projects/inbox/src/runtime/domain/inbox/extract-email-links-handler.ts), [fan-out](../../projects/inbox/src/runtime/domain/inbox/email-fan-out.ts) |
| Issue save | [Command handler](../../projects/save-link/src/runtime/domain/save-email-issue/save-email-issue-command-handler.ts), [save](../../projects/save-link/src/runtime/domain/save-email-issue/save-email-issue.ts), [issue key](../../src/packages/domain/src/inbox/email-issue-url.ts), [issue metadata](../../src/packages/domain/src/inbox/email-issue-metadata.ts) |
| Reader panel | [Readlist routes](../../projects/hutch/src/runtime/web/pages/readlist/readlist.page.ts), [panel](../../projects/hutch/src/runtime/web/shared/issue-links/issue-links.component.ts), [permalink](../../projects/hutch/src/runtime/web/pages/readlist/reader-permalink.ts) |
| Infrastructure | [Save-link infrastructure](../../projects/save-link/src/infra/index.ts), [inbox infrastructure](../../projects/inbox/src/infra/index.ts), [hutch infrastructure](../../projects/hutch/src/infra/index.ts) |
