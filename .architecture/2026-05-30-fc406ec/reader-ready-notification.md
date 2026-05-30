# Reader-ready notification flow

> **Commit:** `fc406ec` · **Date:** 2026-05-30 · **Branch:** `claude/dazzling-cray-tkyDl`
> **Subject:** feat(hutch,save-link): email savers when their reader view is ready

When a saved article's clean reader view (crawled content + AI summary) reaches a
successful terminal state, the system emails the saver a link — but only if they
opened the reader while it was still loading and left before it finished, the
generation took longer than a minute, and they have not already been emailed in
the last 6 hours. Presence is detected entirely server-side from the existing
htmx poll; there is **no new client-side JavaScript**.

## Legend

| Role | Fill | Stroke |
|---|---|---|
| Command | `#a6d8ff` | `#1e6fb8` |
| System / aggregate | `#fff2a8` | `#a08a00` |
| Event | `#ffb976` | `#a85800` |
| Policy / gate | `#d6b8ff` | `#6b3fb0` |
| Read model / store | `#b8e8c5` | `#2f7a45` |
| Queue | `#e8e8e8` | `#666` |
| DLQ | `#f8c8c8` | `#a83434` |

**Nodes introduced by this change are outlined in thick amber (`:::new`).**

## End-to-end flow

```mermaid
flowchart TD
	classDef command fill:#a6d8ff,stroke:#1e6fb8,color:#06243b;
	classDef system fill:#fff2a8,stroke:#a08a00,color:#3a3000;
	classDef event fill:#ffb976,stroke:#a85800,color:#3a1e00;
	classDef policy fill:#d6b8ff,stroke:#6b3fb0,color:#2a1147;
	classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f3a1f;
	classDef queue fill:#e8e8e8,stroke:#666,color:#222;
	classDef dlq fill:#f8c8c8,stroke:#a83434,color:#3a0d0d;
	classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#2a1a00;

	GSC[GenerateSummaryCommand]:::command --> GS[generate-summary worker<br/>markSummaryReady / markSummarySkipped]:::system
	GS -->|publish-summary-generated| SGE[SummaryGeneratedEvent]:::event
	GS -->|publish-reader-view-loading-succeeded<br/>succeededAt = persist moment| RVLS[ReaderViewLoadingSucceeded<br/>url, succeededAt, hasSummary]:::new

	RVLS -->|EventBridge → SQS| FQ[reader-ready-fanout queue]:::new
	FQ --> FAN[reader-ready-fanout Lambda]:::new
	FAN -->|url-index GSI Query| UA[(user-articles rows<br/>succeededAt / viewedAt / emailSentAt)]:::new
	FAN -->|set-once succeededAt per saver| UA
	FAN -->|hasSummary AND viewedAt set<br/>DelaySeconds = 300| NQ[reader-ready-notify queue]:::new
	FAN -.->|never-viewed: stamp only, no command<br/>import-storm guard| UA

	NQ --> NRVR[NotifyReaderViewReadyCommand<br/>userId, url, succeededAt]:::new
	NRVR --> NOTIFY[reader-ready-notify Lambda]:::new
	NOTIFY --> GATE{{per-user gates<br/>row exists · not read · not re-saved ·<br/>not already emailed · gen &gt; 60s ·<br/>viewedAt &lt; succeededAt · email verified}}:::policy
	GATE -.->|any miss → skip + log| DROP[/dropped + logged/]:::policy
	GATE -->|all pass| CLAIM{{claimReaderReadyEmailSlot<br/>atomic 6h cooldown on users row}}:::policy
	CLAIM -->|attribute_not_exists OR < now-6h| USERS[(users row<br/>lastReaderReadyEmailAt)]:::new
	CLAIM -.->|rejected: within cooldown| DROP
	CLAIM -->|claimed| SEND[send Resend email<br/>APP_ORIGIN/queue/&lt;id&gt;/view]:::system
	SEND -->|set-once emailSentAt| UA
	SEND --> RRES[ReaderReadyEmailSentEvent<br/>userId, url, sentAt]:::new

	FQ -.-> FDLQ[fanout DLQ → alarm]:::dlq
	NQ -.-> NDLQ[notify DLQ → alarm]:::dlq
```

## Presence (server-side only)

```mermaid
flowchart LR
	classDef system fill:#fff2a8,stroke:#a08a00,color:#3a3000;
	classDef store fill:#b8e8c5,stroke:#2f7a45,color:#0f3a1f;
	classDef new fill:#ffd24c,stroke:#a0660b,stroke-width:3px,color:#2a1a00;

	VIEW[GET /queue/:id/view<br/>owner branch]:::system -->|markArticleViewed| UA[(user-articles row<br/>viewedAt)]:::new
	SUMMARY[GET /queue/:id/summary<br/>in-reader poll]:::system -->|markArticleViewed| UA
	READER[GET /queue/:id/reader<br/>in-reader poll]:::system -->|markArticleViewed| UA
	CARD[GET /queue/:id/card<br/>queue-list glance]:::system -.->|NOT stamped| UA
```

A present user's final in-reader poll lands at-or-after `succeededAt`, so
`viewedAt ≥ succeededAt` ⇒ suppressed. A user who opened it, watched it load, then
left has `viewedAt < succeededAt` ⇒ emailed. A user who never opened it has no
`viewedAt` ⇒ never emailed. The ~5-minute notify delay gives the terminal poll
time to land; `succeededAt` is captured in the domain at the persist moment, so
it is always ≤ any later poll's `viewedAt`.

## Command → System → Event(s) reference

| Command / Event | Handler (system) | Emits | Triggers next |
|---|---|---|---|
| GenerateSummaryCommand *(existing)* | generate-summary worker | SummaryGeneratedEvent *(existing)*, **ReaderViewLoadingSucceeded** | reader-ready-fanout |
| **ReaderViewLoadingSucceeded** (per-URL, global) | **reader-ready-fanout** Lambda (EventBridge → SQS) | — (stamps per-user `succeededAt`; dispatches a command) | **NotifyReaderViewReadyCommand** (only for viewers, when `hasSummary`) |
| **NotifyReaderViewReadyCommand** (per-user, direct SQS, `DelaySeconds=300`) | **reader-ready-notify** Lambda | **ReaderReadyEmailSentEvent** (on send) | — (no load-bearing consumer; wired for future analytics/digest) |
| **ReaderReadyEmailSentEvent** | *(none yet)* | — | — |

### Gates on `NotifyReaderViewReadyCommand` (skip + log on any miss)

1. user-article row still exists (not deleted)
2. `status !== "read"`
3. `savedAt <= succeededAt` (not re-saved after success)
4. `emailSentAt` not set (not already emailed)
5. `succeededAt − savedAt > 60s` (generation took over a minute)
6. `viewedAt` is set AND `viewedAt < succeededAt` (viewed while loading, left before ready)
7. user email exists AND `emailVerified`
8. atomic claim of the 6h per-user cooldown on the users row

Only after all gates pass and the cooldown is claimed does the Lambda send the
email, set `emailSentAt` (set-once), and publish `ReaderReadyEmailSentEvent`.

> SVG render skipped — sandboxed Chromium unavailable in this environment.
> Mermaid sources are embedded above and render in GitHub's Markdown viewer.
