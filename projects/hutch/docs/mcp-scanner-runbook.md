# MCP scanner and assistant-credential runbook

OpenAI's plugin directory scans Readplace's MCP server once a day with its own OAuth credential. When that credential dies, OpenAI keeps knocking without a bearer and, weeks later, emails "authorization for its MCP server is missing or no longer works". On 2026-09-11 that happened and went unseen for 30 days, because the MCP transport recorded nothing about the requests it refused and the access log was the only witness. This page says where each fact now lives and what to do.

## The scanner's footprint

- User-Agent `openai-mcp/1.0.0` (no `(Codex)` suffix — that one is Codex, a different client), classified as `ua_client` `openai`.
- One `POST /mcp` a day, at about 04:47:0xZ.
- When healthy, the same second carries a `refresh_token` grant from `openai-connectors-oauth/1.0` under ChatGPT's dynamically registered client. Find that client by its `clientName` `ChatGPT` in the OAuth clients table, not by a remembered id: registration is deduplicated and a re-registration mints a new id.
- `isbot()` is true for `openai-mcp/1.0.0`, `openai-connectors-oauth/1.0` and `Claude-User`, which is why every MCP emitter records through the ungated recorder. A gated recorder would drop the scanner.

## Where to look

| Source | Retention | What it has |
|---|---|---|
| `/readplace/analytics` | never expires | every event below |
| `/aws/apigateway/hutch-access` | 30 days | `requestId`, `time`, `method`, `status`, `responseLength`, `userAgent` — no path, no IP |
| `/aws/lambda/hutch-handler` | 30 days | application logs |
| `credential#<hmac>` rows in the OAuth table | refresh expiry + 30 days | what happened to a refresh token after it rotated |

Production is `--profile hutch-production`, `ap-southeast-2`; unset the static credentials first (see CLAUDE.md, AWS Accounts):

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  aws logs start-query --profile hutch-production --region ap-southeast-2 \
  --log-group-names /readplace/analytics \
  --start-time <epoch-seconds> --end-time <epoch-seconds> \
  --query-string file://query.txt

env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  aws logs get-query-results --profile hutch-production --region ap-southeast-2 \
  --query-id <query-id>
```

## Which event answers which question

| Question | Event | Key fields |
|---|---|---|
| Why did `/mcp` refuse a request? | `mcp_request_refused` | `status`, `reason` (`missing_bearer`, `invalid_token`, `unsupported_protocol_version`, `parse_error`), `ua_client`, `offered_protocol_version`, `oauth_client_id`/`user_id` after authentication, `request_id` |
| What does a client send when it connects? | `mcp_session_initialized` | `oauth_client_id`, `client_name` (≤64), `client_version` (≤32), `client_protocol_version` |
| Did a client ever fetch the tool list? | `mcp_tools_listed` | `oauth_client_id`, `tool_count` |
| Did the client revoke its own token? | `oauth_token_revoked` | `client_id`, `grant_id`, `outcome` (`revoked`, `not_found`), `token_kind` (`refresh`, `access`, `unknown`) |
| Did the refresh chain continue? | `oauth_token_issued`, `oauth_token_refused` | `client_id`, `grant_type`, `grant_id`, `refresh_refusal.*` |

A field whose value is `undefined` is omitted from the line, not written as `null`; test absence with `not ispresent(field)`. A protocol version that is not a `YYYY-MM-DD` string is recorded as `malformed`. `request_id` joins a line to the access log while that log still exists.

**Never recorded:** the bearer token or any prefix or hash of it, refresh tokens, request bodies, the raw User-Agent. Only the User-Agent's class and the clipped `clientInfo` name and version.

## Decoding the access log for dates before these events

| Endpoint | Status / body bytes | Meaning |
|---|---|---|
| `/mcp` | 401 / 87 | no bearer (`Authentication required`) |
| `/mcp` | 401 / 88 | bearer present but invalid or expired |
| `/mcp` | 400 / 181 | foreign `MCP-Protocol-Version`; clients recover on the next request |
| `/oauth/token` | 400 / 87 | `invalid_grant`: refresh token is invalid (absent — rotated away or revoked) |
| `/oauth/token` | 400 / 88 | `invalid_grant`: refresh token has expired |

## Queries

Logs Insights needs backticks around a dotted field name.

The scanner's daily knock:

```
fields @timestamp, status, reason, ua_client, request_id
| filter stream = "analytics" and event = "mcp_request_refused" and ua_client = "openai"
| sort @timestamp desc
```

Refusals by client and reason:

```
fields @timestamp, reason, ua_client
| filter stream = "analytics" and event = "mcp_request_refused"
| stats count(*) as refusals by bin(1d), reason, ua_client
```

What each client declares when it connects:

```
fields @timestamp, event, oauth_client_id, client_name, client_version, client_protocol_version, tool_count
| filter stream = "analytics" and event in ["mcp_session_initialized", "mcp_tools_listed"]
| stats count(*) as calls, latest(client_name) as name, latest(client_version) as version by oauth_client_id, event
```

Revocations around a date:

```
fields @timestamp, client_id, grant_id, outcome, token_kind
| filter stream = "analytics" and event = "oauth_token_revoked"
| sort @timestamp desc
```

Whether a grant kept refreshing after a refusal:

```
fields @timestamp, event, client_id, coalesce(grant_id, `refresh_refusal.grantId`) as grant
| filter stream = "analytics" and event in ["oauth_token_issued", "oauth_token_refused"]
| filter ispresent(grant_id) or ispresent(`refresh_refusal.grantId`)
| stats min(@timestamp) as first, max(@timestamp) as last, sum(event = "oauth_token_issued") as issued, sum(event = "oauth_token_refused") as refused by grant, client_id
| sort last desc
```

## What it means and what to do

- **A daily `missing_bearer` from `ua_client` `openai` at about 04:47Z** means the scanner's credential is dead on OpenAI's side. Press **Reconnect** for Readplace on the OpenAI Plugins page. Nothing on the server needs fixing unless other grants on the same client are failing too.
- **Verify the reconnect:** an `authorization_code` grant for the ChatGPT client at the time of the click; at the next 04:47Z a `refresh_token` grant with the same `grant_id`; then `mcp_session_initialized` instead of `mcp_request_refused`.
- **Token endpoint `invalid` vs `expired`:** `invalid` means the presented refresh token no longer exists (it was rotated away, or revoked — check `oauth_token_revoked`); `expired` means it outlived its 180-day lifetime.
- **`refresh_refusal.reason` `disconnect`:** the reader disconnected that client under Connected apps on the account page. The refresh evaluator counts it expected, `oauth-refresh-refused-alarm` does not count it, and no `oauth_token_revoked` accompanies it, because the account page revokes without the client's token.
- **`refresh_refusal.reason` `logout-all`:** the reader changed or reset their password, which signs every app out. The refresh evaluator counts it expected, `oauth-refresh-refused-alarm` does not count it, and no `oauth_token_revoked` accompanies it, because a password change or reset revokes without the client's token.
- **Rotation posture:** a replayed refresh token is refused and its successor is **not** revoked. That is deliberate: every replay observed so far came from OpenAI's own platform presenting a token it had already rotated, and revoking the successor would sign out the working half of the client.
