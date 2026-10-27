---
name: mcp
description: Rules for Readplace's MCP server at `/mcp` and the OpenAI plugin-directory scan that publishes its tools to ChatGPT. Use when adding, renaming, removing or editing an MCP tool, its `inputSchema` or the `tools/list` answer; when changing the `/mcp` route, its authentication or gating, what the MCP transport records or an `mcp_*` analytics event; when changing the OAuth token, refresh-rotation or revocation code; when OpenAI emails that "authorization for its MCP server is missing or no longer works"; when the `mcp-scan-listing-alarm` email arrives; when reconnecting the scan in OpenAI's Plugins portal; when a `pnpm check-infra` preview or a deploy is refused over `ANALYTICS_SALT` or the OAuth table, or someone asks to rotate `ANALYTICS_SALT` or bump `hutch:analyticsSaltGeneration`; and when reading `mcp_request_refused`, `mcp_tools_listed`, `oauth_token_refused` or `refresh_refusal.reason` rows.
---

# MCP

MCP-specific rules only. Every rule that is not MCP-specific — hypermedia doctrine, testing, comments, infrastructure — lives in the other skills and in [CLAUDE.md](../../../CLAUDE.md). The [MCP scanner runbook](../../../projects/hutch/docs/mcp-scanner-runbook.md) holds the operations: the scan's footprint, where each event lives, the queries, what ends the scan's credential and the portal console steps.

## The same doctrine over a different transport

Readplace also exposes its domain over MCP (Model Context Protocol) at `/mcp`; the external AI assistant is the client. MCP shares the [hypermedia skill](../hypermedia-api-design/SKILL.md)'s core stance — **the server owns the protocol; the client hardcodes one connection and discovers everything else** — so its [Client Conformance](../hypermedia-api-design/SKILL.md#client-conformance) rules apply to an MCP client too. It diverges in transport and statefulness, so the mapping is partial, not 1:1.

| Siren / HATEOAS | MCP |
|---|---|
| Single entry point `/` (the one hardcoded URL) | The server connection — one Streamable HTTP endpoint or stdio command |
| `Accept` content negotiation, per request | `initialize` capability + protocol-version handshake, once per stateful session |
| `actions[]` (`name`, `href`, `method`, `fields`); `name` is the contract | Tools (`tools/list` → `name`, `inputSchema`; invoked via `tools/call`); tool `name` is the contract |
| `action.fields` (declared inputs) | `inputSchema` (JSON Schema) + optional `outputSchema` the client validates the result against |
| `links[]` by `rel`/`href`, followed not built | Resources (`resources/list` → `uri`; read via `resources/read`); RFC 6570 `uriTemplate` for parameterized access |
| Opaque `next` link; never build `?page=` | Opaque pagination `cursor`/`nextCursor`; echo unchanged, never parse or persist |
| `303` back to the collection after a mutation | Server-pushed `notifications/*/list_changed` and `resources/updated` → re-list / re-read |
| Generic `messages[]` channel; render media types you understand | JSON-RPC error object (the call failed) vs `isError:true` in a result (the operation refused); typed content blocks |
| (no analog) | Prompts (`prompts/list` / `prompts/get`) — user-initiated; MCP-only |

Divergences a client must respect: MCP fixes the invocation verb (`tools/call`, `resources/read`) instead of declaring a `method` per affordance; capabilities are three flat global registries (tools/resources/prompts), not actions bound to an entity, so a per-item operation is a tool taking the item's id/uri as an argument; and staleness signals are asynchronous server pushes, not a synchronous redirect.

The tool set is the single source of truth in the tool catalogue (the one server module that declares each tool's `inputSchema` and annotations — grep the main app's non-test sources for `readOnlyHint`), advertised by the MCP server's `tools/list` handler (grep the main app for `case "tools/list"`), with no client copy to drift. The WebMCP surface (the browser-side provider script that feature-detects the WebMCP `registerTool`/`provideContext` entry points — grep the workspace packages' non-test sources for `registerTool`) is a **provider** that registers one local `save_link` tool for an in-browser agent; a provider declares its own shape, so discover-don't-hardcode does not apply to it. Spec: [modelcontextprotocol.io](https://modelcontextprotocol.io).

## ChatGPT runs the tools OpenAI's scan last published

ChatGPT readers never fetch `tools/list`. They call the tool definitions that OpenAI's plugin directory published from its last successful scan of our MCP server. The scan runs once a day at about 04:47 UTC (User-Agent `openai-mcp/1.0.0`) on a credential of its own: a grant under the one ChatGPT OAuth client every reader shares, bound to whichever Readplace account signed in when the scan was last connected in OpenAI's Plugins portal. That credential died on 2026-09-11. Nobody noticed until OpenAI emailed on 2026-10-22, and by then ChatGPT had missed six weeks of tool changes, including the named-readlist tools. It was reconnected on 2026-10-24.

OpenAI's rule since about 2026-09-21: a scan unpublishes a tool the server stopped listing at once, while a new tool goes live only after automated checks, with no time limit. A rename is a delete plus an add. Reconnecting would have unpublished `list_queue`, ChatGPT's second most-used tool, days before its replacement could go live.

| Rule | Why |
|---|---|
| Keep listing a tool ChatGPT has published until its replacement shows **Published** on the MCPs tab | A changed definition keeps the old one live while OpenAI checks it; a missing tool is gone at the next scan |
| Keep dispatching a tool's old name after it stops being listed | Readers call the published definition until the next scan unpublishes it, and a conversation started before then still holds it. The server still answers to `list_queue` and `delete_article` |
| Prefer fixing a failed check on the server and rescanning to pressing **Request manual review** | An appeal pauses every automatic update and disables Rescan until it is withdrawn, and OpenAI publishes no turnaround. The check failed `delete_article`'s name on 2026-10-24 because the tool deletes nothing; it became `get_article_deletion_steps`, published on 2026-10-25 with no findings |

## Renaming a tool

A finding on a tool's name is fixed by a rename, run the way `list_queue` became `list_readlist_articles`:

1. List the new name, and keep listing the old one from a frozen copy of the definition the scan holds, pinned by a test.
2. Wait until the new name shows `publication` `live` with no findings (the runbook's "When a check holds a tool" has the portal endpoint and its fields).
3. Delete the frozen copy. Keep dispatching the old name.

## The scan's credential

- Bind the scan to a dedicated account no person uses, and leave that account alone. **Sign out from all devices** on its ChatGPT row under Connected apps, a password change or reset, or deleting the account revokes the scan grant and records no revocation.
- Reconnect the scan through the Plugins portal's scan-account connection, never from chatgpt.com: connecting ChatGPT there mints a reader grant the scan never adopts. The portal rendered no control for it on 2026-10-24, so the runbook has the console steps.
- The scan account needs neither email verification nor a subscription, because `tools/list` is never gated (below).
- **Rotation posture:** a replayed refresh token is refused and its successor is **not** revoked. That is deliberate: every replay observed so far came from OpenAI's own platform presenting a token it had already rotated, and revoking the successor would sign out the working half of the client.

## Never gate `tools/list`

Never gate `tools/list` on the caller's subscription or email verification. The scan account has neither, and a scan that lists fewer tools unpublishes the missing ones for every reader. The MCP server's subscription-gating unit tests and the integration tests for a locked and a lapsed account pin the full catalogue: when one fails, fix the code, never the test.

## Recording MCP traffic

- Every MCP emitter records through the ungated analytics recorder, the one that skips the `isbot()` gate. `isbot()` is true for the scan's, the OpenAI connector's and Claude's User-Agents, so a gated recorder would drop exactly the traffic these events exist to show.
- Never record the bearer token or any prefix or hash of it, refresh tokens, request bodies or the raw User-Agent. Record the User-Agent only as its class (`ua_client`), and `clientInfo` only as its clipped name and version.

## Guards that refuse instead of remind

| Guard | Fires when | What the change would do | What clears it |
|---|---|---|---|
| Salt-rotation deploy guard | A `pnpm check-infra` preview or a deploy carries an `ANALYTICS_SALT` that differs from the one the deployed web handler runs with, and `hutch:analyticsSaltGeneration` is not above the deployed `ANALYTICS_SALT_GENERATION` | Every OAuth grant signs out at once (`superseded`), the scan's included; already-sent digest unsubscribe and mark-read links stop verifying; banned-IP hashes stop matching; analytics visitor hashes change, so returning visitors read as new | The human approves, the generation is bumped in the stack config in the same change, and the scan is reconnected through the portal right after the deploy |
| Protected OAuth table | A preview or deploy plans to replace or delete the OAuth table (it is `protect`ed; prod also has deletion protection) | Every grant is refused as `unknown`: every connected app signs out and the plugin is disconnected | The human approves and removes the protection in a reviewed change, with the reconnect planned |
| `mcp-scan-listing-alarm` (prod only) | No `mcp_tools_listed` with `ua_client` `openai` in any hourly period of the window set by `hutch:mcpScanListingWindowHours` (26). It also fires from its creation until the next scan lists | The scan has stopped listing, so ChatGPT stops receiving tool changes | Read the scan grant's `refresh_refusal.reason` against the runbook's causes table, then reconnect through the portal |
| Ungated-listing tests | `tools/list` returns fewer tools to a lapsed, locked or unverified caller | The next scan unpublishes the missing tools for every reader | Fix the code |

Before you change `ANALYTICS_SALT`, bump `hutch:analyticsSaltGeneration`, or accept a preview that replaces or deletes the OAuth table, stop and ask the human with AskUserQuestion. State the consequences in that guard's row and that the scan must be reconnected through the portal right after the deploy. A local preview refused only because `.env` lacks the deployed salt is not a rotation: the refusal message says how to fetch it.

The alarm identifies the scan by its User-Agent class, and every `openai-mcp/<version>` User-Agent without the Codex suffix classifies as `openai`, so another OpenAI caller listing tools keeps the alarm green while the scan is dead. It reports only after 26 hours with no listing, so up to 26 hours after a change kills the credential, and staging has no alarm at all. After any change to the OAuth code, the OAuth table, `ANALYTICS_SALT` or the scan account, start a rescan and run the runbook's listing query instead of waiting for the alarm, and confirm the query's `last_listing` is later than the rescan; after an OAuth refresh change, rescan more than an hour after the previous scan.
