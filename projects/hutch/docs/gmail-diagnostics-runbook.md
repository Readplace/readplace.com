# Gmail diagnostics runbook

Readplace writes structured diagnostic lines for two Gmail flows whose failures cannot be told apart from the outside.

- **Connecting or reconnecting Gmail.** Six different callback checks send the reader to the same `/newsletters?error=oauth_state` page: a malformed callback query, a missing state cookie, a cookie with a bad signature, a cookie whose payload fails validation, a returned state that does not match the cookie, and a state older than the 5-minute TTL. The redirect alone cannot separate a reader who started the connect twice (the second start replaces the state cookie, so Google's return from the first one no longer matches) from a reader who genuinely took too long. The `gmail.oauth.*` events record which check decided, with a fingerprint and an age for both states.
- **Importing earlier issues from Gmail.** When Gmail answers a listing or a message fetch with something the importer cannot use, such as an HTTP 204 with no body, the call is classified `unavailable`, the SQS record is retried, and after its last retry the message is dead-lettered and the job fails as `dead-lettered`. The `gmail.http.*` and `gmail.import.*` events record what each Gmail response carried and follow the SQS record through every retry and through the dead-letter queue.

## Line format

Every diagnostic is one JSON object on one line, written as the single argument of the shared `HutchLogger` (`initRecordGmailDiagnostic` in `projects/hutch/src/runtime/observability/gmail-diagnostics.ts`; the event types live in the same file).

- `version`: the event schema version, currently `1` (`GMAIL_DIAGNOSTIC_VERSION`). Filter on it when a query spans a change to the event shapes.
- `timestamp`: ISO time from the recorder's clock when the line was built. `@timestamp` is the CloudWatch event time of the same line.
- `event`: the event name, for example `gmail.http.attempt`.
- `level`: `ERROR` for an operational failure, `INFO` for everything else. `ERROR` lines are written with `logger.error`, `INFO` lines with `logger.info`.

Lines are serialized with `JSON.stringify`, so a field whose value is `undefined` is **omitted** rather than written as `null`. No diagnostic field is ever `null`. Test for a missing field with `not ispresent(field)` in Logs Insights; the field reference below says what each absence means.

No diagnostic carries a `stream` field. A `stream` field is what routes a line into the never-expiring `/readplace/analytics` group, and diagnostics must not land there.

Recording is best-effort. If the clock, the serializer or the logger throws, the line is dropped and the request or SQS record carries on exactly as it would have. A missing line means "not recorded"; check the request's or record's other lines before concluding that a step did not run.

**Never recorded:** raw OAuth state values (a signed state carries its payload in plain text, which for an import names the sender), authorization codes, cookie values, access or refresh tokens, Gmail account and sender email addresses, sender searches, page tokens, Gmail message IDs, response bodies, headers outside the allowlist below, exception messages and descriptions, full URLs and dynamic path segments. Errors appear only as their class name (`errorName`) or as a validated upper-case error code (`errorCode`). To identify a state, use its fingerprint; to identify a message, use the job, page and `index`.

## Where the lines live

| Events | Log group | Retention |
|---|---|---|
| `gmail.oauth.*` | `/aws/lambda/hutch-handler` (the web Lambda) | 30 days |
| `gmail.import.*` and `gmail.http.attempt` with `handler` `history-import` | `/aws/lambda/gmail-history-import-handler` | 30 days |
| `gmail.import.*` with `handler` `history-import-outcomes` | `/aws/lambda/gmail-history-import-outcomes-handler` | 30 days |
| `gmail.import.*` with `handler` `history-import-page-dlq` or `history-import-outcome-dlq` | `/aws/lambda/gmail-history-import-dlq-handler` | 30 days |
| A copy of every `level` `ERROR` line from the groups above | `/readplace/errors` | 90 days |

Only the import worker calls Gmail, so `gmail.http.attempt` lines appear only in `/aws/lambda/gmail-history-import-handler`.

The complete trace, `INFO` and `ERROR` alike, stays in the source Lambda group for 30 days. After that, only the `ERROR` lines survive, in `/readplace/errors`, until 90 days.

Where this comes from:

- The Lambda names are set in `projects/hutch/src/infra/index.ts`: `hutch` (`LAMBDA_NAMES.hutchHandler`), `gmail-history-import`, `gmail-history-import-outcomes`, and `gmail-history-import-dlq` (through `HutchDLQEventHandler`). `HutchLambda` (`src/packages/hutch-infra-components/src/infra/hutch-lambda.ts`) appends `-handler`, creates the group `/aws/lambda/<name>-handler` with `retentionInDays: 30`, and attaches the observability subscription filter to every Lambda group except the forwarder's own.
- That filter (`buildObservabilityFilterPattern` in `src/packages/hutch-infra-components/src/observability-filter.ts`) matches the text `"level":"ERROR"`. The forwarder (`classifyForwardedLine` in `projects/hutch/src/runtime/forward-analytics/forward-analytics-handler.ts`) sends a line with `level` `ERROR` to the errors group, and sends a line to the analytics group only when its `stream` is one of `FORWARDED_STREAMS`. Diagnostics carry no `stream`, so an `INFO` diagnostic reaches neither funnel and stays only in its source group.
- `/readplace/errors` and its 90 days are `ERRORS_LOG_GROUP` and `ERRORS_LOG_GROUP_RETENTION_DAYS` in `projects/hutch/src/runtime/observability/events.ts`, created as `errors-log-group` in `projects/hutch/src/infra/index.ts`.

In `/readplace/errors` the stored message is the JSON object alone, with the Lambda preamble stripped, and the log stream is named `<source log group>/<source log stream>`. Add `| filter @logStream like "/aws/lambda/gmail-history-import-handler/"` to keep one source. `ERROR` diagnostics also show up in the analytics dashboard's "Recent errors" widget; they have no `message` field, so read the `event` in the `@message` column.

The API Gateway access log, `/aws/apigateway/hutch-access` (30 days), has one row per web request. Its `requestId` is the same value as the `requestId` on `gmail.oauth.*` lines.

### Accounts and regions

Both environments are in `ap-southeast-2`. Default credentials target staging; production is `--profile hutch-production` (see CLAUDE.md, AWS Accounts). Copy log group names from this page or from the infra code: Logs Insights rejects the whole query with `ResourceNotFoundException` when one named group does not exist.

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  aws logs start-query --profile hutch-production --region ap-southeast-2 \
  --log-group-names /aws/lambda/hutch-handler \
  --start-time <epoch-seconds> --end-time <epoch-seconds> \
  --query-string file://query.txt

env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  aws logs get-query-results --profile hutch-production --region ap-southeast-2 --query-id <queryId>
```

When a query names a nested field, put the whole dotted path inside one pair of backticks (`` `response.bodyReads.0.outcome` ``). Backticks around only the last segment leave the column blank on every row.

## OAuth events

The connect request is `POST /newsletters/gmail/connect` (`route` `connect`). Google returns the reader to `GET /integrations/gmail/callback` (`route` `callback`). Both are served by the web Lambda. The code that builds these events is in the integrations page module; grep `projects/hutch/src/runtime/web/pages/integrations` for `gmail.oauth.`.

### Fields on every `gmail.oauth.*` line

| Field | Meaning | When absent |
|---|---|---|
| `route` | `connect` or `callback` | Never |
| `traceId` | A random ID minted when the request reached the route. Every line for one request shares it. | Never |
| `requestId` | API Gateway's request ID, joinable to `/aws/apigateway/hutch-access` | The request did not arrive through API Gateway, such as a local dev server or a test |
| `userId` | The Readplace user ID of the session, read before any guard ran | The reader was not signed in when the request arrived |

### `gmail.oauth.request.received`

The first line for each request, written before any guard runs. Always `INFO`.

| Field | Meaning |
|---|---|
| `method` | The HTTP method |
| `hxRequest` | `true` when the request was an htmx request (`HX-Request: true`) |

### `gmail.oauth.state.issued`

Written by the connect route after it signs a new state, before the new state cookie is set. Always `INFO`.

| Field | Meaning |
|---|---|
| `issuedStateFingerprint` | SHA-256 (hex) of the full signed state. The same string is set as the cookie and sent to Google as `state`, so the callback's `queryState.fingerprint` or `cookieState.fingerprint` matches this value exactly when they are this state. |
| `previousCookie` | An inspection (see below) of the state cookie the reader already had, read **before** it was overwritten |
| `intentKind` | `connect` for a plain connect, `import` when the connect asks for the readonly permission to import a sender's earlier issues |

A `previousCookie` that is present, verifies, and is younger than the TTL means an earlier start was still in flight when this one replaced its cookie.

### State inspection

`previousCookie`, `queryState` and `cookieState` share one shape:

| Field | Meaning | When absent |
|---|---|---|
| `present` | `true` when the value was a non-empty string | Never |
| `fingerprint` | SHA-256 (hex) of the full signed value | `present` is `false` |
| `signatureValid` | Whether the value verifies with the current state secret. `false` also covers a value whose verification threw. | `present` is `false` |
| `payload` | `valid`, `malformed-json` or `schema-rejected` | The value is absent or its signature did not verify |
| `createdAtMs` | When the state was signed, in epoch milliseconds | `payload` is not `valid` |
| `ageMs` | The route's clock reading minus `createdAtMs`. On a callback, `queryState.ageMs`, `cookieState.ageMs` and the route's TTL check all use the same reading. Negative when the state claims to be from the future. | `payload` is not `valid` |
| `intentKind` | `connect` or `import` | `payload` is not `valid` |

### `gmail.oauth.callback.inspected`

Written once per callback that passed the guards, before the route acts on the state. Always `INFO`. A callback stopped by a guard (see `stage` below) has no inspection line.

| Field | Meaning | When absent |
|---|---|---|
| `providerError` | Google's `error` query parameter when it is a standard OAuth error code (`access_denied`, `consent_required`, `interaction_required`, `login_required`, `account_selection_required`, `invalid_request`, `unauthorized_client`, `unsupported_response_type`, `invalid_scope`, `server_error`, `temporarily_unavailable`), otherwise `other` | Google sent no `error` |
| `codePresent` | Whether the query carried a `code` | Never |
| `queryShape` | `valid` when the query has both `code` and `state` as single strings, otherwise `malformed` | Never |
| `queryState` | Inspection of the `state` query parameter | Never |
| `cookieState` | Inspection of the state cookie | Never |
| `statesEqual` | Whether the query `state` and the cookie are the same string | Never |
| `verifiedAgeMs` | `queryState.ageMs`, for diagnosis only. The route never decides on it. It is measured against the same clock reading as `decisionAgeMs`, so the two ages differ only by the gap between the two states' creation times. | The query state did not verify with a valid payload |
| `decisionAgeMs` | `cookieState.ageMs`, which is exactly the age the route's TTL check compared with `ttlMs`. The callback reads the clock once, and both this value and the route's `age > ttlMs` comparison use that reading. | The cookie did not verify with a valid payload |
| `ttlMs` | The TTL the route enforces (300000) | Never |
| `decision` | Which check decided, below | Never |

The decision follows the route's own order:

| `decision` | Meaning | What the reader sees |
|---|---|---|
| `invalid-signature` or `invalid-payload`, first | The cookie's signature check threw, or its signed payload is not JSON. The route fails on this before any other check. | HTTP 500; `request.completed` is `ERROR` |
| `provider-error` | Google returned an error, usually the reader cancelling | `?error=oauth_denied`, or the Gmail page with `import_permission_refused` for an import |
| `malformed-query` | The query lacks `code` or `state` | `?error=oauth_state` |
| `missing-cookie` | No state cookie arrived | `?error=oauth_state` |
| `invalid-signature` | The cookie does not verify with the current state secret | `?error=oauth_state` |
| `invalid-payload` | The cookie verifies but its payload fails validation | `?error=oauth_state` |
| `state-mismatch` | The returned `state` is not the cookie's value | `?error=oauth_state` |
| `expired` | The cookie's state is older than `ttlMs`: `decisionAgeMs` is strictly greater than `ttlMs` | `?error=oauth_state` |
| `accepted` | Every state check passed; the code exchange runs next | Depends on the exchange; see `request.completed` |

### `gmail.oauth.request.completed`

Exactly one per request, written when the response finishes or the connection closes. `ERROR` when `status` is 500 or above, or when `failureReason` is an operational failure (`no-refresh-token`, `exchange-failed`, `reauth-required`, `rejected` or `unavailable`); otherwise `INFO`. The scope refusals `metadata-scope-not-granted` and `scope-not-granted` are the reader's choice on Google's consent screen, so they stay `INFO`.

| Field | Meaning | When absent |
|---|---|---|
| `completion` | `finished` when the response was sent, `aborted` when the connection closed first | Never |
| `status` | The response status. For `aborted`, the status the response held when the connection closed. | Never |
| `stage` | The last stage the request entered, below | Never |
| `failureReason` | The typed reason from the code exchange (`scope-not-granted`, `metadata-scope-not-granted`, `no-refresh-token`, `exchange-failed`) or from the account-email lookup (`reauth-required`, `rejected`, `unavailable`) | Neither step failed |
| `redirect` | Where the response sent the reader: `google-authorize`, `login`, `gmail`, `integrations` or `other` | No redirect (no `Location` or `HX-Redirect` header) |
| `outcome` | The `error` or `notice` query value of a redirect to Readplace's own pages, such as `oauth_state`, `oauth_denied`, `connected` or `import_started` | Not one of our own redirects, or no such parameter |
| `durationMs` | Milliseconds from `request.received` to completion | Never |

`stage` names the guard that stopped the request or the part of the handler that was running: `received`, then the guards `returnSignedOutReader` (callback only), `requireAuth`, `requireNotLocked`, `requireGmailConnectionAccess` and `requireWriteAccess`, then the handler stages from `handler` onwards (for example `state-check`, `exchange`, `account-email`, `account-check`, `save-credentials`, `reconnect`, `import-intent` and `done`). The integrations page module is the authority on the full list. A redirect with a guard's name as its `stage` means that guard ended the request.

## Reading an OAuth trace

### The A/B race: a second connect replaced the state

| Line | Key fields |
|---|---|
| `gmail.oauth.state.issued` (connect, trace 1) | `issuedStateFingerprint` A |
| `gmail.oauth.state.issued` (connect, trace 2) | `issuedStateFingerprint` B, `previousCookie.fingerprint` A, `previousCookie.ageMs` well under 300000 |
| `gmail.oauth.callback.inspected` (callback, trace 3) | `queryState.fingerprint` A, `cookieState.fingerprint` B, both `signatureValid` `true` and `payload` `valid`, `statesEqual` `false`, both ages under `ttlMs`, `decision` `state-mismatch` |
| `gmail.oauth.request.completed` (trace 3) | `status` 303, `stage` `state-check`, `redirect` `integrations`, `outcome` `oauth_state` |

Google returned the reader from the first authorization after a second start had replaced the cookie. Both states are genuine and young, so nothing expired. The two starts' timing, `hxRequest` and `requestId` (joined to the access log's user agent) show how the second start happened.

### Genuine expiry

- `decision` `expired`: `queryState.fingerprint` equals `cookieState.fingerprint` (`statesEqual` `true`) and `decisionAgeMs` is greater than `ttlMs`. `decisionAgeMs` is the value the route rejected, not a recomputation, so how far it exceeds `ttlMs` is how late the reader returned.
- The state cookie's `maxAge` is the same 5 minutes as the TTL (`STATE_TTL_MS` in the gmail connect page module), so the browser usually drops the cookie at about the moment the state expires. A slow return therefore more often reads `missing-cookie`: `cookieState.present` `false`, `queryState` verifying with a valid payload, and `verifiedAgeMs` greater than `ttlMs`. Confirm it by finding the `state.issued` line whose `issuedStateFingerprint` equals `queryState.fingerprint`.

A `missing-cookie` with a young `verifiedAgeMs` is not expiry: the cookie was lost for another reason, such as the callback opening in a different browser or profile from the one that started the connect.

## Import events

### Queues and handlers

| Queue | Fed by | Consumer and `handler` | Visibility timeout | Receives before dead-lettering |
|---|---|---|---|---|
| `gmail-history-import-q` | EventBridge `StartGmailHistoryImport` and `GmailHistoryImportPageProcessed`, plus `ProcessGmailHistoryImportPage` commands the worker sends itself with a 10-second delay | `gmail-history-import-handler`, `history-import` | 120 s | 5 |
| `gmail-history-import-outcomes-q` | EventBridge `GmailHistoryImportMessageIngested` | `gmail-history-import-outcomes-handler`, `history-import-outcomes` | 90 s | 3 |
| `gmail-history-import-failures-dlq` | Both queues above after their last receive, and EventBridge when it cannot deliver to either queue | `gmail-history-import-dlq-handler`, `history-import-page-dlq` or `history-import-outcome-dlq` by source queue | | |

All consumers take one record per invocation and report failures per record. The DLQ has an alarm that emails when a message is visible on it. It has no queue behind it: a record the DLQ handler fails returns to the DLQ and is received again. The values are set in `projects/hutch/src/infra/index.ts` (the outcomes queue's 3 is the `HutchSqsQueue` default).

`GmailHistoryImportMessageIngested` is published by the inbox project's Gmail-import ingest worker, which writes no `gmail.*` diagnostics. Between a `message-processed` `published` step in the worker and the matching `outcome-recorded` step in the outcomes handler, look at that worker's own logs.

### Fields on every `gmail.import.*` and `gmail.http.attempt` line

| Field | Meaning | When absent |
|---|---|---|
| `handler` | `history-import`, `history-import-outcomes`, `history-import-page-dlq` or `history-import-outcome-dlq` | Never |
| `invocationId` | The Lambda request ID (`context.awsRequestId`), the same ID Lambda prints in each line's preamble and in its START, END and REPORT lines | Never |
| `sqsMessageId` | The SQS message ID of the record | Never |
| `receiveCount` | SQS's `ApproximateReceiveCount` as a number: 1 on the first delivery, 2 on the first retry, and so on | Never |
| `sourceQueue` | The queue the record was received from, such as `gmail-history-import-q` or `gmail-history-import-failures-dlq` | Never |
| `deadLetterSourceQueue` | The queue SQS redrove the message from (`DeadLetterQueueSourceArn`) | Every live-queue record. On a DLQ handler record, absence means EventBridge wrote the dead letter after failing to deliver the event to the queue, so no consumer ever received it. |
| `envelopeKind` | `start`, `page` or `progress` on the import queue; `outcome` on the outcomes queue | The body has not been parsed yet (every `record.started` line), or it failed to parse |
| `userId`, `jobId`, `generation` | The import job the record belongs to | Not parsed yet, or the body failed to parse. On a `progress` record without a next page, `generation` is absent. |
| `page` | The page the record processes, `0` for a `start` record. On a `progress` record, the next page it dispatches. | Not parsed yet, `outcome` records, and a `progress` record without a next page |

`sequence` (on `gmail.http.attempt`, `gmail.import.step` and `gmail.import.publication`) counts from 1 within one record's delivery and gives the exact order when timestamps tie. It restarts on every delivery.

### `gmail.import.record.started`

Written when the handler picks the record up, **before** the body is parsed, so it carries only the SQS fields. Always `INFO`. Join it to the rest of the delivery by `sqsMessageId` and `invocationId`.

### `gmail.http.attempt`

One line per actual HTTP request to Gmail or to Google's token endpoint. A cached access token makes no request and writes no line. `ERROR` when `classification` is `transport-failed`, `exception` or `unavailable`, otherwise `INFO`. The fields are `GmailHttpAttempt` in `src/packages/provider-contracts/src/gmail-history.ts`, spread onto the line.

| Field | Meaning | When absent |
|---|---|---|
| `operation` | `messages.list`, `messages.get` or `oauth.refresh` | Never |
| `attempt` | `1`, or `2` for the retry after a 401. Token refreshes are always `1`. | Never |
| `request` | The settings sent, never their values: for `messages.list` the `fieldMask`, `pageSize`, `includeSpamTrash` and `pageTokenPresent`; for `messages.get` the `fieldMask` and `format`; for `oauth.refresh` whether the refresh was forced (`forceRefresh`) | Never |
| `requestedEndpoint` | `gmail.messages.list`, `gmail.messages.get` or `oauth.token` | Never |
| `durationMs` | From just before the request until the response headers arrived. Reading the body is not included. | Never |
| `response` | What came back, below | The request failed in transport (`transportFailure` is present instead) |
| `transportFailure` | `errorName` (such as `TypeError` for `fetch failed`) and `errorCode` | A response arrived |
| `transportFailure.errorCode` | The error's or its cause's code, such as `ECONNRESET` or `UND_ERR_HEADERS_TIMEOUT` | No code shaped like an upper-case error code was found |
| `classification` | How the call was classified, below | Never |

`response`:

| Field | Meaning | When absent |
|---|---|---|
| `status` | The HTTP status | Never |
| `redirected` | Whether `fetch` followed a redirect | Never |
| `finalEndpoint` | Where the response came from: `gmail.messages.list`, `gmail.messages.get`, `oauth.token`, `other-expected-origin` (another path on the expected origin) or `unexpected-origin` | Never |
| `finalOriginExpected` | Whether the response came from the expected origin (`https://gmail.googleapis.com` for messages, `https://oauth2.googleapis.com` for tokens). `false` exactly when `finalEndpoint` is `unexpected-origin`. | Never |
| `bodyNull` | `true` when the response had no body stream at all, as with a native 204 | Never |
| `headers` | Allowlisted, normalized headers, below | Never (the object is present; its fields may be absent) |
| `bodyReads` | One entry per body read the adapter performed, below. Empty when the body was not read. | Never |

`response.headers`. Each field is absent when the header was missing or did not match its expected format.

| Field | Meaning |
|---|---|
| `contentType` | Media type, lower case, without parameters |
| `declaredContentLength` | `Content-Length` as a number |
| `contentEncoding` | `Content-Encoding`, lower case |
| `date` | The response's `Date`, as ISO |
| `retryAfter` | `Retry-After`, as seconds or as an ISO date |
| `googRequestId`, `guploaderUploadId`, `cloudTraceContext` | Google's correlation IDs (`x-goog-request-id`, `x-guploader-uploadid`, `x-cloud-trace-context`). Recorded **only** when `finalOriginExpected` is `true`: absent after a redirect to another origin, but still recorded after a redirect that stayed on the expected origin. |

`response.bodyReads[]`:

| Field | Meaning | When absent |
|---|---|---|
| `source` | `response`, or `clone` for the read of a 403's reasons that happens on a copy before the main read | Never |
| `outcome` | `valid`, `schema-rejected` (JSON, but not the expected shape), `json-decode-failed` (the bytes are not JSON, including zero bytes) or `body-read-failed` (the stream errored) | Never |
| `measuredBytes` | Bytes read, after `fetch` removed any content encoding | `body-read-failed` |
| `errorName` | The error class of a failed read or decode, such as `SyntaxError` | `valid` and `schema-rejected` |
| `fields` | Presence flags and counts only, such as `messagesPresent`, `messageCount`, `nextPageTokenPresent`, `rawPresent`, `labelCount`, `errorPresent`, `accessTokenPresent`. Empty unless the body decoded. | Never (may be `{}`) |

The body is not read for a 401 from `messages.list` or `messages.get` (neither the first nor the second), a `messages.get` 404, a 429 or 5xx from either, or a token response that is neither a success nor a 400 or 401, so those attempts have empty `bodyReads`. A 403 from `messages.list` or `messages.get` is always read on a `clone` first; it gets a second, `response` read only when its reasons are neither a rate limit nor a missing scope.

`classification`:

| Value | Meaning | What the importer does next |
|---|---|---|
| `ok` | A usable response | Continues |
| `not-found` | `messages.get` returned 404 | `message-processed` with outcome `not-found` |
| `token-refresh-retry` | The first 401 from `messages.list` or `messages.get` | A forced `oauth.refresh`, then attempt `2` |
| `reauth-required` | A second 401 from `messages.list` or `messages.get`, or an `oauth.refresh` 400 or 401 whose `error` is anything other than `invalid_scope` (such as `invalid_grant`). Neither 401 from Gmail has its body read. | `gmail-call-failed`, then `connection-revoked`, then `job-failed` `permission-revoked`. When `connection-revoked` has `persisted` `false` (the connection changed under the import), the record throws instead and is retried: `record.finished` `retry-requested`, and no `job-failed`. |
| `readonly-permission-required` | The readonly permission is missing: a `messages.list` or `messages.get` 403 whose reasons name a missing scope, or an `oauth.refresh` 400 or 401 with `error` `invalid_scope` | `gmail-call-failed`, then `job-failed` `permission-revoked` |
| `rejected` | `messages.list` and `messages.get` only: any other 4xx except 429 left after the 401, 403 and 404 handling above, such as a 403 whose reasons are neither a rate limit nor a missing scope, or a 404 from `messages.list`. The token endpoint never produces `rejected`. | `gmail-call-failed`, then `job-failed` `gmail-rejected` |
| `unavailable` | For `messages.list` and `messages.get`: a 403 whose reasons name a rate limit, a 429, a 5xx, or a success status whose body did not decode or validate, which includes an empty 204. For `oauth.refresh`: any non-success status other than 400 and 401, with the body **not** read (so an `oauth.refresh` 403 or 429 is `unavailable` without any rate-limit check), or a success status whose JSON fails the token response schema. | `gmail-call-failed`, then the record throws and is retried |
| `transport-failed` | The request never got a response | The error propagates and the record is retried; no `gmail-call-failed` |
| `exception` | `oauth.refresh` only: a success status whose body could not be read or decoded as JSON (`bodyReads.0.outcome` `body-read-failed` or `json-decode-failed`); the original error is rethrown | The record is retried; no `gmail-call-failed` |

### `gmail.import.step`

One line per decision the importer or handler made. `ERROR` for `job-failed`, `gmail-call-failed` and `message-publication-failed`, otherwise `INFO`. The step is under `step`, with `step.kind` naming it:

| `step.kind` | Extra fields | Meaning |
|---|---|---|
| `page-skipped` | `reason` | The page did nothing because a check stopped it: `job-missing`, `generation-stale` (the record belongs to an earlier run of the job), `job-not-runnable`, `page-mismatch`, `claim-lost` (another delivery claimed the page), `fetched-stale` or `save-page-lost`. Expected for duplicate and late deliveries. |
| `page-already-processed` | `listingCompleted` | The job is already past this page; a redelivery |
| `job-cancelled` | `reason`, `cancelledJobs` | The connection, mapping or destinations changed, so the importer cancelled the sender's jobs |
| `page-claimed` | | This delivery owns the page |
| `page-listed` | `messageCount`, `nextPagePresent` | The listing call succeeded |
| `gmail-call-failed` | `operation`, `lastAttemptOperation`, `reason`, `status` | A Gmail call failed. `operation` is the call the importer made (`messages.list` or `messages.get`). `lastAttemptOperation` is the operation of the last HTTP attempt observed during that call: `oauth.refresh` means Google's token endpoint produced the failure, `messages.list` or `messages.get` means Gmail's API did, and it is absent when the call failed without sending any request (no stored refresh token); see [Token endpoint or Gmail API](#token-endpoint-or-gmail-api). `reason` is the classification the call returned, and `status` the HTTP status that failure carried, absent for `reauth-required` and `readonly-permission-required`. |
| `message-processed` | `index`, `outcome` | Message number `index` on the page: `published`, `not-found`, `unlisted-label` (spam or trash) or `already-settled` |
| `message-publication-failed` | `index`, `errorName` | Publishing the fetched message failed; the record is retried |
| `page-saved` | `nextPagePresent` | The page's progress was saved |
| `connection-revoked` | `persisted` | The connection was marked revoked (`persisted` `false`: it had already changed) |
| `job-failed` | `reason`, `persisted` | The job failed as `gmail-rejected`, `permission-revoked` or `dead-lettered`. `persisted` `false` means the job had already moved on, so the write was a no-op. |
| `job-completed` | `persisted` | Completion was checked; `persisted` `true` means this record completed the job |
| `dead-letter-without-generation` | | DLQ only: a dead-lettered `progress` record without a next page. There is nothing to fail, so it is acknowledged. |
| `outcome-recorded` | `result`, `outcome` | Outcomes handlers: the message outcome written (`outcome`; always `failed` on the outcome DLQ) and whether it was `recorded`, a `duplicate` or `stale` |

### `gmail.import.publication`

One line per event or command the handler publishes. `ERROR` when it failed, otherwise `INFO`.

| Field | Meaning | When absent |
|---|---|---|
| `target` | The event or command published: `GmailHistoryImportPageProcessed`, `ProcessGmailHistoryImportPage`, `GmailHistoryImportCompleted` or `GmailHistoryImportFailed` | Never |
| `outcome` | `published` or `failed`. A failed publication is rethrown and the record is retried. | Never |
| `errorName` | The error class of a failed publication | `published` |

Each fetched message's own `GmailHistoryImportMessageFetched` publication shows up as a `message-processed` step (`published`) or a `message-publication-failed` step instead.

### `gmail.import.record.finished`

The last line of a delivery.

| Field | Meaning | When absent |
|---|---|---|
| `outcome` | `acked` (`INFO`): the handler finished with the record. `retry-requested` (`ERROR`): the handler reported the record as failed, so SQS will deliver it again. | Never |
| `errorName` | The error class that failed the record | `acked` |
| `durationMs` | From `record.started` to here | Never |

`acked` does not mean the import completed. Completion is the `job-completed` step with `persisted` `true`, followed by a `GmailHistoryImportCompleted` publication.

## Reading an import trace

A page that works writes `record.started`, then in `sequence` order: `page-claimed`; an `oauth.refresh` attempt when no token was cached; a `messages.list` attempt; `page-listed`; then for each message a `messages.get` attempt and a `message-processed` step; `page-saved`; `job-completed` on the last page; the publications; `record.finished` `acked`. The `progress` record that follows publishes `ProcessGmailHistoryImportPage` for the next page.

A retry is the same `sqsMessageId` again with `receiveCount` one higher, roughly one visibility timeout after the `retry-requested` line. A page that fails on every receive reaches the DLQ after its fifth receive on `gmail-history-import-q`, roughly five visibility timeouts (about ten minutes) after its first receive; an outcome reaches it after its third receive on `gmail-history-import-outcomes-q`. The DLQ handler's lines then show `sourceQueue` `gmail-history-import-failures-dlq` and `deadLetterSourceQueue` naming the original queue. For a page: `job-failed` `dead-lettered` with `persisted` `true`, then a `GmailHistoryImportFailed` publication, when this dead letter failed the job; `persisted` `false` and no publication when the job had already moved on. For an outcome: `outcome-recorded` with `outcome` `failed`, which can complete the job.

A record whose body does not parse writes `record.started` and `record.finished` `retry-requested` with only the SQS fields. Find it by `sqsMessageId`, not `jobId`. A dead letter that names no source queue at all fails in the shared dead-letter router before any handler runs, so it writes no `gmail.import.*` line; look for the router's assertion error in `/aws/lambda/gmail-history-import-dlq-handler`.

### Token endpoint or Gmail API

A `gmail-call-failed` step's `step.operation` is always the Gmail call the importer made, even when that call failed while refreshing its access token. `step.lastAttemptOperation` says which HTTP attempt ended the call:

| `step.lastAttemptOperation` | Where the failure came from |
|---|---|
| `oauth.refresh` | Google's token endpoint: the refresh made because no unexpired access token was cached, or the forced refresh after a 401. `step.status` is the token endpoint's status. Many `unavailable` failures with this value and a 5xx `step.status` are a Google OAuth outage, not a Gmail API one. |
| `messages.list` or `messages.get` (the same as `step.operation`) | Gmail's API answered the call. If that attempt's `classification` is `token-refresh-retry`, Gmail returned a 401 and the forced refresh that followed sent no request because no refresh token is stored; `step.reason` is `reauth-required`. |
| Absent | The call sent no request at all, because no refresh token is stored. `step.reason` is `reauth-required`. |

The attempt that ended the call is the `gmail.http.attempt` line with that `operation` immediately before the step in `sequence`. A `transport-failed` or `exception` attempt writes no `gmail-call-failed` step, so look for those on the attempt lines; the last query in (d) counts them for the token endpoint.

### An empty 204

| Field | Reading |
|---|---|
| `response.status` 204, `response.bodyNull` `true` | Gmail sent no body stream at all |
| `response.bodyReads.0.outcome` `json-decode-failed`, `measuredBytes` 0, `errorName` `SyntaxError` | The JSON read found zero bytes |
| `response.headers.declaredContentLength` | What the server declared; absent when it sent no `Content-Length` |
| `classification` `unavailable` (or `exception` on `oauth.refresh`) | The adapter could not use it. For Gmail calls the next line is `gmail-call-failed` with `status` 204 and `lastAttemptOperation` equal to `operation`, then `record.finished` `retry-requested`. An `oauth.refresh` `exception` writes no `gmail-call-failed`; the next line is `record.finished` `retry-requested` whose `errorName` is the read or decode error's class. |
| `response.finalEndpoint` and `response.finalOriginExpected` | `finalOriginExpected` `true` with `finalEndpoint` equal to `requestedEndpoint` means Gmail's own API answered. `unexpected-origin` (`finalOriginExpected` `false`) means a redirect sent the request to another origin, and the provider IDs are absent by design. `redirected` `true` with `finalOriginExpected` `true` is a redirect that stayed on the expected origin; its provider IDs are still recorded. |
| `googRequestId`, `guploaderUploadId`, `cloudTraceContext`, `date` | The identifiers and time to quote when raising the response with Google |

`bodyNull` `false` with `measuredBytes` 0 is an empty body stream rather than no body. `measuredBytes` above 0 with `json-decode-failed` is a body that is not JSON.

Because `unavailable` and `exception` attempts are `ERROR`, a 204 is still queryable in `/readplace/errors` for 90 days after the rest of its trace has aged out of the Lambda group.

## Logs Insights queries

### (a) Account → connect requests → state fingerprints → callback decision

Log group: `/aws/lambda/hutch-handler`.

```
fields @timestamp, event, route, traceId, requestId, method, hxRequest, level, stage, status, completion,
       issuedStateFingerprint, `previousCookie.fingerprint` as previousFingerprint, `previousCookie.ageMs` as previousAgeMs,
       `queryState.fingerprint` as queryFingerprint, `cookieState.fingerprint` as cookieFingerprint,
       `queryState.signatureValid` as querySignatureValid, `cookieState.signatureValid` as cookieSignatureValid,
       statesEqual, verifiedAgeMs, decisionAgeMs, ttlMs, providerError, decision,
       failureReason, redirect, outcome, durationMs
| filter userId = "<userId>" and event like /^gmail\.oauth\./
| sort @timestamp asc
| limit 500
```

Read it as described in [Reading an OAuth trace](#reading-an-oauth-trace). To see a single request, replace the filter with `traceId = "<traceId>"`. A callback that arrived signed out has no `userId`; find it in the same time window with `filter route = "callback" and not ispresent(userId)`, and expect `stage` `returnSignedOutReader` with `redirect` `login`.

How often each check decides:

```
filter event = "gmail.oauth.callback.inspected"
| stats count(*) as callbacks by decision
```

### (b) Job and generation → HTTP attempts → queue retries → DLQ outcome

Log groups: `/aws/lambda/gmail-history-import-handler`, `/aws/lambda/gmail-history-import-outcomes-handler`, `/aws/lambda/gmail-history-import-dlq-handler`.

```
fields @timestamp, @log, handler, invocationId, sqsMessageId, receiveCount, sourceQueue, deadLetterSourceQueue,
       envelopeKind, generation, page, sequence, event, level,
       operation, attempt, `response.status` as status, classification,
       `step.kind` as stepKind, `step.reason` as stepReason, `step.persisted` as stepPersisted, `step.outcome` as stepOutcome,
       `step.operation` as stepOperation, `step.lastAttemptOperation` as stepLastAttemptOperation, `step.status` as stepStatus,
       target, outcome, errorName, durationMs
| filter jobId = "<jobId>"
| sort @timestamp asc
| limit 2000
```

Add `and generation = "<generation>"` to follow one run of the job. Within one delivery, order by `sequence`.

Every delivery of the job and how it ended:

```
fields @timestamp, @log, handler, sqsMessageId, receiveCount, sourceQueue, deadLetterSourceQueue, envelopeKind, page, outcome, errorName, durationMs
| filter jobId = "<jobId>" and event = "gmail.import.record.finished"
| sort @timestamp asc
```

`record.started` lines carry no `jobId`. To bring them in, or to follow a record whose body did not parse, query by message:

```
fields @timestamp, @log, event, handler, invocationId, receiveCount, sourceQueue, deadLetterSourceQueue, envelopeKind, outcome, errorName
| filter sqsMessageId = "<sqsMessageId>"
| sort @timestamp asc
```

### (c) HTTP 204 → operation, parsing evidence, endpoint and provider IDs

Log group: `/aws/lambda/gmail-history-import-handler` for the last 30 days, or `/readplace/errors` for up to 90 days (see [An empty 204](#an-empty-204)).

```
fields @timestamp, userId, jobId, generation, page, sqsMessageId, receiveCount, sequence,
       operation, attempt, requestedEndpoint, classification,
       `response.redirected` as redirected, `response.finalEndpoint` as finalEndpoint,
       `response.finalOriginExpected` as originExpected, `response.bodyNull` as bodyNull,
       `response.headers.declaredContentLength` as declaredLength, `response.headers.contentType` as contentType,
       `response.headers.contentEncoding` as contentEncoding,
       `response.bodyReads.0.source` as readSource, `response.bodyReads.0.outcome` as readOutcome,
       `response.bodyReads.0.measuredBytes` as measuredBytes, `response.bodyReads.0.errorName` as readError,
       `response.headers.date` as gmailDate, `response.headers.googRequestId` as googRequestId,
       `response.headers.guploaderUploadId` as guploaderUploadId, `response.headers.cloudTraceContext` as cloudTraceContext
| filter event = "gmail.http.attempt" and `response.status` = 204
| sort @timestamp asc
| limit 1000
```

The same population, counted:

```
filter event = "gmail.http.attempt" and `response.status` = 204
| stats count(*) as attempts by operation, classification, `response.bodyNull`, `response.bodyReads.0.outcome`, `response.finalEndpoint`
```

Then run query (b) for an affected `jobId` to see what the retries did and whether the page reached the DLQ.

### (d) Failed Gmail calls → token endpoint or Gmail API

Log group: `/aws/lambda/gmail-history-import-handler` for the last 30 days, or `/readplace/errors` for up to 90 days (`gmail-call-failed` steps are `ERROR`). Read the result as described in [Token endpoint or Gmail API](#token-endpoint-or-gmail-api).

Each query below groups only by fields every matching line carries; a field that can be absent, such as `step.status`, is collected with `values` instead.

```
filter event = "gmail.import.step" and `step.kind` = "gmail-call-failed" and ispresent(`step.lastAttemptOperation`)
| stats count(*) as failures, values(`step.status`) as statuses
        by bin(1h), `step.operation`, `step.lastAttemptOperation`, `step.reason`
```

The calls that sent no request, which carry no `step.lastAttemptOperation`:

```
filter event = "gmail.import.step" and `step.kind` = "gmail-call-failed" and not ispresent(`step.lastAttemptOperation`)
| stats count(*) as failures by bin(1h), `step.operation`, `step.reason`
```

The token endpoint's own attempts, including the `transport-failed` and `exception` ones that end a delivery without a `gmail-call-failed` step. In `/readplace/errors` only the `ERROR` classifications (`unavailable`, `transport-failed` and `exception`) appear.

```
filter event = "gmail.http.attempt" and operation = "oauth.refresh" and classification != "ok"
| stats count(*) as attempts, values(`response.status`) as statuses, values(`transportFailure.errorCode`) as errorCodes
        by bin(1h), classification
```
