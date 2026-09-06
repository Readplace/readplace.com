---
name: web
description: Web adapter conventions for the application domain. Use when working with HTML templates, CSS styles, client-side JavaScript, or SSR patterns. Triggers on changes to .css, .html, .template.html, or .client.ts files.
---

# Web Adapter Guidelines

Conventions for building the web adapter layer that connects the application domain to browser clients.

## Component Pattern

Pages and components follow one composable component type, exported by the shared web shell package beside its SSR renderer (`pnpm nx show projects` lists the package). A page returns a page body; the project's base wrapper takes the page body plus per-request state (header, banner, auth) and produces the final component. Routes hand that component to the shell's response writer to write the response — the function that tries the component's `text/markdown` form when the `Accept` header asks for it and falls through to `text/html` when that form answers 406 (grep the web shell package for `!== 406`; the single hit is it).

### Don't DRY Trivial Composition

A wrapper that only chains two function calls is not worth extracting. Inline the composition at the call site — the indirection hides what the route returns and forces readers to open another file to learn nothing.

```typescript
// ❌ BAD — wrapper adds a name but no logic
export function renderPage(source: HeaderSource, body: Body): Page {
	return Shell(body, buildHeader(source));
}
writePage(req, res, renderPage(req, BookingPage(vm)));

// ✅ GOOD — composition is visible at the call site
writePage(req, res, Shell(BookingPage(vm), buildHeader(req)));
```

Extract a helper only when it owns real logic (branching, validation, transformation) — not when it just renames a chain.

### Iterate Lists, Don't Branch in Templates

When a region of the template renders a variable set of items (nav links, card actions, form fields, list rows), build a typed array in the view-model / page component and let the template iterate it with `{{#each items}}`. Do **not** scatter per-item conditionals across the markup. The branching belongs in TypeScript where it's testable in isolation and where the editor can verify the union of cases; the template's job is to render one item shape, once.

This applies even when the list has only 1–2 items today. The cost of the abstraction is a tiny typed item builder; the win is that adding, removing, or reordering items is one edit in one TypeScript function, not a search-and-replace across template branches.

```typescript
// ❌ BAD — booleans flow into the template, every variant grows another {{#if}}
return renderView(BOOKING_TEMPLATE, {
	canEdit,
	canDelete,
	isOwner,
});
```
```html
{{#if isOwner}}
<li><a href="/foo" data-test-segment-action="open">Open</a></li>
{{#if canEdit}}<li><a href="/foo/edit" data-test-segment-action="edit">Edit</a></li>{{/if}}
{{#if canDelete}}<li><form method="POST" action="/foo/delete"><button data-test-segment-action="delete">Delete</button></form></li>{{/if}}
{{else}}
<li><a href="/foo" data-test-segment-action="open">Open</a></li>
{{/if}}
```

```typescript
// ✅ GOOD — list is built in TS, template iterates one item shape
export function buildActions(input: {
	canEdit: boolean;
	canDelete: boolean;
	isOwner: boolean;
}): Action[] {
	const items: Action[] = [ACTION_OPEN];
	if (!input.isOwner) return items;
	if (input.canEdit) items.push(ACTION_EDIT);
	if (input.canDelete) items.push(ACTION_DELETE);
	return items;
}
```
```html
{{#each actions}}
<li>
  <form method="{{method}}" action="{{href}}">
    <button type="submit" data-test-segment-action="{{key}}">{{label}}</button>
  </form>
</li>
{{/each}}
```

#### Forms Everywhere — Don't Split Items Into `<a>` vs `<form>`

When some items are GET (link-like) and others are POST (mutations), do **not** add an `isLink: method === "GET"` discriminator and branch the template on it. Render every item the same way: `<form method="{{method}}" action="{{href}}"><button>{{label}}</button></form>`. A `method="GET"` form with no inputs navigates to the action URL on submit — the browser appends `?` and follows — so it behaves exactly like a link.

Why prefer this even though `<form>` is heavier markup than `<a>`:

- **One template shape, one styling target.** No `{{#if isLink}}` / `{{else}}` branch; one BEM class styles its `button` counterpart and that's it.
- **Adding a new variant is one item in the builder, not a new branch in the template.** Today's GET item becomes tomorrow's POST mutation without touching the template.
- **Excessive markup is not a performance issue at this scale.** A few extra `<form>` and `<button>` elements per page weigh nothing next to the page itself.
- **CSRF posture stays consistent.** Destructive mutations (POSTs) and read navigations (GETs) use the same wrapper, so it's harder to accidentally render a POST mutation as a click-only `<a>`.

The same rule applies to action lists, card actions, and any other repeated UI element with mixed methods. Reserve raw `<a href>` for the rare standalone link that doesn't fit the iteration (e.g., a single brand link in the header).

The header nav and the footer diverge on purpose, and that divergence is not a candidate for this unification. The header nav mixes a mutation (logout `POST`) with GET navigation, so every item renders as `<form method="{{method}}" action="{{href}}">` wrapping a `<button>` that carries the nav's link class, with UTM in hidden inputs. The footer is GET-only navigation, so each item is a raw `<a>` carrying the footer's link class under the standalone-link carve-out above, with UTM baked into the `href` by the tracking helper — the Handlebars helper that stamps `utm_source`/`utm_medium`/`utm_content` onto a literal href (the `registerHelper` call in the shared renderer that asserts its `source=` and `content=` named args before stamping the UTM params — the other registration is the icon helper; the nav and footer templates sit beside it in the web shell package).

- Do not turn the footer into forms: it adds a POST wrapper no mutation justifies.
- Do not collapse the nav to plain `<a>`: it drops the logout form and its CSRF posture along with the hidden-input UTM.

```html
<!-- ✅ GOOD — header nav: uniform form + button, UTM in hidden inputs -->
<form method="{{method}}" action="{{href}}">
  <input type="hidden" name="utm_source" value="{{source}}">
  <button type="submit" class="<nav-link-class>">{{label}}</button>
</form>

<!-- ✅ GOOD — footer: GET-only navigation as a standalone link, UTM via the tracking helper -->
<a class="<footer-link-class>" href="{{<tracking-helper> '/blog' source='footer' content='blog'}}">Blog</a>
```

Tests asserting on the list use positive assertions on the rendered keys (per [test-driven-design's "Never Rely on `querySelector(...).toBeNull()`"](../test-driven-design/SKILL.md)):

```typescript
const actions = Array.from(doc.querySelectorAll("[data-test-segment-action]")).map(
	(el) => el.getAttribute("data-test-segment-action"),
);
expect(actions).toEqual(["open"]); // non-owner sees only the open action
```

## Every CTA Carries Its Own UTM

There is no third-party analytics on this product. A click that carries no UTM is
a click that was never recorded — there is no other place to recover it from — so
every CTA pointing at our own origin is tagged at the point it is built.

**What must be tagged.** Every `<a href>` and every `<form action>` whose
destination is our own origin and whose purpose is to move a reader somewhere or
convert them: buttons, nav and tab links, card actions, empty-state links,
onboarding steps, email CTAs, and links to our own pages from body copy on a
marketing or legal page.

**The three params.** `utm_source` is the *section* the element lives in
(`header-nav`, `footer`, `queue-card`, `home-hero`, `onboarding`, …) —
kebab-case, and specific enough that two sections of the same page are told
apart. `utm_content` is the *element*, unique within that source and named for
what pressing it does (`install`, `see-inbox-address`, `new-readlist`), never for
where it happens to sit. `utm_medium` is fixed for in-site clicks and is stamped
for you. Reuse an existing source when a CTA genuinely belongs to that section —
`git grep` the non-test sources for `utm_source` to see the vocabulary in use.

**How to stamp it.** Never hand-write the query string. In a template use the
tracking Handlebars helper (the registration in the shared renderer that asserts
its `source=` and `content=` named args before stamping); in TypeScript call the
shared tagging function it wraps, exported by the same package that mints the
site chrome — grep the workspace packages' non-test sources for the literal
`utm_medium` value they both stamp, and the single module that defines it is the
one to import from. Both are idempotent and both leave a non-root-relative href
untouched.

**GET and POST need the params in different places**, and getting this wrong is
the failure that looks tracked and reports nothing:

| Element | Where the UTM must live | Why |
|---|---|---|
| `<a href>` | the href's query | the browser sends the href as-is |
| `<form method="POST">` | the **action's query** | its fields go in the request body, and the analytics middleware reads the query |
| `<form method="GET">` | **hidden inputs** | the submit *replaces* the action's query with the serialized fields |

A form that mixes both — an action query for POST plus hidden inputs for GET — is
correct and is what the site chrome's nav does, because one template shape serves
both methods.

**Deliberately untagged, in every case because our analytics cannot see the
click:** a destination on someone else's origin (an app store, a source
repository, a saved article's own URL) — tagging it leaks our params to another
site and records nothing; `mailto:` and `tel:`; a fragment-only href; a custom
scheme a native app intercepts; and the third-party HTML inside a saved article's
reader body. A CTA that a publisher pastes onto their own site is attributed by
its own surface marker instead, not by an in-site medium it did not come from.

A **link in a blog post's own prose is not exempt** — it is a click like any
other, and the whole reason to tag it is to learn which post sent the reader and
where they went. Its `utm_source` names the post, so no two posts share one, and
its `utm_content` names the destination: the page for a product link, the target
slug for a link to a sibling post, the cited host for a reader link. Both come
out of the markdown link itself, so a new post tags its links the same way
without a decision to make.

**This is enforced, not remembered.** Each deployable that serves pages has a
route test that renders its surfaces and asserts no same-origin CTA is missing
`utm_source` — grep the non-test sources for the shared checker's report helper
to find it and its callers. The blog's test enumerates every published post, so a
post shipping an untagged link fails the build. A new page belongs in that test's
path list. When it fails, it names the element and the destination: tag the CTA
rather than widening the skip list.

## Server-Side Rendering with Progressive Enhancement

This project uses an SSR-first approach. Core principles:

### URL as State

The URL query string represents the complete page state. All user interactions that modify state should be expressible as URL changes via HTML `<form>`.

Not every query parameter is state. Some only pick a representation — a feature toggle, a `swap=card` marker, a poll counter — and those are read where they are used, never parsed into the page's state type and never added to a shared link builder. A parameter in the builder rides every link the page emits, so it spreads across the codebase on the way in and has to be unpicked from every caller on the way out.

### View Model Pattern

Transform query string parameters into a structured view model before rendering. Templates should be "dumb" - they render what the view model provides without business logic.

### Progressive Enhancement

Build features in two steps:

**Step 1 — Semantic HTML first.** Every interaction must work as a standard HTML form submission or link navigation with no JavaScript. Use `<form method="POST">` for mutations and `<a href="...">` for navigation. This is the baseline that must always work.

**Step 2 — Add htmx for SPA performance.** Once the semantic HTML works, add `hx-boost="true"` to forms and link containers so htmx intercepts them as AJAX requests. Use `hx-target="main" hx-select="main" hx-swap="outerHTML show:none"` to swap only the `<main>` content without scrolling. The server returns the same full HTML response — htmx extracts just the `<main>` fragment.

```html
<!-- Step 1: Works without JS -->
<form method="POST" action="/items">
  <input type="text" name="title" required>
  <button type="submit">Create</button>
</form>

<!-- Step 2: Same form, boosted for SPA feel -->
<form method="POST" action="/items"
      hx-boost="true" hx-target="main" hx-select="main"
      hx-swap="outerHTML show:none">
  <input type="text" name="title" required>
  <button type="submit">Create</button>
</form>
```

No custom `*.client.ts` is needed when htmx covers the interaction. Reserve `*.client.ts` files for behaviour htmx cannot express (e.g., inline validation, animations).

IMPORTANT: Ask for human intervention whenever a deviation from htmx is needed away from this basic pattern for SPA navigation.

**Sanctioned deviation — card-scoped list mutations.** A mutation whose only visible effect is that one list row changes may swap the row instead of re-shipping the whole `<main>`, when re-rendering `<main>` is the measured cost. The queue's card mark-read/unread do this: the form targets the row (`hx-target` set to `closest` plus the card's block class, `hx-swap="outerHTML"`); a `swap=card` marker on the action href — a response-representation hint the server never trusts as state, consistent with the URL-as-state rule above — routes an htmx submit to a small card-removal fragment plus out-of-band toast/counts; and the **server**, never the client, decides when the DOM has drifted (page emptied, page beyond the last, the pagination controls changed, or the change didn't apply) and answers with the full listing via `HX-Retarget: main`. The no-JS, Undo, reader and API callers keep the byte-identical `<main>`/303 path, and delete keeps its full-`<main>` confirm-popover flow. This is already decided — follow it for equivalent list-row mutations instead of re-asking. See the queue page's card status-swap handler — the one that answers with the `HX-Retarget` header when the DOM has drifted (grep for `HX-Retarget` in the web pages of the project that serves `/queue` — the single hit there is it; the repo-wide second hit is the newsletter inbox's lock-check middleware) — and the mutation-fragments module it imports, which renders the card-removal fragment plus the out-of-band toast and counts.

### No Side Effects on GET

Never mutate state on a GET — proxies cache them, prefetchers fire them, crawlers hit them. For URLs that need to trigger a mutation (e.g., a share-able permalink), render a page with an auto-submitting `<form method="POST">`:

```html
<form method="POST" action="/items" data-submit-on-load>
  <input type="hidden" name="title" value="...">
</form>
```

Two pages already do this — grep the web pages for `querySelector('[data-auto-submit]')` and reuse that attribute and its inline script rather than inventing another.

Alternatively use the POST - Redirect - GET pattern.

### Anti-Patterns

| Avoid | Instead |
|-------|---------|
| Client-side state management (`let passengers = []`) | State in URL query string |
| Redundant JSON APIs for web UI | Use HTML responses |
| Hidden form fields for state | State in URL |
| JavaScript-only interactions with no HTML fallback | Semantic forms/links first, htmx second |

## CSS and Styling Conventions

### Core Rules

| Rule | Rationale |
|------|-----------|
| Test attributes are for tests only | Never use `data-test-*` in CSS selectors |
| Use semantic classes | Describe visual state (`.flight-segment--outbound`) |
| Use BEM for scoping | Prevent class collisions (`.flight-segment__label`) |
| Orphan/widow control lives on the prose container, not on `body` | A global `text-wrap` forces a full-page reflow |
| Fonts come from `var(--font-serif)` / `var(--font-sans)` | Never inline the `Georgia, "Times New Roman", serif` stack — one source of truth, the shared base-styles module that declares the `--font-serif` token (grep for the quoted `"--font-serif"` key — the token map is a TypeScript object, not a stylesheet), like colours |
| Buttons come from the shared button system | One button in the product — a per-page base class is how padding, radius, height, and hover direction drift apart |
| Icons are inline same-origin SVG, drawn by the icon Handlebars helper (the `registerHelper` call in the shared renderer that resolves a name against the shared icon set and returns a SafeString — the other registration is the UTM tracking helper) | Never an icon font, an icon CDN, an entity/Unicode glyph (`× → ✓ ▾`), or a CSS `content:` glyph. See [Icon Style](../../../BRAND_GUIDELINES.md#icon-style) |

A new page's `h1` and section `h2` must set `font-family: var(--font-serif)`, or
they ship in the body sans by inheritance. In-card sub-labels, eyebrows,
empty-state messages, and modal titles stay on `--font-sans` — the rule is
heading-*level*, not the tag. See [typography rules in the brand
guidelines](../../../BRAND_GUIDELINES.md#typography-rules).

```css
/* ❌ BAD */
[data-test-segment-type="outbound"] { ... }

/* ✅ GOOD */
.flight-segment--outbound { ... }
```

Add `text-wrap: pretty` to body-copy selectors and `text-wrap: balance` to
heading selectors — scoped to those selectors, never on `body`. Prefer the CSS
property over a manual `&nbsp;`/`<br>` so a later copy edit can't reintroduce the
orphan; reach for a manual break only when a specific shape (e.g. a centred
pyramid heading) demands it. See [orphan control in the brand
guidelines](../../../BRAND_GUIDELINES.md#typography-rules) for the exceptions
(keyword rotator; centred pyramid title uses `pretty`, not `balance`).

### Buttons Come From the Shared System

Every call to action uses the shared button base class plus one variant modifier, from the
button stylesheet that the shared base-styles module (the one whose token map holds the quoted `"--font-serif"` key) injects
into every page's `<head>`. A page stylesheet contributes layout only — `width`, `margin`,
grid/flex placement, `white-space`.

Do **not** define a per-page button base class (`.<page>-btn`, `.<page>__*-btn`) that
re-declares padding, radius, weight, fill, or hover. If a button needs something the shared
set cannot express, add a variant to the shared set. See the [button system in the brand
guidelines](../../../BRAND_GUIDELINES.md#buttons) for the variant taxonomy, the tier table,
and the single hover rule.

```css
/* ❌ BAD — a fourth copy of the same button, with its own radius and hover direction */
.checkout__pay-btn {
  padding: var(--button-padding);
  border-radius: var(--radius);
  background: var(--primary);
  color: var(--primary-foreground);
}
.checkout__pay-btn:hover { opacity: 0.9; }

/* ✅ GOOD — markup is class="<shared-button-classes> checkout__pay-btn" */
.checkout__pay-btn { width: 100%; }
```

### One Measure Per Page Column

All stacked sections in a page column share a single content measure (see [Layout Principles](../../../BRAND_GUIDELINES.md#layout-principles)):

```css
/* ❌ BAD — prose capped narrower than the full-width tab bar above it */
.booking { max-width: 800px; }
.booking__intro { max-width: 56ch; }

/* ✅ GOOD — the whole flow shares one measure */
.booking { max-width: var(--reader-max-width); }
.booking__intro { /* no per-section cap */ }
```

### Responsive Container Padding

Container padding starts at the `lg` 24px token and grows to 32–40px at `@media (min-width: 768px)` (see [Layout Principles](../../../BRAND_GUIDELINES.md#layout-principles)):

```css
/* ✅ GOOD — mobile-affordable base, generous on desktop */
.booking-card { padding: 24px; }
@media (min-width: 768px) {
  .booking-card { padding: 40px; }
}
```

### CSS Comment Index Format

Use numbered references for multi-line explanations:

```css
/**
 * 1. Use primary color for outbound
 */
.flight-segment--outbound { color: var(--primary); /* 1 */ }
```

### Reuse Tokens and Patterns — Don't Hand-Roll Per Element

Point a drifting element at the shared token or the existing house pattern rather than a bespoke per-element value. The recurring "AI-generated" tell is pieces that should read as one system each styled in isolation — a second link colour here, a hand-tuned control height there.

- **Inline body-copy links set `color: var(--primary-text)`.** There is no global bare-`<a>` reset, so an unstyled link renders browser-default blue — a styling gap, not a choice. One link token per page; emphasis inside a link is weight (`<strong>`), never a second hue. `--primary` is the fill token and is only 3.62:1 on white, below the 4.5:1 floor for text.
- **An input paired with a button shares the button's height.** Set `height: var(--input-height)` on the input and give the button the shared field-aligned button tier (named in the [brand guidelines' size table](../../../BRAND_GUIDELINES.md#buttons)), which carries that height and `padding: 0 var(--button-padding-x)`; the input keeps `padding: var(--input-padding)`. `box-sizing: border-box` is global, so an explicit shared height is the only reliable equaliser — never fake the match with padding or font-size, and never re-declare the height on the button.
- **A directional `→` on a guide link is all-or-nothing across a page.** If one forward/guide link carries the trailing arrow, every sibling link to the same destination carries it too — and an arrow-terminated link takes no trailing period.
- **Section background rhythm.** A long marketing page alternates `--background` and `--muted` section bands so no two adjacent content sections share a fill; each muted band carries a `1px var(--border)` top/bottom rule (the muted-band modifier the home and landing page stylesheets each define; [Layout Principles](../../../BRAND_GUIDELINES.md#layout-principles) cites the reference pattern). `--card` is a card-only surface, never a full-bleed section background.

### Copyable Fields Are One Box

A copyable value — a server URL, a CLI command, a prompt — renders as **one** bordered box that wraps **both** the value and its Copy button; the Copy button is always a child inside that box, never a sibling floating outside it. Put the border/background/padding on the row container, not on the inner text element, so a second copyable field can't drift to a different placement. Reuse one partial for every copyable field.

### Wide Tables Reflow to Stacked Cards on Mobile

A wide comparison / data table reflows to a single-column stacked-card layout at mobile widths — never `overflow-x: auto` + `min-width` to permit a sideways swipe. The page body scrolls **down only**. Keep the semantic `<table>` (screen readers, SEO, and `text/markdown` content-negotiation all depend on it) and drive the mobile layout from CSS — `display: block` rows plus a `data-label` prefix on each cell (`td::before { content: attr(data-label) }`) — not by swapping the `<table>` for `<div>`s.

## Client-Side JavaScript Conventions

### Test Attributes Are for Tests Only

`data-test-*` attributes must NEVER be used in client-side JavaScript.

```javascript
// ❌ BAD
var input = section.querySelector('[data-test-field="firstName"]');

// ✅ GOOD
var input = section.querySelector('[name="firstName"]');
```

### Derive Field Names Dynamically

Never hardcode field names. Discover them from the DOM.

```javascript
// ❌ BAD - Hardcoded
params.delete('firstName');

// ✅ GOOD - Discover from DOM
form.querySelectorAll('[name]').forEach(function(el) {
  fieldNames.push(el.name);
});
```

### Re-sync Swapped-In Elements on `htmx:afterSettle`

A client that toggles a class or attribute on an element htmx swaps in must re-sync on `htmx:afterSettle`, never on `htmx:afterSwap` or `htmx:oobAfterSwap`. htmx swaps an id-matched element in wearing the outgoing element's attributes, then restores the incoming markup's own attributes — `class` among them — in a settle task that runs between those two events. So anything a client writes on the swap event is reverted a few milliseconds later, with no error to show for it. Only that element's own attributes are affected, which is why a client that writes text or reads state elsewhere sees nothing wrong.

A pipeline whose local test double settles synchronously renders the finished state at SSR and never exercises the swap path at all, so this class of bug survives a green local run and shows up only against a deployed environment.

### Browser JS Is Bundled and Served Same-Origin

Compile `*.client.ts` to a browser IIFE bundle and reference it via a relative `<script src="/...">`. Do not route the URL through the static asset base URL used for images.

**Why not inline via `Function.prototype.toString()`**: the dev TypeScript transformer wraps compiled functions with runtime helpers (e.g. `__name`) that only live at module scope. Stringifying the function body into a `<script>` tag strips it from that scope and the page throws `ReferenceError` on load.

**Why same-origin, not the CDN**: the bundle changes per commit and must ship atomically with the HTML that references it. A CDN URL lets the asset and the HTML drift out of sync — any developer who points the static base URL at a remote CDN gets a 404 (and in Chrome an ORB-blocked response) for the latest bundle until the next deploy.

```html
<!-- ❌ BAD — inline Function.toString() leaks compiler helpers -->
<script>(function () { var init = ${initThing.toString()}; init(...); })();</script>

<!-- ❌ BAD — CDN URL drifts from the HTML per commit -->
<script src="${STATIC_BASE_URL}/.../thing.client.js" defer></script>

<!-- ✅ GOOD — same-origin bundle, atomic with the HTML -->
<script src="/<bundle-prefix>/thing.client.js" defer></script>
```

The bundle output directory must be inside the runtime asset tree so the Lambda packaging step ships it alongside the handler; the Express app mounts the matching URL prefix as `express.static` so the same relative URL resolves in dev and in prod.

### Web App Manifest Is Served Same-Origin

Serve the web app manifest from the document's own origin, not the static-asset CDN: a manifest's relative URLs (`start_url`, icon `src`) resolve against the manifest's own URL, so a CDN-hosted manifest makes `start_url` cross-origin to the document and Chrome warns. A 301 from the app origin to the CDN does not fix it — relative URLs then resolve against the redirected CDN URL — so the app origin must serve the manifest body itself and stamp each icon `src` as an absolute CDN URL.

```html
<!-- ❌ BAD — CDN-hosted manifest: start_url resolves cross-origin, Chrome warns -->
<link rel="manifest" href="${STATIC_BASE_URL}/site.webmanifest">

<!-- ✅ GOOD — same-origin manifest; a builder stamps icon src values absolute to the CDN -->
<link rel="manifest" href="/site.webmanifest">
```

## Structured Parsing Over Regex

Use a proper parser for any structured format (HTML, XML, JSON, etc.). Never use regex to extract data from structured markup — regex cannot handle nesting, attribute ordering, or encoding edge cases reliably.

For HTML in this codebase, use `linkedom`'s `parseHTML` and standard DOM APIs (`querySelector`, `getAttribute`). Regex-based markup parsing requires explicit human approval.

```typescript
// BAD — regex breaks on attribute order, whitespace, encoding
const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

// GOOD — DOM parser handles all edge cases
const { document } = parseHTML(html);
const content = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
```

## HTML Template Conventions

- Use `.html` files for view templates with Handlebars placeholder substitution
- No view rendering frameworks (React, Vue, Angular) - vanilla HTML/CSS/JS only
- Keep templates colocated with their page objects

### Template Indentation

Templates indent with **2 spaces per level, never tabs**. Biome does not format
`.html` (the shared Biome config excludes it), so the rule lives in
[`.editorconfig`](../../../.editorconfig) and is enforced in CI by
`editorconfig-checker`, which the repository-root `check` script runs once for the whole
repository rather than per project. It reports and fails; it never rewrites a file.

Two conventions the checker cannot see, so they rely on review:

**Handlebars block helpers do not add an indent level.** `{{#if}}`, `{{#each}}`,
and `{{else}}` sit at the surrounding indent and their contents stay level with
them, so a template's indentation reflects DOM structure rather than control
flow.

```html
<div class="flight-card__actions">
  {{#each actions}}
  <form method="{{method}}" action="{{url}}">
    <button type="submit">{{text}}</button>
  </form>
  {{/each}}
</div>
```

**A partial substituted through `{{{placeholder}}}` starts its root at column 0.**
Handlebars replaces the placeholder in place, so the placeholder's own indent
supplies the root line's indent at render time — only the root's. The body and
closing tag carry the embedding depth, which makes the file look lopsided in
isolation while rendering correctly. The account page's subscription-card partial
is the worked example (`ls` the account page directory — it is the one template
there other than the page template): root at 0, body at 8, closer at 6, injected
at a placeholder indented 6.

Continuation lines wrap at **parent indent + 2**, not aligned to the attribute
column — column alignment lands on odd indents, which `indent_size = 2` rejects.

```html
<!-- ✅ GOOD — continuation at parent + 2 -->
<input
  id="booking-lookup-input"
  class="booking__lookup-input"
  type="url">
```

## DOM Testing

Use JSDOM (or `linkedom`'s `parseHTML`) to parse HTML responses in tests and assert against the DOM.

## Pre-Commit Checklist

When staged changes include `.css`, `.html`, or `.client.ts` files:

- [ ] CSS selectors do NOT use `data-test-*` attributes
- [ ] CSS class names are semantic and use BEM prefixes
- [ ] Client JS does NOT use `data-test-*` attributes
- [ ] Field names are discovered from DOM, not hardcoded
- [ ] Every same-origin CTA carries `utm_source`/`utm_content` (hidden inputs for a GET form, action query for POST)
- [ ] URL/query string represents page state
- [ ] Interactive features work without JavaScript
- [ ] Browser JS is bundled and referenced via a same-origin `<script src>`, not inlined via `Function.toString()` or served through the static asset CDN base URL
- [ ] Web app manifest is served same-origin (not the static-asset CDN); icon `src` values are absolute CDN URLs
