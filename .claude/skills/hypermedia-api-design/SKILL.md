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
| Entry point URL (`/`) | Resource URLs (`/queue`, `/queue/:id/delete`) |
| Siren media type | HTTP methods |
| Action names it supports (`save-article`, `delete`, `search`) | Field names and types per action |
| Field semantics for those names (`url`, `status`) | Pagination / sort / filter links (`next`, `prev`, `self`) |
| Link `rel`s it supports (`self`, `read`) | Entity URLs for reading or deletion |

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
| Add a new `action` | No | Clients without a handler skip it |
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

HTTP caching (`ETag` + `If-None-Match`) is the authoritative cache layer. Do not build a parallel in-client cache of "what articles exist" as the source of truth. A client may keep a short-lived cache of *bound actions* (items the server returned with their `delete` action attached) as a performance optimisation, but the canonical state is always whatever the server returns next.

- Cache wrapper: `httpCacheable(understanding)` in the browser extension's `siren-reading-list.ts`
- Short-lived action cache: `knownItems` in `initSirenReadingList` (cleared on every mutation)

After a mutation, the server drives the client back to the collection via `303 See Other`. `fetch` follows the redirect automatically; the client parses the new collection and that becomes the new truth. Do not synthesise "the new list after delete" client-side — read it from the response.

## Form Fields Are Declared, Not Assumed

The server declares what an action needs via `action.fields`. A client's handler for a given action asserts the fields it expects and builds the request body from them. When adding a new required input to an action:

1. Server: add a new entry to `fields` and validate it in the route handler.
2. Client: update the handler to assert/pass the new field. Old clients will fail loudly (the field is required server-side), which is correct — a client that can't provide required inputs should not silently succeed.

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
| Entity-level | `entities[].actions` | `delete` |

A client binds both levels: collection-level actions (e.g. `save-article`, `search`) and the per-entity actions on each item (e.g. `delete`). Put an action at the level where it makes sense — "delete this article" belongs on the article entity, not the collection.

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

## Per-Client Implementations

Every client interprets the same Siren contract above; only the mechanics differ. The contract is shared; the notes below are client-specific.

### Browser extension (the walker pattern)

The browser-extension client separates three concerns:

1. **Understandings** (`init*Understanding` functions) — one handler per action name the client knows how to invoke. Each handler receives the Siren action descriptor and a context, returns a bound callable.
2. **Composition** — `groupOf(...)` merges multiple understandings; `httpCacheable(...)` wraps them with ETag caching.
3. **Walker** — `initExtension(handlers, deps)` returns a no-arg function that fetches the entry point, resolves the `self` link, and parses collections into `{items, actions}` where every item has its own action map.

For the full flow see the source — it is the spec: [projects/browser-extension-core/src/reading-list/siren-reading-list.ts](../../../projects/browser-extension-core/src/reading-list/siren-reading-list.ts). The adapter `initSirenReadingList` exists only to bridge this walker to the legacy `SaveUrl`/`RemoveUrl`/`FindByUrl`/`GetAllItems` interface that the popup consumes. New consumers should call the walker directly.

When adding a capability the extension supports: add an `init*Understanding` keyed by the action name, compose it via `groupOf(...)`, wrap with `httpCacheable(...)` for cacheable GETs, and drive the walker directly rather than adding a method to `initSirenReadingList`.

## Checklist — Adding a New Capability to the API

1. **Name the action as a capability**, not a domain fact. Check the Evolvability table before picking a name.
2. **Emit the action on the server** in `collection-siren.ts` (collection-level) or `article-siren.ts` (entity-level). Declare its `fields` with Siren field types.
3. **Implement the route handler** behind `wantsSiren(req)`; return `303` for mutations that should land the client back on a collection.
4. **Add a handler for the action name on each client** that should expose the capability — see [Per-Client Implementations](#per-client-implementations).
5. **Test server and client independently** — server integration tests, plus each client's own tests. The contract surface (action name + fields + method + response class) is what both sides pin down.
