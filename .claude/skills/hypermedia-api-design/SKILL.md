---
name: hypermedia-api-design
description: Hypermedia contract between Readplace's hutch server and every client that consumes it — the chrome and firefox extensions, the iOS app, the MCP server, and future clients. Use when adding, renaming, or removing an API capability a client consumes, when the server emits or parses Siren responses, or when any client's navigation/action flow changes.
---

# Client ↔ Hutch Hypermedia API Design

Clients talk to hutch over a Siren (`application/vnd.siren+json`) hypermedia API; the same URLs serve browsers (`text/html`) via content negotiation. This doctrine governs **every** client surface — the chrome and firefox extensions, the iOS app, the MCP server, and any future client — so a server-side view change never forces a client redeploy. The contract is **the message format plus a stable vocabulary of action names** — not a catalogue of URLs, methods, or request shapes.

## Core Principle: The Server Owns the Protocol

A client knows exactly one URL: the entry point (`/`). From there, the server tells the client:
- Where to navigate next (`links[rel=self]`)
- What actions are possible (`actions[].name`, `.href`, `.method`, `.fields`)
- How items relate (`entities[].rel`, entity-level actions/links)

The client's job is to interpret the Siren format and follow what the server says — not to construct URLs or hard-code HTTP methods.

### References
- Server schemas: [projects/hutch/src/runtime/web/api/siren.ts](../../../projects/hutch/src/runtime/web/api/siren.ts)
- Collection emission: [projects/hutch/src/runtime/web/api/collection-siren.ts](../../../projects/hutch/src/runtime/web/api/collection-siren.ts)
- Entity emission: [projects/hutch/src/runtime/web/api/article-siren.ts](../../../projects/hutch/src/runtime/web/api/article-siren.ts)
- Content negotiation: [projects/hutch/src/runtime/web/content-negotiation.ts](../../../projects/hutch/src/runtime/web/content-negotiation.ts)
- Client implementations: see [Per-Client Implementations](#per-client-implementations)

## Content Negotiation, Not Parallel APIs

One URL per capability serves both the browser (HTML) and a programmatic client (Siren) based on `Accept`. Do not add a `/api/*` tree or version prefix — that creates two independent evolutions of the same concept.

- `GET /` with `Accept: application/vnd.siren+json` → `303 See Other` → `/queue` (the Siren entry point)
- `GET /` with `Accept: text/html` → home page
- Branch on `wantsSiren(req)`, then emit from the same domain data

Why 303 over the entry point: the server decides where the collection lives; renaming `/queue` to something else is a server-internal change because the client only followed the redirect.

## What a Client Must Know vs Discover

| Must know (client code) | Must discover (from server response) |
|---|---|
| Entry point URL (`/`) | Resource URLs (`/queue`, `/queue/:id/status`) |
| Siren media type | HTTP methods |
| Action names it supports (`save-article`, `update-status`, `search`) | Field names and types per action |
| Field semantics for those names (`url`, `status`) | Pagination / sort / filter links (`next`, `prev`, `self`) |
| Link `rel`s it supports (`self`, `read`) | Entity URLs for reading or status changes |

Anything in the right column that the client hard-codes is a future breaking change waiting to happen.

## Action Names Are the Contract — Name Them Well

Action names are the one thing both sides must agree on by name. Treat them like a [published interface](https://martinfowler.com/bliki/PublishedInterface.html): stable, capability-focused, not domain-specific.

| Avoid | Prefer | Reason |
|---|---|---|
| `filter-by-status` | `search` | A narrower name promises less than the action delivers; once `url`/`page`/`order` join the fields, the name lies |
| `list-unread` | `search` + `status: "unread"` field | Capability vs. domain state |
| `mark-done` | `update-status` | Domain states change; capabilities don't |
| `get-article-by-id` | (use the entity's `self` link) | URLs aren't actions |

Renaming an action is a breaking change — both sides must ship together. Renaming a property inside `properties` is also a breaking change for any client that reads it. Adding a new action or a new property is not.

## Evolvability Rules

| Change | Breaking? | Notes |
|---|---|---|
| Add a new `action` | No | A *titled* action renders as a generic control; a *title-less* one the client doesn't recognise is a machine capability it skips (see **Label**) |
| Add a new `field` to an existing action | Potentially | Safe if optional server-side; breaking if required |
| Add a new `link` `rel` | No | Clients only follow `rel`s they understand |
| Add a new property to `entities[].properties` | No | Extra properties are ignored |
| Rename an action | **Yes** | Action name is the contract |
| Rename a field name | **Yes** | Field name is the contract |
| Rename a property in `properties` that clients read | **Yes** | Treat known property names as the contract |
| Change an action's `method` | No | Client follows what the server declares |
| Change an action's `href` | No | Same reason |
| Change the URL structure of the site | No | As long as entry point and self-links stay consistent |

When a breaking change is necessary, add the new capability alongside the old one, wait for clients to migrate, then remove the old. Versioned URLs (`/v2/queue`) are banned — they are a symptom of an API that doesn't evolve via the message format.

## State Lives in the Network

HTTP caching (`ETag` + `If-None-Match`) is the authoritative cache layer. Do not build a parallel in-client cache of "what articles exist" as the source of truth. A client may keep a short-lived cache of *bound actions* (items the server returned with their `update-status` action attached) as a performance optimisation, but the canonical state is always whatever the server returns next.

- Cache wrapper: `httpCacheable(understanding)` in the browser extension's `siren-reading-list.ts`
- Short-lived action cache: `knownItems` in `initSirenReadingList` (cleared on every mutation)

After a mutation, the server drives the client back to the collection via `303 See Other`. `fetch` follows the redirect automatically; the client parses the new collection and that becomes the new truth. Do not synthesise "the new list after delete" client-side — read it from the response.

## Form Fields Are Declared, Not Assumed

The server declares what an action needs via `action.fields`, and **the input VALUES come from the server too** — each field may carry a `value` (the server-suggested/target value). The generic invoker builds the request body by posting each declared field's `value`, ENCODED per the action's `type` (`application/x-www-form-urlencoded` → `URLSearchParams`; `application/json` → JSON). A bare `(id, name)` / `(entity, action)` invocation is therefore sufficient: the client supplies no field knowledge and never hardcodes a field value.

A field-requiring action whose field carries no server-provided `value` is **not invokable by a bare control** — only a bespoke handler that produces that value (e.g. a search box's typed query) can invoke it.

When adding a new required input to an action:

1. Server: add a new entry to `fields` (carrying its `value` when the value is server-known) and validate it in the route handler.
2. Client: nothing for server-valued fields — the generic invoker already posts the declared `value`. Only an input the *user* must supply needs a bespoke handler.

When adding an optional input, only the server changes; old clients keep working.

## Server-Driven Messages Are Trusted HTML

The server can refuse or annotate an action with a generic, feature-agnostic message channel instead of a bespoke error code. The shape is a stable published interface:

```jsonc
"properties": {
  "messages": [
    { "type": "warning" | "error",
      "content": { "type": "text/html", "body": "…server-authored HTML…" } }
  ]
}
```

The client owns **no** knowledge of what a message means — it only knows how to render one. The web/extension clients inject `content.body` as HTML (so an `<a href="mailto:…">` renders); iOS strips it to plain text. A locked-account save refusal is the first producer (`accountLockedSirenError`), but the channel is deliberately generic so any future "show the user this, let them keep reading, but block the save" interceptor reuses it rather than adding another bespoke surface.

**The client renders only media types it understands.** `content.type` is the body's media type. Today every client renders exactly one — `text/html` — and **ignores any other media type**: an unrecognised `content.type` is dropped, never displayed, never injected. Be liberal in what you accept (the envelope parses regardless of `content.type`, so a refusal carrying an unknown type still drops the user back into the list rather than failing generically) and conservative in what you render (only the media types the client knows). This makes a new media type a forward-compatible change — older clients skip a body they can't interpret instead of mis-rendering it. The extension filters in `buildMessageView`; iOS filters in `refusalError`.

**Invariant — `content.body` is trusted, server-authored, server-side-escaped HTML.** The server is the *only* author. Because the extension renders it via `innerHTML`, a body that interpolates any untrusted or user-derived value — a saved URL, an article title, an email address — **without escaping it server-side** is markup injection into the popup. This is safe today only because the single producer builds from a static constant. Before a message body ever interpolates dynamic data:

1. Escape it server-side. The body is HTML; treat every interpolation as untrusted until escaped.
2. Only `text/html` bodies are ever injected — the client ignores any other `content.type` (see "The client renders only media types it understands" above), so an unknown media type can never be mis-rendered as HTML. A `text/html` body, by contrast, is *always* injected, so the escaping in (1) is mandatory for it.
3. Never move escaping to the client — the server owns the protocol, and "the client only renders" is what stops every client (extension, iOS, future) re-implementing sanitisation differently.

The client-side render decisions (per-`type` variant class, the `role` politeness, empty/hidden, and which media types are renderable) live in `buildMessageView` (`browser-extension-core`) — pure and unit-tested; the popup glue only paints its output.

## Entity-Level vs Collection-Level Actions

| Action scope | Where it lives | Example |
|---|---|---|
| Collection-level | `entity.actions` on the collection | `save-article`, `search` |
| Entity-level | `entities[].actions` | `update-status` |

A client binds both levels: collection-level actions (e.g. `save-article`, `search`) and the per-entity actions on each item (e.g. `update-status`). Put an action at the level where it makes sense — "mark this article read" belongs on the article entity, not the collection.

## Rendering & Invoking Affordances

A client loops over the current response's `actions` and renders **one control per action** — never a fixed set of named controls gated by booleans. The loop is the contract: a server affordance added later renders with zero client change, and one the client doesn't recognise still renders (default presentation) rather than vanishing.

**Actions and links are symmetric affordances.** A client iterates **both** `actions` **and** semantic (non-structural) `links`, rendering **one control per affordance** from either collection — same loop, same rules. Both carry a Siren `title` for the label and a `name`/`rel` the client maps to its own presentation/placement (e.g. the `read` link becomes a row's primary open anchor). An action is invoked via its `href`/`method`/`fields`; a semantic link is opened/navigated via its `href`. The only asymmetry is structural rels (below), which links can carry but actions cannot.

**Structural vs control affordances.** Not every link is a user control. **Structural** navigation link rels (`self`, `root`, `prev`, `next`, `item`) are followed by the client for its **own** navigation — pagination, identity, item resolution — and MUST NOT be rendered as tappable controls. Render controls for **actions** and for **semantic** (non-structural) links the client understands (e.g. `read`). An unrecognised link rel is neither structural nor a known control, so it produces no control.

**Label** — comes from the affordance's Siren `title` (present on actions *and* links). The same string doubles as the control's `aria-label`/tooltip; the client never invents copy per action name. When a *recognised* affordance carries no `title`, the client humanizes the token (action `name` / link `rel`) consistently, so it renders the same human label across clients.

**A `title` is also the server's signal that an affordance is a user control.** A title-less affordance the client does **not** recognise is a **machine capability** — advertised for the client to invoke bespoke (e.g. `create-session`, which mints a reader session cookie), never surfaced as a control. So an unrecognised affordance is rendered as a control **only when the server titled it**; a title-less unrecognised one is skipped. This is what reconciles "clients skip an action they don't handle" (Evolvability) with "an unknown name/rel still renders with a default presentation" (below): the default presentation is for an *unrecognised but titled* affordance. Without this rule, every machine capability the server adds later surfaces as a mystery control on already-shipped clients — which is exactly what a field-less, title-less `create-session` did until clients special-cased it, then generalised to this rule.

**Presentation is one client-side mapping.** The server sends no style, class, icon, or placement. The client derives **both** style **and** icon/glyph from a single mapping of the action `name` (or a semantic link `rel`) to its **own** design tokens, with a default for any unknown name/rel. An inline `name === "delete"` branch chosen for presentation is the same smell as the gated booleans — forbidden; route every presentation decision through the one mapping. A server string is never used as a CSS class verbatim — that would couple styling to wire vocabulary and break on a rename.

> Optional, not required: if a future server ever needs to hint *semantic* role for an action a client can't recognise by `name` (e.g. "this is destructive"), it would ride Siren's `class` array as a **semantic token** the client maps to its own tokens — still client-mapped, never emitted as a CSS class. Do not add this until a real client need exists.

**Invocation** — invoke an action via **its own** `href`/`method`/`type`/`fields` through one generic invoker: post each declared field's server-provided `value`, encoded per the action's `type` (urlencoded → form-encoded body, json → JSON body). The bare `(id, name)` is sufficient because the value rides the field (see [Form Fields Are Declared, Not Assumed](#form-fields-are-declared-not-assumed)); keep bespoke handlers only for inputs the user supplies or special bodies (e.g. file uploads). **Follow** a structural navigation link (`self`/`root`/`prev`/`next`/`item`) for the client's own navigation; **open/navigate** a semantic link's `href` as a control. Resolve every href through the single scheme-aware resolver (see the resolver rule in [Client Conformance](#client-conformance)); never hardcode the host.

**Extension popup ↔ background boundary** — the action descriptor can't always be passed live across the messaging boundary, so serialize a minimal descriptor (`{name, title}`) as plain data and invoke **by name** on the other side; the walker retains the full `href`/`method` and performs the actual request. This keeps the popup free of any hardcoded route while staying within the structured-clone limits of the messaging channel.

## Anti-Patterns

| Avoid | Why |
|---|---|
| Hard-coding URLs in a client (e.g. `\`${serverUrl}/queue/${id}/delete\``) | Makes URL changes a coordinated deploy |
| A `/api/v1/...` route tree parallel to the HTML pages | Two things to keep in sync; versioning creep |
| Returning JSON with a bespoke shape (`{items: [...], nextPage: ...}`) | Forces every client to re-implement Siren badly |
| Client-owned pagination URLs (`?page=${current+1}`) | Server can't change pagination without breaking clients; follow the `next` link instead |
| Action names that describe implementation (`filter-by-status`, `query-v2`) | Domain drift renames the action; clients break |
| CORS misses for `OPTIONS` on a Siren entry point | Firefox extensions send a preflight for `Accept: application/vnd.siren+json`; without `OPTIONS` it 404s and the fetch aborts with `NetworkError` |
| Synthesising state after a mutation (`allItems.filter(i => i.id !== deletedId)`) | Server is the source of truth; follow the 303 and read the new collection |
| Exporting an `/api` SDK that knows resource URLs | Becomes another versioned surface; expose only the walker and the entry point |
| Interpolating unescaped user data into a `messages[].content.body` | The client injects it via `innerHTML`; unescaped server output is markup injection (see "Server-Driven Messages Are Trusted HTML") |
| Naming a concrete server route or method in client code or comments (`POST /queue/save-html`, "303s to `/queue`") | The client reads `href`/`method` from the response; a route baked into a comment rots and reintroduces the URL coupling the contract removes |
| Asserting a specific server response body/URL/shape in a client test | A client test should exercise generic protocol handling — follow whatever action/link the response carries — not pin the server's current URLs or shapes |
| Gating controls behind per-capability boolean flags (`canSaveURL`/`canMarkRead`/`canDelete` consulted in an `if`) or otherwise conditionally loading controls by hardcoded action name | The boolean hardcodes which affordances exist, so a newly-added server affordance never renders without a client change; iterate the response's `actions`/`links` and render one control each instead |
| Using a server `name`/`rel` string verbatim as a CSS class, or letting the server send style/class | Presentation is 100% client-side; the client maps `name`/`rel` to its own design tokens. A server-string class couples styling to wire vocabulary and breaks on a rename |
| An inline `name === "delete"` (or any per-name) branch to pick a style/icon | The same smell as the gated booleans — it hardcodes one affordance's presentation; route style AND icon/glyph through the single name/rel→token mapping with a default |
| Rendering structural navigation rels (`self`/`next`/`prev`/`root`/`item`) as tappable controls | These are the client's own navigation (pagination/identity/item resolution), not user affordances; follow them for navigation and render controls only for actions and semantic links |
| Hardcoding a field's value in a client invocation (`body: { status: "read" }`) | The value rides the field's `value` from the server; the generic invoker posts it encoded per `type`. A client-baked value goes stale on a server change and defeats the bare `(id, name)` invocation |

## Client Conformance

These rules make any client (extension, iOS, MCP, future) behave like a browser over the contract above — "the app is a browser, Siren is HTML." Each prevents a real cross-client failure mode.

| Rule | Why |
|---|---|
| Render one control (button, swipe, menu item, tap target) **per advertised affordance** by **iterating** the current response's `actions` and `links` — one control each. Never gate a control behind a per-capability boolean (`canSaveURL`/`canMarkRead`/`canDelete`) or any "does the client know action X" `if`. | A boolean hardcodes which affordances exist, so a newly-added server affordance never renders without a client change; the loop renders whatever the server offered, and an absent action simply produces no control (no phantom affordance — the worst HATEOAS failure mode). |
| Label a control from the affordance's Siren `title` (the same string doubles as `aria-label`/tooltip). Derive **all presentation** — style AND icon/glyph AND placement — client-side through **one** mapping of action `name` / link `rel` to the client's own design tokens, with a default for an unknown name/rel. Never branch on a single name (`name === "delete"`) to choose presentation. | The server owns the protocol, not the look. A server string used verbatim as a CSS class couples styling to wire vocabulary and breaks on a rename; a per-name presentation branch is the gated-boolean smell in disguise. One mapping keeps presentation a pure client concern and an unknown affordance still renders (default style) instead of vanishing. |
| Treat structural navigation rels (`self`/`root`/`prev`/`next`/`item`) as the client's **own** navigation (pagination/identity/item resolution) — follow them, never render them as user controls. Render controls for actions and for semantic (non-structural) links the client understands. | A structural rel is how the server steers the client's paging and identity, not a thing the user taps; rendering `next` as a button turns plumbing into a phantom affordance and double-handles paging. |
| Navigate by the server-supplied link (`rel`), not by a domain property. | Opening a raw `url` property instead of following the `read` link discards the server's chosen destination; if the server re-points the link, the client never follows it. |
| Resolve every href through one helper: use an `http(s)://` href verbatim, resolve a scheme-less href against the base, treat any other scheme as no href (unactionable). | Per-call-site `base + href` concatenation corrupts an absolute href and mis-resolves other schemes — yet the Evolvability table promises changing an `href` is non-breaking. |
| Verify the response `Content-Type` is the negotiated media type before parsing; render a standard "unsupported media type" view for anything else. | Negotiating with `Accept` but blind-decoding any 200 body turns a proxy HTML page or a future media type into an opaque "couldn't read the response" instead of an honest "I don't understand this type." The message-content gate already does this — apply it to the response envelope too. |
| Parse leniently: one malformed link/action must degrade to unactionable, never fail the whole response decode. | An atomic decode that rejects a single odd control blanks the entire page — extend the same tolerance the entity `properties` already get. (Note: Siren requires `href` on links/actions, so a hrefless control is a malformed control, not a valid one.) |
| Drive search, filter, sort, and pagination from the server's `fields` and links — never client-built params or client-side re-paging. | Hardcoding `?page=` or re-paginating one fetched page client-side hides items past the first page and breaks when the server changes paging; hardcoding a filter field name breaks on a rename. |
| Don't duplicate server policy (size caps, validation thresholds) in the client; attempt the action and follow the server's fallback/refusal. | A client copy of a server constant goes stale on a server change and mis-routes; the server already advertises the fallback action to follow. |
| Bind a response's actions through one generic path that posts each declared field's server-provided `value`, encoded per the action's `type` (urlencoded → form body, json → JSON body). Don't cherry-pick named affordances into per-operation code with hardcoded shapes or hardcoded field values. | The invocation values come from the server (the field `value`), so a bare `(id, name)` invocation suffices; per-operation bespoke handling or a client-baked value means each new server capability needs new client code and goes stale on a server change. |

## Per-Client Implementations

Every client interprets the same Siren contract above; only the mechanics differ. The contract is shared; the notes below are client-specific.

### Accepted client-shape differences

A client surfaces the affordances relevant to **its** UX and may present them differently — clients are not required to render identical control sets. For example, the browser extension's save is current-tab-capture-driven (it does not render the collection's save actions as a toolbar), while the iOS app has a manual collection toolbar. This is allowed **provided** each client renders whatever it does surface by **looping advertised affordances** (`actions` + semantic `links`) — never per-capability booleans, never hardcoded action-name conditionals — and never hardcodes URLs/methods. The contract mandates the discovery+loop discipline, not an identical control set across clients.

### Browser extension (the walker pattern)

The browser-extension client separates three concerns:

1. **Understandings** (`init*Understanding` functions) — one handler per action name the client knows how to invoke. Each handler receives the Siren action descriptor and a context, returns a bound callable.
2. **Composition** — `groupOf(...)` merges multiple understandings; `httpCacheable(...)` wraps them with ETag caching.
3. **Walker** — `initExtension(handlers, deps)` returns a no-arg function that fetches the entry point, resolves the `self` link, and parses collections into `{items, actions}` where every item has its own action map.

For the full flow see the source — it is the spec: [projects/browser-extension-core/src/reading-list/siren-reading-list.ts](../../../projects/browser-extension-core/src/reading-list/siren-reading-list.ts). The adapter `initSirenReadingList` exists only to bridge this walker to the legacy `SaveUrl`/`RemoveUrl`/`FindByUrl`/`GetAllItems` interface that the popup consumes. New consumers should call the walker directly.

When adding a capability the extension supports: add an `init*Understanding` keyed by the action name, compose it via `groupOf(...)`, wrap with `httpCacheable(...)` for cacheable GETs, and drive the walker directly rather than adding a method to `initSirenReadingList`.

### MCP: the same doctrine over a different transport

Readplace also exposes its domain over MCP (Model Context Protocol) at `/mcp`; the external AI assistant is the client. MCP shares this skill's core stance — **the server owns the protocol; the client hardcodes one connection and discovers everything else** — so the Client Conformance rules apply to an MCP client too. It diverges in transport and statefulness, so the mapping is partial, not 1:1.

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

In this repo, hutch is the MCP **server**: the tool set is the single source of truth in `tool-definitions.ts` (`TOOL_DEFINITIONS`), advertised via `tools/list` in `mcp-server.ts`, with no client copy to drift. The WebMCP surface (`webmcp.client.ts`) is a **provider** that registers one local `save_link` tool for an in-browser agent — a provider declares its own shape, so discover-don't-hardcode does not apply to it. Spec: [modelcontextprotocol.io](https://modelcontextprotocol.io).

## Checklist — Adding a New Capability to the API

1. **Name the action as a capability**, not a domain fact. Check the Evolvability table before picking a name.
2. **Emit the capability on the server** — Siren: an action in `collection-siren.ts` (collection-level) or `article-siren.ts` (entity-level), with its `fields` declared as Siren field types; MCP: a tool in `tool-definitions.ts`, with its `inputSchema`.
3. **Implement the route handler** behind `wantsSiren(req)`; return `303` for mutations that should land the client back on a collection.
4. **Add a handler for the action name on each client** that should expose the capability — see [Per-Client Implementations](#per-client-implementations).
5. **Test server and client independently** — server integration tests, plus each client's own tests. The contract surface (action name + fields + method + response class) is what both sides pin down.
