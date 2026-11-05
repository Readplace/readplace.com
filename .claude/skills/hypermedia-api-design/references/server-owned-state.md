## State Lives in the Network

HTTP caching (`ETag` + `If-None-Match`) is the authoritative cache layer. Do not build a parallel in-client cache of "what articles exist" as the source of truth. A client may keep a short-lived cache of *bound actions* (items the server returned with their `update-status` action attached) as a performance optimisation, but the canonical state is always whatever the server returns next.

- Cache wrapper: the HTTP-cache decorator around an understanding, exported by the extension core's Siren walker module (the extension core is the shared package both extensions consume — `pnpm nx show projects` lists it; the walker module is anchored under [Browser extension](client-conformance.md#browser-extension-the-walker-pattern))
- Short-lived action cache: the legacy reading-list adapter's map of known items (cleared on every mutation — the walker module's one `.clear()`)

**Discovery freshness is server-defined.** The responses a client reads only to *discover* affordances — the entry-point `303` and the collection `GET` behind it — carry an explicit cache policy, so a warm client invokes an action it already holds without spending a re-discovery round trip first. The lifetime is granted per client: the collection's `max-age` goes only to the native iOS and Android apps, and every other Siren client is held to `private, no-cache` revalidation, because entity mutations post to per-article URIs and would never auto-invalidate a cached collection on already-shipped clients. Only the server knows how long its own action vocabulary stays valid, so the client honours ordinary HTTP caching and never invents a TTL: the server's discovery-lifetime constant — in the one non-test server module that both builds a `private, max-age=` directive and varies the collection on `Authorization`; grep the server for files containing both strings — is the only place that lifetime is set. The two mechanisms are not interchangeable: `max-age` is what removes the warm round trip (the client answers from its own store), while `ETag`/`304` still costs a request and only cheapens revalidation when the body is unchanged — rare for a collection, which any save changes.

After a mutation, the server drives the client back to the collection via `303 See Other`. `fetch` follows the redirect automatically; the client parses the new collection and that becomes the new truth. Do not synthesise "the new list after delete" client-side — read it from the response.

## Form Fields Are Declared, Not Assumed

The server declares what an action needs via `action.fields`, and **the input VALUES come from the server too** — each field may carry a `value` (the server-suggested/target value). The generic invoker builds the request body by posting each declared field's `value`, ENCODED per the action's `type` (`application/x-www-form-urlencoded` → `URLSearchParams`; `application/json` → JSON). A bare `(id, name)` / `(entity, action)` invocation is therefore sufficient: the client supplies no field knowledge and never hardcodes a field value.

A field-requiring action whose field carries no server-provided `value` is **not invokable by a bare control** — only a bespoke handler that produces that value (e.g. a search box's typed query) can invoke it.

**A field name enters the contract exactly when a client must author its value.** A server-valued field is copied `name`→`value` by the generic invoker, so renaming it is invisible to every client. A field only a bespoke handler can fill has its name hardcoded in that handler, so renaming it is breaking — and breaking *silently*, because the handler's callable looks each declared field up by name in the values it was given: a renamed field stops matching and the request goes out **without** that input instead of failing. A field that is neither — no server `value`, no handler — is inert, and removing it breaks nothing.

A query parameter the server bakes into an `href` (`?order=asc` in `self`/`next`/`pages[].href`) is **not** a field and is not contract. The client treats the href as opaque and never parses it, which is exactly what keeps "change an action's `href`" non-breaking.

When adding a new required input to an action:

1. Server: add a new entry to `fields` (carrying its `value` when the value is server-known) and validate it in the route handler.
2. Client: nothing for server-valued fields — the generic invoker already posts the declared `value`. Only an input the *user* must supply needs a bespoke handler.

When adding an optional input, only the server changes; old clients keep working.

## Server-Driven Messages Are Trusted HTML

The server can refuse or annotate an action with a generic, feature-agnostic message channel instead of a bespoke error code. The shape is a stable published interface:

```jsonc
"properties": {
  "messages": [
    { "type": "success" | "warning" | "error",
      "content": { "type": "text/html", "body": "…server-authored HTML…" } }
  ]
}
```

The client owns **no** knowledge of what a message means — it only knows how to render one. The web/extension clients inject `content.body` as HTML (so an `<a href="mailto:…">` renders); iOS strips it to plain text. A locked-account save refusal is the first producer (the server's locked-account refusal builder — the one Siren emitter that interpolates a `mailto:` address into its body; grep the server for `mailto:${` and take the non-test hit that builds a Siren message, not the report-article link builder), but the channel is deliberately generic so any future "show the user this, let them keep reading, but block the save" interceptor reuses it rather than adding another bespoke surface.

**The client renders only media types it understands.** `content.type` is the body's media type. Every client renders exactly one — `text/html` — and **ignores any other media type**: an unrecognised `content.type` is dropped, never displayed, never injected. Be liberal in what you accept (the envelope parses regardless of `content.type`, so a refusal carrying an unknown type still drops the user back into the list rather than failing generically) and conservative in what you render (only the media types the client knows). This makes a new media type a forward-compatible change — older clients skip a body they can't interpret instead of mis-rendering it. The extension filters in the extension core's message-view builder (the pure module that also picks the live-region `role` — grep the extension core for `"alert" : "status"`); iOS filters in its API client's refusal decoder (the step that runs right after the `401` check — grep the iOS Swift sources for `status == 401` — which keeps only renderable messages and still treats a refusal left with none as a refusal, so the app shows its own words instead of a generic failure).

**Invariant — `content.body` is trusted, server-authored, server-side-escaped HTML.** The server is the *only* author. Because the extension renders it via `innerHTML`, a body that interpolates any untrusted or user-derived value — a saved URL, an article title, an email address — **without escaping it server-side** is markup injection into the popup. This is safe today only because the single producer builds from a static constant. Before a message body ever interpolates dynamic data:

1. Escape it server-side. The body is HTML; treat every interpolation as untrusted until escaped.
2. Only `text/html` bodies are ever injected — the client ignores any other `content.type` (see "The client renders only media types it understands" above), so an unknown media type can never be mis-rendered as HTML. A `text/html` body, by contrast, is *always* injected, so the escaping in (1) is mandatory for it.
3. Never move escaping to the client — the server owns the protocol, and "the client only renders" is what stops every client (extension, iOS, Android, future) re-implementing sanitisation differently.

The client-side render decisions (per-`type` variant class, the `role` politeness, empty/hidden, and which media types are renderable) live in the extension core's message-view builder (anchored above) — pure and unit-tested; the popup glue only paints its output.

## Pagination Is Server-Owned — `properties.pages`

Page size is **server policy, not a client parameter.** No client sends a page size and no client re-pages what it received: a client renders exactly the items one response carried. The server may pick a different size per client (it knows which client from the OAuth token the request carries), so "how many items is a page" is never derivable client-side.

Sequential paging keeps the registered rels — `prev` and `next` (RFC 8288) — which a client **follows** as structural navigation, never renders as a control. But IANA registers nothing for numbered/arbitrary page access, so a numbered pager is custom vocabulary in any encoding. It cannot ride links or actions here: a *titled* affordance is this contract's "render me as a control" signal, so N titled page links become N mystery controls on every already-shipped client, and a *title-less* link has nowhere legal to carry the human label. It therefore rides collection `properties`, where an unknown key is inert on every shipped client:

```jsonc
"properties": {
  "pages": [
    { "label": "1", "rel": "prev",    "href": "/queue?status=unread&page=1" },
    { "label": "2", "rel": "current", "href": "/queue?status=unread&page=2" },
    { "label": "3", "rel": "next",    "href": "/queue?status=unread&page=3" }
  ]
}
```

This is a **published interface**: `pages`, `label`, `rel`, and `href` are the contract, and renaming any of them is a breaking change.

- **Pages only, never their contents.** An entry describes a page; a page's articles arrive only when the client follows that entry's `href`. Adding items to an entry would make every response carry the whole collection.
- **`rel` is relative to the page that carried it** — every page before the current one is `prev`, every page after is `next`, the current one is `current`. These are the registered relation names (RFC 8288) applied to pages rather than to Siren `links`, so an entry says how a page relates to the one in hand. Relations repeat, and a response for an out-of-range page carries no `current` at all.
- **`label` is the server's display string.** A client renders it verbatim and never parses it, derives it from array position, or reads a page number out of an `href` — that is what keeps the server free to change page identity or elide entries later.
- **`href` is opaque and server-built**, resolved through the client's one href resolver like any other. A client that builds `?page=` itself has reintroduced the coupling this removes.
- **Which entries to display is client presentation.** The server sends the full list; windowing it (a few around the current page, plus the first and last) is the client's own layout decision, and `rel` is never used as a CSS class.

## Infinite Scroll Is Stitched Pages — Re-read and Adopt After a Mutation

A list that grew by following `next` is the client's own concatenation of several responses; the server never emitted it and cannot update it. After **any** mutation the client learns of — one it invoked, or one another surface reports (an in-app reader's bridge, a share-sheet save) — the stitched list is stale and only the server's post-mutation collection is the truth.

| Rule | Why |
|---|---|
| Re-read **and adopt** at every scroll depth: replace the stitched list with the post-mutation first page, or re-follow the collection from its first page through the *fresh* responses' `next` links, one hop per page held, and replace the list with what came back. | A read whose body is then discarded is the same failure as no read: the row the user just acted on stays on screen. Choosing between the two is presentation (viewport reset vs held position); doing neither is a correctness bug. |
| Scroll depth chooses *how* the client re-reads, never *whether* the collection is applied. | A "has paginated" flag that gates adoption turns a viewport nicety into a hole that opens only past page 1 — where no test looked. |
| Never patch the stitched list by id instead. | It is the synthesise-after-mutation anti-pattern, and the id the client holds may be wrong: an in-app reader can navigate to another article before the mutation lands. |
| Page boundaries move after a removal; render exactly what each re-followed response carried. | A row from page N+1 joining page N is the server's paging, not a client reconciliation problem. |

The rule exists because the iOS reader's mark-read fetched the tab's collection and then discarded it whenever the list was past page 1, so the row just read stayed until a pull-to-refresh.

## Status Tabs Are Server-Owned — `properties.tabs`

The queue is partitioned by status into tabs — today *To Read* and *Read* — and the tab set, each tab's label, and where each tab lives are **server policy**. A rename or a new tab reaches every client without a release only if no client holds that list itself. The same reasoning as `pages` rules out links and actions as the vehicle (a titled affordance phantom-renders as a control on every shipped build; a title-less one has nowhere to carry the label), so tabs ride collection `properties`, where an unknown key is inert on every shipped client:

```jsonc
"properties": {
  "tabs": [
    { "label": "To Read", "rel": "tab",     "href": "/queue?status=unread" },
    { "label": "Read",    "rel": "current", "href": "/queue?status=read" }
  ]
}
```

This is a **published interface**: `tabs`, `label`, `rel`, and `href` are the contract, and renaming any of them is a breaking change. Entries carry no counts; the listed tab's count rides `total` (see [Count and Sort](#count-and-sort-are-server-owned--propertiestotal-and-propertiessort)).

- **`rel` is `current` for the tab the response lists and `tab` for every other.** A collection that is not filtered by status (the invalid-URL save refusal lists every status) carries no `current` entry at all — the same rule as an out-of-range page in `pages` — and a client keeps whatever tab it had selected.
- **`label` is the server's display string**, rendered verbatim and never parsed.
- **`href` is opaque and server-built** — resolved through the client's one href resolver, never assembled from a status the client knows. The server carries the request's sort order into each tab's href; a client that builds `?status=` itself has reintroduced the coupling this removes.
- **A tab's contents arrive only by following its `href`.** An entry describes a tab, not its items.
- **Entity mutation hrefs carry the tab.** Each embedded item's `update-status` `href` is built with the collection's own status (and order) baked in, so the `303` the mutation answers with lands the client back on the tab it acted from — a client stays on *Read* after toggling an item unread there, without ever knowing how the server encodes a tab. The href is opaque, so this is non-breaking for every shipped client; the save response's entity (no collection context) keeps the bare href.
- **Presentation is the client's.** A segmented control, a tab bar, or a menu is a layout decision; `rel` is never used as a style token.

## Readlists Are Server-Owned — `properties.readlists`

A reader's queue is partitioned again, into readlists: the default one every account has, plus the ones the reader created. Which readlists exist, what each is called, and where each one lives are **server policy**, for the same reason as `pages` and `tabs` — so they ride collection `properties`, where an unknown key is inert on every shipped client:

```jsonc
"properties": {
  "readlists": [
    { "label": "All",  "rel": "current",  "href": "/queue" },
    { "label": "Work", "rel": "readlist", "href": "/queue?readlist=3f9a…" }
  ]
}
```

This is a **published interface**: `readlists`, `label`, `rel`, and `href` are the contract, and renaming any of them is a breaking change. The default readlist comes first, then the reader's own in the order they were created; entries carry no counts.

- **`rel` is `current` for the readlist the response lists and `readlist` for every other**, and **exactly one** entry is `current`. A request naming a readlist the reader does not own is answered by the default readlist's collection, so a current entry is always there to point at — unlike `pages` and `tabs`, which can legitimately carry none.
- **`label` is the server's display string**, rendered verbatim and never parsed. It is text the reader typed, so wherever it reaches server-authored HTML copy the server escapes it; a client never escapes or unescapes it itself.
- **`href` is opaque and server-built** — an entry's href is that readlist's default view, carrying no tab, order, or page. A client follows the href it was given, never assembles `?readlist=`, and never stores, parses, or compares the slug or label inside one. An iPhone build before 134 is the one client still served `?queue=` on every href, and a `GET` from it that names `?queue=` is answered in place; every other Siren client that names `?queue=` gets a `303` to the same listing under `?readlist=`.
- **The addressed readlist rides every href the collection builds** — `self`, `prev`, `next`, every `pages`, `tabs` and `sort` entry, each item's `read` link and `update-status` href, the collection's `save-article` href, and the `collection` link on a save response. A client therefore holds **one** pointer, the href it last followed, and stays inside a readlist across paging, tab switches and mutations without knowing how a readlist is encoded. The default readlist adds nothing to a query, so a bare collection URL and one naming the default are the same representation — which is what keeps this additive for clients that never learned about readlists.
- **A save lands in every readlist it named**, as well as in the reader's whole queue. A save names a readlist two ways, and the server files into the union of both: the readlist whose collection the save action came from, carried in the action's own href; and the readlists listed in the save action's `readlists` field, whose values are `properties.readlists` entry hrefs echoed back as the server advertised them — the client composes none of them, exactly as it echoes a pagination cursor. The field is how one save reaches several readlists in one round trip; a client that sends none behaves as though it named only what the href did.
- **The confirmation names every readlist the save landed in** — `Saved to '<label>'`, `Saved to '<label>' and '<label>'`, and so on — whenever the reader keeps more than one readlist. A reader with only the default one keeps the unqualified copy. The wording is server-authored like every other message, so no client composes it and no client decides where a save went.
- **Some affordances are deliberately readlist-agnostic**: `root`, `account`, `add-links-help`, `create-session`, `create-readlist`, `save-articles`, `save-content`, and `search`. A GET action's fields *replace* the href's query when a client submits it, so a readlist baked into `search` would vanish on submit. A readlist field is only ever additive and only ever client-authored: a shipped client posts the fields it already knows and simply omits it, which is why the href remains the way a single readlist is addressed.
- **Presentation is the client's.** A menu, a sidebar, or a segmented control is a layout decision; `rel` is never used as a style token.

**Readlist management is title-less actions.** A client invokes each one by name and authors only the field the table names; the action carries everything else. None carries a `title`, so a client that does not handle one shows nothing for it (the **Label** rule in [Rendering & Invoking Affordances](client-rendering.md#rendering--invoking-affordances)). A success answers `303 See Other` to the collection to read next, which the client follows instead of building it. A refusal answers with a Siren `error` entity and changes nothing: `code` says why, and `message` is server-authored copy that carries no reader data. `create-readlist`, `rename-readlist`, `delete-readlist` and `add-to-readlist` share the save's account gates: a locked account's `403` and an inactive subscription's `402` carry no `code`, and their copy rides the [message channel](#server-driven-messages-are-trusted-html).

| Action | Advertised on | Field the client authors | `303` lands on | Refusal `code` (status) |
|---|---|---|---|---|
| `create-readlist` | every collection | `label` | the new readlist's collection; the server mints the readlist's address, so the `Location` is where a client learns it | `invalid-name`, `reserved-name`, `name-taken`, `limit-reached` (`422`) |
| `rename-readlist` | the collection of a readlist the reader created | `label` | the renamed readlist's collection | `unknown-readlist` (`404`); `invalid-name`, `name-taken` (`422`). A label another readlist carries is numbered instead, and refused only when the numbered label would be too long |
| `delete-readlist` | the collection of a readlist the reader created | none | the default readlist's collection | `unknown-readlist` (`404`) |
| `add-to-readlist` | every article entity, including the one a save answers with, except the rows of a collection sent to the Firefox extension ([why](markdown-read-link.md#an-articles-markdown-is-its-read-link-negotiated)) | `readlists` | the collection its href was built for | `unknown-readlist` when `readlists` names none of the reader's own readlists, `unknown-article` when the readlist its href addresses no longer holds the article (`404`) |
| `remove-from-readlist` | an article entity listed in a readlist the reader created | none | the same readlist and tab, on its first page | `unknown-readlist`, and `unknown-article`, which a second removal of the same article also gets (`404`) |

The `add-to-readlist` and `remove-from-readlist` hrefs carry the addressed readlist, tab and order the way the `update-status` href does, so a client acting inside a readlist lands back where it acted without knowing how a readlist is encoded. `add-to-readlist` fills its `readlists` field the way `save-article` fills its own, with entry hrefs echoed from `properties.readlists`, and filing an article where it already is succeeds. Removing an article takes it out of that one readlist and leaves the reader's whole queue as it was.

## Count and Sort Are Server-Owned — `properties.total` and `properties.sort`

A collection filtered by status says how many articles the listed tab holds and which orders it can be read in. The count's wording and the order names are server policy, like `tabs`, so they ride collection `properties`, where an unknown key is inert on every shipped client:

```jsonc
"properties": {
  "total": { "label": "4 Saved Articles" },
  "sort": [
    { "label": "Newest first", "rel": "current", "order": "desc", "href": "/queue?status=unread&order=desc" },
    { "label": "Oldest first", "rel": "sort",    "order": "asc",  "href": "/queue?status=unread&order=asc" }
  ]
}
```

This is a **published interface**: `total`, `sort`, `label`, `rel`, `order` and `href` are the contract, and renaming any of them is a breaking change.

- **`label` is a display string**, rendered verbatim and never parsed: a client never reads a number out of the count.
- **`order` is a vocabulary token** a client maps to its own glyph; a client skips an entry whose token it does not know, as it skips a malformed one.
- **`href` is opaque and server-built.** It carries the readlist, the status and the order but no page and no `url` filter, so following it lands on the first page of the same readlist and tab.
- **Exactly one entry is `current`**, the order the response lists; every other entry is `sort`.
- **A client asks for a sort by position across the popup–background boundary.** The extension's popup never holds an href: it names the entry by its index in the list it was shown, as it does for `pages`, and the background follows the href it kept.
- **A collection not filtered by status carries neither `total` nor `sort`** (the invalid-URL save refusal lists every status), so a client hides its count and sort until the next listing.
- **Presentation is the client's.** A toggle, a menu or a segmented control is a layout decision; `rel` and `order` are never used as style tokens.

## Processing Is Server-Owned — `properties.processing`

Saving starts background work, and whether an item is still in flight, what to call it, how long is left and when to look again are server policy. The web card and a native row must show the same numbers, so the arithmetic stays on the server. It rides article `properties` rather than a link: a key is inert on every shipped build, while a link would phantom-render on a build that predates the title rule in [Rendering & Invoking Affordances](client-rendering.md#rendering--invoking-affordances).

```jsonc
"properties": {
  "processing": {
    "label": "Processing",
    "estimate": { "kind": "counting", "seconds": 121 },
    "refresh": { "href": "/queue/abc/card?status=unread&poll=2", "afterSeconds": 3 }
  }
}
```

This is a **published interface**: `processing`, `label`, `estimate`, `kind`, `seconds`, `revealInSeconds`, `refresh`, `href` and `afterSeconds` are the contract, and renaming any of them is a breaking change. The key is present on an article entity exactly while the web card for that article polls.

| Key | Rule | Why |
|---|---|---|
| `label` | Rendered verbatim, never parsed | It changes by item kind ("Preparing your book…") |
| `estimate` | Optional. `quiet` shows nothing until `revealInSeconds` have passed, then counts down from `seconds`; `counting` counts down from `seconds`; `almost-there` has no number. A client ticks it once per second between answers, shows `~N s left`, and shows `Almost there…` at zero. An unknown `kind` means no estimate | The per-second tick must be on the client, as it is in the browser; the formula and its constants are not, and each answer replaces the client's count |
| `refresh.href` | Opaque; resolved through the one href resolver | It carries the poll cursor and the tab, so the answer's actions land back on the tab the row came from |
| `refresh.afterSeconds` | How long to wait before following `href` | The cadence is a server constant rather than a number in two app binaries |

- **Following `href` answers a top-level `article` entity** on the same URL the web card polls, by content negotiation. A client replaces the row with it, as `hx-swap="outerHTML"` replaces the card, and ignores an answer whose `id` is not the row's.
- **No `processing` on an answer means stop.** The work settled, or the server's poll budget ran out. Past the budget the entity carries a `messages` warning instead; an upload failure is a `messages` warning too. Both follow [Server-Driven Messages Are Trusted HTML](#server-driven-messages-are-trusted-html).
- **A save's own `messages` stay the save confirmation**, so a just-saved item never shows a warning in place of "Article saved".
- **The answer is `Cache-Control: private, no-cache`**, unlike the collection's discovery freshness, because a stale answer would freeze the countdown. The `href` changes on every answer, so a client that keeps a cache still fetches each one.
- **Polling stops when the client leaves the foreground** and restarts from the rows' current hrefs when it returns. A collection read issues new hrefs, so the cursor restarts there, as a browser reload restarts it.
- **Presentation is the client's.** A spinner, a line of text or a bar is a layout decision.
