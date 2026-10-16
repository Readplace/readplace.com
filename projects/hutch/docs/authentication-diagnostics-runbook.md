# Authentication diagnostics runbook

Use `/readplace/auth-diagnostics` and the `readplace-authentication` CloudWatch dashboard to investigate repeated sign-ins across the website, Chrome, Firefox, iOS and Android. Diagnostics start with the upgraded release; they cannot establish which interruption caused the October 15 incident retrospectively.

## Build one timeline

Resolve the reported account through the existing account lookup. Compute `subject_ref` with `initAuthDiagnosticPermits.reference({ kind: "subject", value: userId })` using that environment's `ANALYTICS_SALT`. Keep the account identifier and salt out of logs. Query the resulting reference across all clients, including server session events:

```sql
fields occurred_at, recorded_at, source, client, surface, client_version,
       event, reason, outcome, grant_id, session_ref, operation_id,
       attempt_id, context_id, request_id, generation, http_status
| filter stream = "auth-diagnostics" and subject_ref = "SUBJECT_REFERENCE"
| sort occurred_at asc
| dedup event_id
```

Client `occurred_at` uses the device clock; `recorded_at` is the server's receipt time. Delayed uploads can arrive after later events. Compare server timestamps and operation ordering before assigning causality. Forwarder retries may duplicate events; deduplicate `event_id` when constructing the timeline.

The account query is a starting point. Anonymous login and absent-cookie events have no `subject_ref`; missing-session and lookup-error events may also lack it. Expand the query using the resulting `context_id`, `session_ref` and `request_id` values to include those events. An event with no surviving link cannot be attributed to the reported account from these diagnostics alone.

Add server deploy timestamps, public iOS release dates, TestFlight build dates and extension version availability as separate timeline entries. A commit is not evidence that a client had installed the release. `client_version` shows the reporting build; a missing version means it was not supplied.

| Identifier | Meaning |
| --- | --- |
| `subject_ref` | Server-derived account reference shared across clients |
| `session_ref` | HMAC reference for one website session; never the cookie |
| `grant_id` | One OAuth authorization, spanning refresh generations |
| `operation_id` | One durable refresh exchange, retained through restart and recovery |
| `attempt_id` | One application HTTP call; a browser transport retransmission retains it |
| `context_id` | Worker, process or website login-flow context |
| `request_id` | One server arrival, including automatic transport retransmissions |
| `generation` | Credential generation within the grant |

## Locate the interruption

Filter the account timeline to an `operation_id`, keeping server and client events together. The normal client sequence is `refresh_prepared`, `refresh_request_started`, `refresh_response_received`, `refresh_parsed`, `storage_started`, `storage_completed`, then `refresh_completed` or `refresh_recovered`.

- Multiple server arrivals with one `attempt_id` establish a transport retransmission. A new attempt ID with the same operation is an application retry or recovery.
- Server success followed by no client response checkpoint bounds the gap to response delivery or client execution before that checkpoint. It does not prove which one stopped.
- `refresh_parsed` without `storage_completed`, followed by recovery in a new context, bounds the interruption to credential persistence. Check `storage_failed` for an explicit storage error.
- `credentials_cleared` records the reason for a local removal. Only explicit terminal refresh refusals clear an upgraded client's matching generation; network failures, unknown responses and storage failures preserve it.
- `session_deleted` identifies explicit web logout, native logout, account switch, password reset or account deletion when initiated by those routes. `session_unavailable` distinguishes an expired row, a missing row, a lookup failure and an absent cookie at an authentication boundary. An absent cookie alone does not establish why the browser omitted it.
- `session_bridge_completed` links native or extension authentication to website session creation. Callback failures use validated reason codes, and an Apple consent cancellation is recorded separately from a failed login.

Use the dashboard's repeated transport requests, session deletion, bridge failures and storage health views to compare the reported incident with other clients and versions. External OAuth clients have server-side evidence only.

iOS distinguishes the app and share extension. Android refreshes use the shared process coordinator and report `surface=app`, including refreshes requested by the share UI; that field alone cannot identify which Android screen initiated the request.

## Delivery and privacy limits

Client journals retain up to seven days, 512 events and 256 KiB. Uploads contain at most 64 events and 32 KiB. Only acknowledged event IDs are removed; interrupted work uploads after a later start. Pending recovery state is retained independently of the journal. Overflow produces a `journal_health` checkpoint. The server accepts at most ten batches per minute per account and installation.

The upload-only signed permit lasts 210 days and is renewed during token exchange. It survives local logout and authorizes only appending diagnostics. Ownership comes from the verified permit, and queued records retain their original permit across account changes. The ingestion route rejects unknown fields, tokens, arbitrary error text and client-supplied ownership. Diagnostics contain no credentials, cookies, proofs, authorization codes, emails, browsing history or full URLs.

The dedicated group retains events for 365 days. Delivery uses the existing log forwarder, retry path, dead-letter queue and delivery alarms. An offline, uninstalled or permanently unreadable client may never upload its final checkpoint. Acknowledgment confirms ingestion into server logging, not a guarantee against every later delivery failure. Check forwarder health before interpreting an absent event.

Native journals share the credential storage. A complete storage failure can prevent recording or uploading `storage_failed` itself; the last durable checkpoint may be all that survives. A missing completion checkpoint alone does not establish a storage failure.

Native OAuth revocation and website-session deletion are separate operations. A revocation request returning 503 can have already revoked the OAuth grant while website-session cleanup failed. A later idempotent revocation does not delete newly created website sessions and does not prove that the earlier cleanup completed; inspect the corresponding session-deletion events separately.

## Release and rollback

Deploy the server and diagnostics destination before publishing upgraded clients. Initial authorization continues to use PKCE and Bearer access tokens. Existing and newly authorized grants bind to the installation's proof key on their first upgraded refresh; no forced sign-in is required. Legacy clients continue using atomic refresh without interruption recovery.

A bound exchange can recover only the latest replacement credentials using the original operation, parent credential and matching signing key while the grant and account epoch remain valid. Proof replay is refused with a fresh nonce challenge. Recovery neither extends the original replacement expiry nor grants access to earlier ancestors. Logout can revoke a replacement through its historical parent; logout-all, password reset and account deletion invalidate the account epoch before credential cleanup.

To stop new enrollment, set the stack's `hutch:oauthRefreshEnrollmentEnabled` to `false` and deploy. Discovery then disables enrollment and the server refuses a racing first enrollment without spending its parent credential. Keep support for already-bound rotation, recovery and revocation deployed. Reverting to a server that lacks that support strands bound clients.

Before release, run the repository checks and exercise lost-response, browser restart, concurrent refresh, logout during refresh, wrong-key recovery and stale-generation cases. Run the native checks for both app and share paths. Keep environment-specific release dates in the incident timeline; this runbook does not imply that a local implementation has been deployed.
