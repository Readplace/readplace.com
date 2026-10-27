# MCP scanner and assistant-credential runbook

OpenAI's plugin directory scans Readplace's MCP server once a day with its own OAuth credential. When that credential dies, OpenAI keeps knocking without a bearer and, weeks later, emails "authorization for its MCP server is missing or no longer works". On 2026-09-11 that happened and went unseen for 30 days, because the MCP transport recorded nothing about the requests it refused and the access log was the only witness. This page says where each fact now lives and what to do.

## The scanner's footprint

- User-Agent `openai-mcp/1.0.0` (no `(Codex)` suffix — that one is Codex, a different client), classified as `ua_client` `openai`.
- One `POST /mcp` a day, at about 04:47:0xZ, plus one for each rescan.
- When healthy, the same second carries a `refresh_token` grant from `openai-connectors-oauth/1.0` under ChatGPT's dynamically registered client. Access tokens last an hour, so a scan within an hour of a rescan reuses the rescan's token and refreshes nothing. Find that client by its `clientName` `ChatGPT` in the OAuth clients table, not by a remembered id: registration is deduplicated and a re-registration mints a new id.
- `isbot()` is true for `openai-mcp/1.0.0`, `openai-connectors-oauth/1.0` and `Claude-User`.

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
| Did a client ever fetch the tool list? | `mcp_tools_listed` | `oauth_client_id`, `tool_count`, `ua_client` |
| Did the client revoke its own token? | `oauth_token_revoked` | `client_id`, `grant_id`, `outcome` (`revoked`, `not_found`), `token_kind` (`refresh`, `access`, `unknown`) |
| Did the refresh chain continue? | `oauth_token_issued`, `oauth_token_refused` | `client_id`, `grant_type`, `grant_id`, `refresh_refusal.*` |

A field whose value is `undefined` is omitted from the line, not written as `null`; test absence with `not ispresent(field)`. A protocol version that is not a `YYYY-MM-DD` string is recorded as `malformed`. `request_id` joins a line to the access log while that log still exists.

## Decoding the access log for dates before these events

| Endpoint | Status / body bytes | Meaning |
|---|---|---|
| `/mcp` | 401 / 87 | no bearer (`Authentication required`) |
| `/mcp` | 401 / 88 | bearer present but invalid or expired |
| `/mcp` | 400 / 181 | foreign `MCP-Protocol-Version`; clients recover on the next request |
| `/oauth/token` | 400 / 87 | `invalid_grant`: refresh token is invalid (absent — rotated away or revoked) |
| `/oauth/token` | 400 / 88 | `invalid_grant`: refresh token has expired |
| `/oauth/token` | 400 / 62 | `use_dpop_nonce` (from 2026-10-16): the nonce challenge that opens a DPoP-bound refresh; the same client's 200 follows within a second |

## Queries

Logs Insights needs backticks around a dotted field name.

The scanner's daily knock:

```
fields @timestamp, status, reason, ua_client, request_id
| filter stream = "analytics" and event = "mcp_request_refused" and ua_client = "openai"
| sort @timestamp desc
```

Whether the scan reached `tools/list`, over the last 26 hours (no row means it did not):

```
fields @timestamp, tool_count
| filter stream = "analytics" and event = "mcp_tools_listed" and ua_client = "openai"
| stats count(*) as listings, max(@timestamp) as last_listing, latest(tool_count) as tools
```

Listings recorded before `ua_client` was added to `mcp_tools_listed` carry none; for those dates filter `oauth_client_id = "<ChatGPT client id>"` instead. Only the scan lists tools on the ChatGPT client: every listing for it from 2026-09-26 to 2026-10-26 came from the scan account.

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

- **A daily `missing_bearer` from `ua_client` `openai` at about 04:47Z** means the scanner's credential is dead on OpenAI's side. Reconnect it as [Reconnecting the scan](#reconnecting-the-scan) describes. Nothing on the server needs fixing unless other grants on the same client are failing too.
- **Verify the reconnect:** an `authorization_code` grant for the ChatGPT client when **Allow access** is pressed, and within seconds a scan: one `unsupported_protocol_version` refusal, then `mcp_session_initialized` and an `mcp_tools_listed` for the ChatGPT client (readers never list tools, so only a scan produces one). At the next 04:47Z, a `refresh_token` grant with the same `grant_id`. On the MCPs tab, every tool ChatGPT already had should still show Published.
- **Token endpoint `invalid` vs `expired`:** `invalid` means the presented refresh token no longer exists (it was rotated away, or revoked — check `oauth_token_revoked`); `expired` means it outlived its 180-day lifetime.
- **`refresh_refusal.reason` `disconnect`:** the reader pressed **Sign out from all devices** on that client's row under Connected apps on the account page. The refresh evaluator counts it expected, `oauth-refresh-refused-alarm` does not count it, and no `oauth_token_revoked` accompanies it, because the account page revokes without the client's token.
- **`refresh_refusal.reason` `logout-all`:** the reader changed or reset their password. A reset signs every app out. A change does too, except for the app or extension it was made from. The refresh evaluator counts it expected, `oauth-refresh-refused-alarm` does not count it, and no `oauth_token_revoked` accompanies it, because a password change or reset revokes without the client's token.
- **`refresh_refusal.reason` `account-deletion`:** the account was deleted, and every grant it held ended with it. No `oauth_token_revoked` accompanies it.
- **`refresh_refusal.reason` `logout`:** someone called `/oauth/revoke` with a token of that grant, and `oauth_token_revoked` carries its `grant_id`. Any token of the chain revokes the live grant, even one already rotated away, and the endpoint needs no client authentication. OpenAI's connector calls it: it revoked a ChatGPT reader's grant on 2026-10-24.
- **`refresh_refusal.reason` `rotation`:** the client presented a refresh token that had already been rotated, so it never stored the response that replaced it. The grant stays active on the server, but that client can no longer use it. See the rotation posture in the [MCP skill](../../../.claude/skills/mcp/SKILL.md#the-scans-credential).
- **`refresh_refusal.reason` `unknown`:** the server cannot trace the token. It was retired before credential history began on 2026-09-12, was never issued here, or was presented under a different client. A client that keeps presenting one holds a stale credential of its own. On 2026-10-25 ChatGPT told a reader their connection had expired after presenting a token that had already been refused as `unknown` twice on 2026-09-17, 0.3 s after the same reader's live grant had refreshed. Nothing had expired on the server, and reconnecting in ChatGPT is the fix.
- **`refresh_refusal.reason` `nonce_required`:** not a failure. The first request of every DPoP-bound refresh (the Chrome extension from 1.0.682 and the Firefox extension from 1.0.674, which share one refresh client, and the iOS and Android apps, whose native refresh clients handle the challenge the same way) arrives without a nonce; the token endpoint answers 400 `use_dpop_nonce` with a `DPoP-Nonce` header before it looks the credential up, and the client re-signs and succeeds, so an `oauth_token_issued` from the same `visitor_hash` follows within a second. The refresh evaluator counts it `challenged`, `oauth-refresh-refused-alarm` does not count it, and the line carries no `grantId`, so the grant-chain query above does not show it. `nonce_expired` is different and is counted: the retry arrived 300 s or more after its challenge, or carried a nonce the server did not mint for that key or dated ahead of its clock.

## What ends the scan's credential

The scan's grant never expires while OpenAI keeps scanning: every refresh restarts the refresh token's 180-day lifetime, with no absolute cap. These end it:

| Cause | `refresh_refusal.reason` |
|---|---|
| **Sign out from all devices** on the ChatGPT row under Connected apps, signed in as the scan account | `disconnect` |
| A password change, or a completed password reset, on the scan account | `logout-all` |
| Deleting the scan account | `account-deletion` |
| `/oauth/revoke` with any token of the scan's chain | `logout` |
| OpenAI presenting a refresh token it already rotated | `rotation` |
| Rotating `ANALYTICS_SALT`, which keys the HMAC that fingerprints refresh tokens: every rotated refresh token stops matching its grant, which signs out the scan and every app at once. A preview or deploy refuses a changed salt unless `hutch:analyticsSaltGeneration` is bumped past the deployed one | `superseded` |
| Replacing or deleting the OAuth table. The table is `protect`ed, so a preview or deploy that plans either fails | `unknown` |

`oauth-refresh-refused-alarm` counts only first-party clients, and `oauth-refresh-unexpected-comparison` has no alarm action. After its first refusals a dead scan logs no OAuth event at all, only the daily `missing_bearer` knock. `mcp-scan-listing-alarm` emails the alert address when prod has recorded no `mcp_tools_listed` with `ua_client` `openai` for 26 hours; the listing query in [Queries](#queries) is the manual check.

## Reconnecting the scan

On 2026-10-24 the Plugins portal offered no control that reconnects the scan. The Reconnect menu on the MCPs tab appears only when the published app version records an OAuth client, and ChatGPT registers itself dynamically, so the version records none. The scan-account button exists in the portal's code, but the MCPs tab does not render it. The portal's own endpoints still work from a portal tab signed in to the Readplace organization:

1. Open Readplace's MCPs tab on platform.openai.com.
2. In that tab's console, import the loaded script that contains `continuous-review/connection`. It exports the portal's API client, whose method for that endpoint takes the app id (`asdk_app_…`, the plugin id without its `plugin_` prefix), the organization id (the `OpenAI-Organization` header on the portal's own requests) and `"/plugins" + location.search`. It returns an `auth_url` on `https://readplace.com/oauth/authorize` whose `state` decodes to `"purpose":"continuous_scan"`.
3. Open that URL through the portal's popup helper, from the loaded script that contains `apps_oauth_popup`, so the callback can report back to the tab.
4. In the popup, sign in as the dedicated scan account and press **Allow access**. The callback on `platform.openai.com/apps-manage/oauth/` finishes the exchange and starts a scan at once. The app's `continuous-review` status then reads `connection: "selected"`.

The scan account's address and password are kept with the team's credentials, outside this public repository.

## When a check holds a tool

The scan's verdict on each tool is in `GET /v1/dashapi/apps/{app}/continuous-review`, a method of the same portal API client as [Reconnecting the scan](#reconnecting-the-scan). `POST …/continuous-review/rescan` starts a scan at once. Each entry in its `tools` carries:

| Field | Values | Meaning |
|---|---|---|
| `change` | `unchanged`, `changed`, `added`, `removed` | The scanned definition against the one ChatGPT runs |
| `publication` | `live`, `previous_definition`, `removed` | `previous_definition`: ChatGPT still runs what it published before the held change |
| `findings` | `decision` `fail`, with a `reasoning` | Why the change is held |

[What to do about a finding](../../../.claude/skills/mcp/SKILL.md#chatgpt-runs-the-tools-openais-scan-last-published) and [the rename procedure](../../../.claude/skills/mcp/SKILL.md#renaming-a-tool) are in the MCP skill.

On 2026-10-24 the check failed `delete_article` with "This tool's name appears promotional, exaggerated, or inconsistent with its behavior.", because the tool deletes nothing: it returns the steps for the reader to delete the article in the app. It became `get_article_deletion_steps`, deployed on 2026-10-25. The rescan started right after that deploy published the new name with no findings. The first scan after the reconnect had done the same for `list_readlist_articles`, so waiting for `live` can take a single rescan. `delete_article`'s frozen copy was deleted the same day.
