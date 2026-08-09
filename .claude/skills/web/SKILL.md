---
name: web
description: Web adapter conventions for the application domain. Use when working with HTML templates, CSS styles, client-side JavaScript, or SSR patterns. Triggers on changes to .css, .html, .view.html, .client.js files.
---

# Web Adapter Guidelines

Conventions for building the web adapter layer that connects the application domain to browser clients.

## Component Pattern

Pages and components follow a composable `Component` type. A page returns a `PageBody`; a `Base` wrapper takes the page body plus per-request state (header, banner, auth) and produces the final `Component`. Routes call `sendComponent(req, res, ...)` to write the response.

### Don't DRY Trivial Composition

A wrapper that only chains two function calls is not worth extracting. Inline the composition at the call site — the indirection hides what the route returns and forces readers to open another file to learn nothing.

```typescript
// ❌ BAD — wrapper adds a name but no logic
export function renderPage(source: HeaderSource, body: PageBody): Component {
	return Base(body, buildHeader(source));
}
sendComponent(req, res, renderPage(req, SomePage(vm)));

// ✅ GOOD — composition is visible at the call site
sendComponent(req, res, Base(SomePage(vm), buildHeader(req)));
```

Extract a helper only when it owns real logic (branching, validation, transformation) — not when it just renames a chain.

### Iterate Lists, Don't Branch in Templates

When a region of the template renders a variable set of items (nav links, card actions, form fields, list rows), build a typed array in the view-model / page component and let the template iterate it with `{{#each items}}`. Do **not** scatter per-item conditionals across the markup. The branching belongs in TypeScript where it's testable in isolation and where the editor can verify the union of cases; the template's job is to render one item shape, once.

This applies even when the list has only 1–2 items today. The cost of the abstraction is a tiny typed item builder; the win is that adding, removing, or reordering items is one edit in one TypeScript function, not a search-and-replace across template branches.

```typescript
// ❌ BAD — booleans flow into the template, every variant grows another {{#if}}
return render(TEMPLATE, {
	canEdit,
	canDelete,
	isOwner,
});
```
```html
{{#if isOwner}}
<li><a href="/foo" data-test-action="open">Open</a></li>
{{#if canEdit}}<li><a href="/foo/edit" data-test-action="edit">Edit</a></li>{{/if}}
{{#if canDelete}}<li><form method="POST" action="/foo/delete"><button data-test-action="delete">Delete</button></form></li>{{/if}}
{{else}}
<li><a href="/foo" data-test-action="open">Open</a></li>
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
    <button type="submit" data-test-action="{{key}}">{{label}}</button>
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

The header nav and the footer diverge on purpose, and that divergence is not a candidate for this unification. The header nav mixes a mutation (logout `POST`) with GET navigation, so every item renders as `<form method="{{method}}" action="{{href}}">` wrapping a `<button class="nav__link">`, carrying UTM in hidden inputs. The footer is GET-only navigation, so each item is a raw `<a class="footer__link">` under the standalone-link carve-out above, with UTM baked into the `href` by the `{{track}}` helper.

- Do not turn the footer into forms: it adds a POST wrapper no mutation justifies.
- Do not collapse the nav to plain `<a>`: it drops the logout form and its CSRF posture along with the hidden-input UTM.

```html
<!-- ✅ GOOD — header nav: uniform form + button, UTM in hidden inputs -->
<form method="{{method}}" action="{{href}}">
  <input type="hidden" name="utm_source" value="{{trackSource}}">
  <button type="submit" class="nav__link">{{label}}</button>
</form>

<!-- ✅ GOOD — footer: GET-only navigation as a standalone link, UTM via the {{track}} helper -->
<a class="footer__link" href="{{track '/blog' source='footer' content='blog'}}">Blog</a>
```

Tests asserting on the list use positive assertions on the rendered keys (per [test-driven-design's "Never Rely on `querySelector(...).toBeNull()`"](../test-driven-design/SKILL.md)):

```typescript
const actions = Array.from(doc.querySelectorAll("[data-test-action]")).map(
	(el) => el.getAttribute("data-test-action"),
);
expect(actions).toEqual(["open"]); // non-owner sees only the open action
```

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

No custom `*.client.js` is needed when htmx covers the interaction. Reserve `*.client.js` files for behaviour htmx cannot express (e.g., inline validation, animations).

IMPORTANT: Ask for human intervention whenever a deviation from htmx is needed away from this basic pattern for SPA navigation.

**Sanctioned deviation — card-scoped list mutations.** A mutation whose only visible effect is that one list row changes may swap the row instead of re-shipping the whole `<main>`, when re-rendering `<main>` is the measured cost. The queue's card mark-read/unread do this: the form targets the row (`hx-target="closest .queue-article" hx-swap="outerHTML"`); a `swap=card` marker on the action href — a response-representation hint the server never trusts as state, consistent with the URL-as-state rule below — routes an htmx submit to a small card-removal fragment plus out-of-band toast/counts; and the **server**, never the client, decides when the DOM has drifted (page emptied, page beyond the last, the pagination controls changed, or the change didn't apply) and answers with the full listing via `HX-Retarget: main`. The no-JS, Undo, reader and API callers keep the byte-identical `<main>`/303 path, and delete keeps its full-`<main>` confirm-popover flow. This is already decided — follow it for equivalent list-row mutations instead of re-asking. See `pages/queue/queue.page.ts` (`respondCardStatusSwap`) and `queue-mutation-fragments.ts`.

### No Side Effects on GET

Never mutate state on a GET — proxies cache them, prefetchers fire them, crawlers hit them. For URLs that need to trigger a mutation (e.g., a share-able permalink), render a page with an auto-submitting `<form method="POST">`:

```html
<form method="POST" action="/items" data-auto-submit>
  <input type="hidden" name="title" value="...">
</form>
```

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
| Fonts come from `var(--font-serif)` / `var(--font-sans)` | Never inline the `Georgia, "Times New Roman", serif` stack — one source of truth in `base.styles.ts`, like colours |
| Buttons come from the shared `.btn` system | One button in the product — a per-page base class is how padding, radius, height, and hover direction drift apart |
| Icons are inline same-origin SVG, drawn with `{{icon "name"}}` | Never an icon font, an icon CDN, an entity/Unicode glyph (`× → ✓ ▾`), or a CSS `content:` glyph. See [Icon Style](../../../BRAND_GUIDELINES.md#icon-style) |

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

Every call to action uses the shared `.btn` + `.btn--<variant>` classes that `BUTTON_STYLES`
in [`base.styles.ts`](../../../src/packages/web-shell/src/base.styles.ts) injects into every
page's `<head>`. A page stylesheet contributes layout only — `width`, `margin`, grid/flex
placement, `white-space`.

Do **not** define a per-page button base class (`.lp-btn`, `.hb-btn`, `.<page>__*-btn`) that
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

/* ✅ GOOD — markup is class="btn btn--primary checkout__pay-btn" */
.checkout__pay-btn { width: 100%; }
```

### One Measure Per Page Column

All stacked sections in a page column share a single content measure (see [Layout Principles](../../../BRAND_GUIDELINES.md#layout-principles)):

```css
/* ❌ BAD — prose capped narrower than the full-width tab bar above it */
.import { max-width: 800px; }
.import__intro { max-width: 56ch; }

/* ✅ GOOD — the whole flow shares one measure */
.import { max-width: var(--reader-max-width); }
.import__intro { /* no per-section cap */ }
```

### Responsive Container Padding

Container padding starts at the `lg` 24px token and grows to 32–40px at `@media (min-width: 768px)` (see [Layout Principles](../../../BRAND_GUIDELINES.md#layout-principles)):

```css
/* ✅ GOOD — mobile-affordable base, generous on desktop */
.auth-card { padding: 24px; }
@media (min-width: 768px) {
  .auth-card { padding: 40px; }
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

- **Inline body-copy links set `color: var(--primary)`.** There is no global bare-`<a>` reset, so an unstyled link renders browser-default blue — a styling gap, not a choice. One link token per page; emphasis inside a link is weight (`<strong>`), never a second hue.
- **An input paired with a button shares the button's height.** Set `height: var(--input-height)` on the input and give the button the shared `.btn--field` tier, which carries that height and `padding: 0 var(--button-padding-x)`; the input keeps `padding: var(--input-padding)`. `box-sizing: border-box` is global, so an explicit shared height is the only reliable equaliser — never fake the match with padding or font-size, and never re-declare the height on the button.
- **A directional `→` on a guide link is all-or-nothing across a page.** If one forward/guide link carries the trailing arrow, every sibling link to the same destination carries it too — and an arrow-terminated link takes no trailing period.
- **Section background rhythm.** A long marketing page alternates `--background` and `--muted` section bands so no two adjacent content sections share a fill; each muted band carries a `1px var(--border)` top/bottom rule (the `.lp-band--muted` / `.home-band--muted` pattern). `--card` is a card-only surface, never a full-bleed section background.

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
`.html` (it is excluded in `biome.config.base.json`), so the rule lives in
[`.editorconfig`](../../../.editorconfig) and is enforced in CI by
`editorconfig-checker`, wired into every project's `lint` script. It reports and
fails; it never rewrites a file.

Two conventions the checker cannot see, so they rely on review:

**Handlebars block helpers do not add an indent level.** `{{#if}}`, `{{#each}}`,
and `{{else}}` sit at the surrounding indent and their contents stay level with
them, so a template's indentation reflects DOM structure rather than control
flow.

```html
<div class="queue-article__actions">
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
isolation while rendering correctly. `account-card.template.html` is the worked
example: root at 0, body at 8, closer at 6, injected at a placeholder indented 6.

Continuation lines wrap at **parent indent + 2**, not aligned to the attribute
column — column alignment lands on odd indents, which `indent_size = 2` rejects.

```html
<!-- ✅ GOOD — continuation at parent + 2 -->
<input
  id="import-from-url-input"
  class="import__from-url-input"
  type="url">
```

## DOM Testing

Use JSDOM (or `linkedom`'s `parseHTML`) to parse HTML responses in tests and assert against the DOM.

## Pre-Commit Checklist

When staged changes include `.css`, `.html`, or `.client.js` files:

- [ ] CSS selectors do NOT use `data-test-*` attributes
- [ ] CSS class names are semantic and use BEM prefixes
- [ ] Client JS does NOT use `data-test-*` attributes
- [ ] Field names are discovered from DOM, not hardcoded
- [ ] URL/query string represents page state
- [ ] Interactive features work without JavaScript
- [ ] Browser JS is bundled and referenced via a same-origin `<script src>`, not inlined via `Function.toString()` or served through the static asset CDN base URL
- [ ] Web app manifest is served same-origin (not the static-asset CDN); icon `src` values are absolute CDN URLs
