---
name: hypermedia-api-design
description: Hypermedia contract between the Readplace server and every client that consumes it — the chrome and firefox extensions, the iOS and Android apps, the MCP server, and future clients. Use when adding, renaming, or removing an API capability a client consumes, when the server emits or parses Siren responses, or when any client's navigation/action flow changes.
---

# Client ↔ Server Hypermedia API Design

Clients talk to the server over a Siren (`application/vnd.siren+json`) hypermedia API; the same URLs serve browsers (`text/html`) via content negotiation. This doctrine governs **every** client surface — the chrome and firefox extensions, the iOS and Android apps, the MCP server, and any future client — so a server-side view change never forces a client redeploy. The contract is **the message format plus a stable vocabulary of action names** — not a catalogue of URLs, methods, or request shapes.

## Core Principle: The Server Owns the Protocol

A client knows exactly one URL: the entry point (`/`). From there, the server tells the client:
- Where to navigate next (`links[rel=self]`)
- What actions are possible (`actions[].name`, `.href`, `.method`, `.fields`)
- How items relate (`entities[].rel`, entity-level actions/links)

The client's job is to interpret the Siren format and follow what the server says — not to construct URLs or hard-code HTTP methods.

### References
- Server Siren types: the server module that declares the shared entity/action/link/message shapes and exports the media-type constant — grep the server for `application/vnd.siren+json`; the hit that exports it as a constant is this module
- Collection emission: the server module that assembles the collection entity — the one that stamps it with `class` `collection`/`articles` and fills `properties.pages` and `properties.tabs`; grep the server for `"collection", "articles"` — the non-test hit
- Entity emission: the server module that builds an article sub-entity with its `update-status` action — the only non-test server hit for `"update-status"`
- Status tab list: the builder that turns the status set into `tabs` entries, choosing `rel` `current` or `tab` — grep the server for `"current" : "tab"`
- Readlist list: the builder that turns the reader's readlists into `readlists` entries, choosing `rel` `current` or `readlist` — grep the server for `"current" : "readlist"`
- Sort list: the builder that turns the sort orders into `sort` entries, choosing `rel` `current` or `sort` — grep the server for `"current" : "sort"`
- Content negotiation: the Siren content-negotiation predicate — the one call to Express's `req.accepts(...)` made with the Siren media type; grep the server for `.accepts(`
- Client implementations: see [Per-Client Implementations](references/client-conformance.md#per-client-implementations)

## Content Negotiation, Not Parallel APIs

One URL per capability serves both the browser (HTML) and a programmatic client (Siren) based on `Accept`. Do not add a `/api/*` tree or version prefix — that creates two independent evolutions of the same concept.

- `GET /` with `Accept: application/vnd.siren+json` → `303 See Other` → `/queue` (the Siren entry point)
- `GET /` with `Accept: text/html` → home page
- Branch on the Siren content-negotiation predicate (see [References](#references)), then emit from the same domain data

Why 303 over the entry point: the server decides where the collection lives; renaming `/queue` to something else is a server-internal change because the client only followed the redirect.

[An Article's Markdown Is Its `read` Link, Negotiated](references/markdown-read-link.md) — read when changing how an article's Markdown is served or how a client reads it.

## What a Client Must Know vs Discover

| Must know (client code) | Must discover (from server response) |
|---|---|
| Entry point URL (`/`) | Resource URLs (`/queue`, `/queue/:id/status`) |
| Siren media type | HTTP methods |
| Action names it supports (`save-article`, `update-status`, `search`) | Field names and types per action |
| Field semantics for those names (`url`, `status`, `label`, `readlists`) | Pagination / sort / filter links (`next`, `prev`, `self`) |
| Link `rel`s it supports (`self`, `read`) | Entity URLs for reading or status changes |
| Markdown media type (`text/markdown`) and the frontmatter keys it reads, for a client that uses an article's Markdown | Where that Markdown lives: the article's `read` link `href` |
| The article's `processing` property and its keys, for a client that shows background work | Whether an item is in flight, its label and estimate, and where and when to fetch its next representation |

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
| Rename a field a client must author the value for (`search`'s `url`) | **Yes** | A bespoke handler hardcodes the name to supply the value, and the invoker, which looks each declared field up by name in the handler-supplied values, then misses **silently** — the request goes out without that input rather than erroring |
| Rename a field the server carries a `value` for (`update-status`'s `status`) | No | The generic invoker copies the declared `name`/`value` pair verbatim; no client ever knows the name |
| Remove a field with no server `value` that no client authors (`search`'s `order`) | No | Nothing can supply it — no `value` for the generic invoker, no bespoke handler — so no conforming client can reach it |
| Rename a property in `properties` that clients read | **Yes** | Treat known property names as the contract |
| Change an action's `method` | No | Client follows what the server declares |
| Change an action's `href` | No | Same reason, bounded by discovery freshness: a warm client may still hold the old `href` until its cached representation expires, and the re-discover-and-retry rule in [Client Conformance](references/client-conformance.md#client-conformance) closes that window |
| Change the URL structure of the site | No | As long as entry point and self-links stay consistent |

When a breaking change is necessary, add the new capability alongside the old one, wait for clients to migrate, then remove the old. Versioned URLs (`/v2/queue`) are banned — they are a symptom of an API that doesn't evolve via the message format.

[Server-owned state](references/server-owned-state.md) — read when a client keeps state, fills a form, shows a server message, or shows pagination, infinite scroll, status tabs, readlists, a count, a sort or an item's background processing.

## Entity-Level vs Collection-Level Actions

| Action scope | Where it lives | Example |
|---|---|---|
| Collection-level | `entity.actions` on the collection | `save-article`, `search`, `create-readlist`, `rename-readlist`, `delete-readlist` |
| Entity-level | `entities[].actions` | `update-status`, `add-to-readlist`, `remove-from-readlist` |

A client binds both levels: collection-level actions (e.g. `save-article`, `search`) and the per-entity actions on each item (e.g. `update-status`). Put an action at the level where it makes sense — "mark this article read" belongs on the article entity, not the collection. Readlist actions split the same way: a readlist's own create, rename and delete ride its collection, and filing or removing one article rides that article.

[Rendering & Invoking Affordances](references/client-rendering.md) — read when a client renders or invokes an affordance; it ends with the anti-patterns.

[Client Conformance](references/client-conformance.md) — read when building or changing a client; it ends with the per-client implementation notes.

## Checklist — Adding a New Capability to the API

1. **Name the action as a capability**, not a domain fact. Check the Evolvability table before picking a name.
2. **Emit the capability on the server** — Siren: an action in the collection emitter (collection-level) or the article-entity emitter (entity-level) — both anchored under [References](#references) — with its `fields` declared as Siren field types; MCP: a tool in the tool catalogue, with its `inputSchema`, following the [MCP skill](../mcp/SKILL.md).
3. **Implement the route handler** behind the Siren content-negotiation predicate; return `303` for mutations that should land the client back on a collection.
4. **Add a handler for the action name on each client** that should expose the capability — see [Per-Client Implementations](references/client-conformance.md#per-client-implementations).
5. **Test server and client independently** — server integration tests, plus each client's own tests. The contract surface (action name + fields + method + response class) is what both sides pin down.
