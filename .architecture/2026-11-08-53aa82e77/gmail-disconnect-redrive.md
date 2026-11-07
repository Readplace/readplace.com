# A Gmail disconnect or filter rewrite is safe to redrive from rewrite-gmail-filter-dlq

Snapshot of the uncommitted working tree over `53aa82e77` (`main`), whose 2026-11-08 subject is **fix(hutch,@packages/infra-components): send a redriven data export only to a live account, once**. Generated 2026-11-08. The disconnect fence, the rewrite gate, the conditional connection writes and the new skipped event are uncommitted and not deployed.

`POST /gmail/disconnect` marks the reader's connection row with `disconnectRequestedAt` and then publishes `DisconnectGmailCommand`, whose detail is only `userId`. The web app and the forwarding-confirmed handler publish `RewriteGmailFilterCommand`, and Google's forwarding confirmation publishes `GmailForwardingConfirmed` or `GmailForwardingConfirmFailed`. All four route by detail type into the one `rewrite-gmail-filter-q` queue (batch size 1, three receives, then `rewrite-gmail-filter-dlq`), and the rewrite-gmail-filter Lambda dispatches each to its handler. A redrive moves all four kinds together and in no order.

- **New: the disconnect fence.** Before the teardown runs, the disconnect handler reads the connection row once. A missing row means a teardown already finished or the reader never connected: the fence deletes the mailbox's monitor rows and discovery row and answers `not-connected`, without calling the teardown. A row with no `disconnectRequestedAt` is a connection nobody asked to tear down (the reader reconnected after an old request, or the grant was revoked without a disconnect): the fence answers `not-requested` and makes no write and no Google call. Only a marked row reaches the teardown.
- **Changed: the teardown's outcome.** A marked row is torn down as before: history imports cancelled, senders and monitor rows deleted, the Gmail filter removed, the grant revoked at Google, credentials deleted, the gateway address disabled, the connection and discovery rows deleted, then `GmailDisconnected`. Google being unavailable still fails the record for a retry with no fact.
- **New: `GmailDisconnectSkipped`.** The two refusals publish `GmailDisconnectSkipped` with `reason` `not-connected` or `not-requested`, and log `[disconnect-gmail] nothing to disconnect` with the reason. Before this change the absent arm published nothing.
- **New: the rewrite gate.** A `RewriteGmailFilterCommand` for a row that carries `disconnectRequestedAt` answers `not-connected` without calling Gmail, so a redriven rewrite does not recreate a filter the teardown owns; it publishes `GmailFilterRewriteFailed{not-connected}`, which is not metered. Otherwise the existing reconciliation runs. The teardown's own filter removal is not gated, because it must run on a marked row.
- **Changed: connection writes never recreate a deleted row.** The connection store's forwarding-confirmed, confirm-error, account-email, filter, clear-filter, filter-error, revoked and clear-revoked writes now carry `attribute_exists(userId)`. A write that lands after a teardown deleted the row writes nothing instead of creating a row without its gateway address. Clearing the revoked mark still answers with the reconnect time it computed.
- **Account deletion is unchanged.** It calls the teardown directly, unfenced, on a row that is not marked.

No Pulumi change: the Lambda already had `PutEvents` on the bus and `UpdateItem` on the connections table. `GmailDisconnectSkipped` has no subscriber.

---

## Legend

Thick green marks what the uncommitted change adds or changes. Everything else is existing infrastructure shown for context.

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
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    C["Command"]:::command
    S["System / aggregate"]:::system
    E(("Event")):::event
    P{"Policy / decision"}:::policy
    R[("Read model / store")]:::store
    Q[["Queue"]]:::queue
    D[["DLQ"]]:::dlq
    N{"Added by this change"}:::new
```

</details>

---

## Disconnect on the shared queue

![Disconnect on the shared queue](diagrams/disconnect-flow.svg)

[BPMN image](diagrams-bpmn/disconnect-flow.png) · [Editable BPMN](diagrams-bpmn/disconnect-flow.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    Route["POST /gmail/disconnect"]:::system
    Mark[("connection row: SET disconnectRequestedAt")]:::store
    Cmd["DisconnectGmailCommand {userId}"]:::command
    Q[["rewrite-gmail-filter-q"]]:::queue
    DLQ[["rewrite-gmail-filter-dlq"]]:::dlq
    Handler["rewrite-gmail-filter Lambda: disconnect handler"]:::system
    Read[("connection row: consistent GetItem")]:::store
    Fence{"Disconnect fence: row?"}:::new
    Clean[("delete monitor rows and discovery row")]:::store
    Teardown["Teardown: cancel imports, delete senders and monitor rows, remove filter, revoke grant, delete credentials, disable gateway, delete connection and discovery"]:::system
    Google{"Google answered?"}:::policy
    Disconnected(("GmailDisconnected")):::event
    SkipNC(("GmailDisconnectSkipped not-connected")):::new
    SkipNR(("GmailDisconnectSkipped not-requested")):::new
    Retry["fail the record"]:::policy
    AccountDelete["DeleteAccountCommand: delete-account handler"]:::system

    Route --> Mark --> Cmd --> Q --> Handler --> Read --> Fence
    Fence -- absent --> Clean --> SkipNC
    Fence -- "present, unmarked" --> SkipNR
    Fence -- marked --> Teardown --> Google
    Google -- yes --> Disconnected
    Google -- unavailable --> Retry --> Q
    Q -- "after 3 receives" --> DLQ
    DLQ -. "start-message-move-task" .-> Q
    AccountDelete -- "unfenced" --> Teardown
```

</details>

---

## Filter rewrite and forwarding confirmation on the shared queue

![Filter rewrite and forwarding confirmation on the shared queue](diagrams/rewrite-flow.svg)

[BPMN image](diagrams-bpmn/rewrite-flow.png) · [Editable BPMN](diagrams-bpmn/rewrite-flow.bpmn)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
    classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#000
    classDef system  fill:#fff2a8,stroke:#a08a00,color:#000
    classDef event   fill:#ffb976,stroke:#a85800,color:#000
    classDef policy  fill:#d6b8ff,stroke:#6b3fb0,color:#000
    classDef store   fill:#b8e8c5,stroke:#2f7a45,color:#000
    classDef queue   fill:#e8e8e8,stroke:#666,color:#000
    classDef dlq     fill:#f8c8c8,stroke:#a83434,color:#000
    classDef new     fill:#d4f5dc,stroke:#0a8a2a,stroke-width:4px,color:#000

    Rewrite["RewriteGmailFilterCommand {userId}"]:::command
    Confirmed(("GmailForwardingConfirmed")):::event
    ConfirmFailed(("GmailForwardingConfirmFailed")):::event
    Q[["rewrite-gmail-filter-q"]]:::queue
    DLQ[["rewrite-gmail-filter-dlq"]]:::dlq
    RewriteHandler["rewrite-gmail-filter Lambda: rewrite handler"]:::system
    Gate{"Rewrite gate: row marked disconnecting?"}:::new
    Reconcile["Reconcile the gateway filter with Gmail"]:::system
    Rewritten(("GmailFilterRewritten")):::event
    RewriteFailed(("GmailFilterRewriteFailed")):::event
    ConfirmedHandler["forwarding-confirmed handler: gateway fence"]:::system
    ConfirmFailedHandler["forwarding-confirm-failed handler: gateway fence"]:::system
    Conn[("connection row: UpdateItem IF attribute_exists(userId)")]:::new
    Callback["OAuth callback: account email, clear revoked"]:::system

    Rewrite --> Q
    Confirmed --> Q
    ConfirmFailed --> Q
    Q --> RewriteHandler --> Gate
    Gate -- "yes: not-connected" --> RewriteFailed
    Gate -- no --> Reconcile
    Reconcile -- ok --> Rewritten
    Reconcile -- failed --> RewriteFailed
    Reconcile -- "record filter" --> Conn
    Q --> ConfirmedHandler -- "mark confirmed" --> Conn
    ConfirmedHandler --> Rewrite
    Q --> ConfirmFailedHandler -- "record confirm error" --> Conn
    Callback --> Conn
    Q -- "after 3 receives" --> DLQ
    DLQ -. "start-message-move-task" .-> Q
```

</details>

---

## Command → System → Event(s) reference

| Command / event | System | Emits | Triggers next |
|---|---|---|---|
| `DisconnectGmailCommand` (`userId`) | rewrite-gmail-filter Lambda, disconnect handler behind the **disconnect fence**, via `rewrite-gmail-filter-q` | `GmailDisconnected` for a marked row, or **`GmailDisconnectSkipped`** | Nothing: neither event has a subscriber |
| `RewriteGmailFilterCommand` (`userId`) | rewrite-gmail-filter Lambda, rewrite handler behind the **rewrite gate**, via `rewrite-gmail-filter-q` | `GmailFilterRewritten` or `GmailFilterRewriteFailed` (a marked row gives `not-connected`) | Nothing |
| `GmailForwardingConfirmed` | forwarding-confirmed handler, gateway fence; marks the row confirmed with a conditional write | `RewriteGmailFilterCommand` | The rewrite handler |
| `GmailForwardingConfirmFailed` | forwarding-confirm-failed handler, gateway fence; records the error with a conditional write | — | — |
| `GmailDisconnected` (`userId`, `filterRemoved`, `grantRevoked`) | Published after a marked row's teardown | — | — |
| **`GmailDisconnectSkipped`** (`userId`, `reason`: `not-connected`, `not-requested`) | Published when the fence refuses | — | — |
| `DeleteAccountCommand` (`userId`) | user-data-jobs Lambda; calls the teardown directly, unfenced | Unchanged | Unchanged |
