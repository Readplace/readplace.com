---
name: web
description: Web adapter conventions for the application domain. Use when working with HTML templates, CSS styles, client-side JavaScript, or SSR patterns. Triggers on changes to .css, .html, .view.html, .client.js files.
---

# Web Adapter Guidelines

Conventions for building the web adapter layer that connects the application domain to browser clients.

## Component Pattern

Pages and components follow a composable `Component` type. See:
- [projects/hutch/src/web/component.types.ts](projects/hutch/src/web/component.types.ts) - Type definitions
- [projects/hutch/src/web/base.component.ts](projects/hutch/src/web/base.component.ts) - Base component implementation

For page examples, see `projects/hutch/src/web/pages/*/`.

### Don't DRY Trivial Composition

A wrapper that only chains two function calls is not worth extracting. Inline the composition at the call site — the indirection hides what the route returns and forces readers to open another file to learn nothing.

```typescript
// ❌ BAD — wrapper adds a name but no logic
export function renderPage(source: BannerStateSource, body: PageBody): Component {
	return Base(body, bannerStateFromRequest(source));
}
sendComponent(req, res, renderPage(req, LoginPage(vm)));

// ✅ GOOD — composition is visible at the call site
sendComponent(req, res, Base(LoginPage(vm), bannerStateFromRequest(req)));
```

Extract a helper only when it owns real logic (branching, validation, transformation) — not when it just renames a chain.

### Iterate Lists, Don't Branch in Templates

When a region of the template renders a variable set of items (nav links, card actions, form fields, list rows), build a typed array in the view-model / page component and let the template iterate it with `{{#each items}}`. Do **not** scatter `{{#if showImport}}` / `{{#if hasCancelButton}}` / `{{#if accessIsReadOnly}}` conditionals across the markup. The branching belongs in TypeScript where it's testable in isolation and where the editor can verify the union of cases; the template's job is to render one item shape, once.

This applies even when the list has only 1–2 items today. The cost of the abstraction is a tiny typed item builder; the win is that adding, removing, or reordering items is one edit in one TypeScript function, not a search-and-replace across template branches.

```typescript
// ❌ BAD — booleans flow into the template, every variant grows another {{#if}}
return render(TEMPLATE, {
	isAuthenticated,
	accessIsReadOnly,
	showSubscription,
});
```
```html
{{#if isAuthenticated}}
<li><a href="/queue" data-test-nav-item="queue">Queue</a></li>
{{#if accessIsFull}}<li><a href="/import?..." data-test-nav-item="import">Import Links</a></li>{{/if}}
<li><a href="/export" data-test-nav-item="export">Export</a></li>
{{#if showSubscription}}{{#if accessIsFull}}<li><a href="/account?..." data-test-nav-item="account">Account</a></li>{{/if}}{{/if}}
<li><form method="POST" action="/logout"><button data-test-nav-item="logout">Sign out</button></form></li>
{{else}}
<li><a href="/#what-works" data-test-nav-item="features">Features</a></li>
<li><a href="/signup" data-test-nav-item="signup">Sign up</a></li>
{{/if}}
```

```typescript
// ✅ GOOD — list is built in TS, template iterates one item shape
export function buildNavItems(input: {
	isAuthenticated: boolean;
	accessIsReadOnly: boolean;
	showSubscription: boolean;
}): NavItem[] {
	if (!input.isAuthenticated) return [NAV_FEATURES, NAV_SIGNUP];
	const items = [NAV_QUEUE];
	if (!input.accessIsReadOnly) items.push(NAV_IMPORT);
	items.push(NAV_EXPORT);
	if (input.showSubscription && !input.accessIsReadOnly) items.push(NAV_ACCOUNT);
	items.push(NAV_LOGOUT);
	return items;
}
```
```html
{{#each navItems}}
<li>
  <form method="{{method}}" action="{{href}}">
    <button type="submit" data-test-nav-item="{{key}}">{{label}}</button>
  </form>
</li>
{{/each}}
```

#### Forms Everywhere — Don't Split Items Into `<a>` vs `<form>`

When some items are GET (link-like) and others are POST (mutations), do **not** add an `isLink: method === "GET"` discriminator and branch the template on it. Render every item the same way: `<form method="{{method}}" action="{{href}}"><button>{{label}}</button></form>`. A `method="GET"` form with no inputs navigates to the action URL on submit — the browser appends `?` and follows — so it behaves exactly like a link.

Why prefer this even though `<form>` is heavier markup than `<a>`:

- **One template shape, one styling target.** No `{{#if isLink}}` / `{{else}}` branch; `.nav__link` (or whatever you call it) styles `button.nav__link` and that's it.
- **Adding a new variant is one item in the builder, not a new branch in the template.** Today's GET nav item becomes tomorrow's POST mutation without touching the template.
- **Excessive markup is not a performance issue at this scale.** A few extra `<form>` and `<button>` elements per page weigh nothing next to the page itself.
- **CSRF posture stays consistent.** POSTs (logout, cancel) and GETs (queue, export) use the same wrapper, so it's harder to accidentally render a POST mutation as a click-only `<a>`.

The same rule applies to action lists, card actions, and any other repeated UI element with mixed methods. Reserve raw `<a href>` for the rare standalone link that doesn't fit the iteration (e.g., a single brand link in the header).

Worked examples in the codebase to copy from:

- `projects/hutch/src/runtime/web/banner-state.ts` (`buildNavItems` → `NavItem[]`) + `header.template.html` (`{{#each navItems}}`) — mixed `<a>` / `<form>` items.
- `projects/hutch/src/runtime/web/pages/account/account.view-model.ts` (`AccountAction[]`) + `account.template.html` — primary / destructive variants.
- `projects/hutch/src/runtime/web/pages/queue/queue-card/queue-card.component.ts` (`actions[]` + per-action `fields[]`) + `queue-card.template.html` — nested iteration: each action carries its own hidden-input form fields.
- `projects/hutch/src/runtime/web/pages/view/view.component.ts` + `view.template.html` — actions on the view page.
- `projects/hutch/src/runtime/web/onboarding/onboarding.template.html` — onboarding step actions.

Tests asserting on the list use positive assertions on the rendered keys (per [test-driven-design's "Never Rely on `querySelector(...).toBeNull()`"](../test-driven-design/SKILL.md)):

```typescript
const navItems = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map(
	(el) => el.getAttribute("data-test-nav-item"),
);
expect(navItems).toEqual(["queue", "export", "logout"]); // read-only user
```

## Server-Side Rendering with Progressive Enhancement

This project uses an SSR-first approach. Core principles:

### URL as State

The URL query string represents the complete page state. All user interactions that modify state should be expressible as URL changes via HTML `<form>`.

For examples, see:
- URL builder files in `projects/hutch/src/web/pages/*/`

### View Model Pattern

Transform query string parameters into a structured view model before rendering. Templates should be "dumb" - they render what the view model provides without business logic.

For examples, see:
- View model files in `projects/hutch/src/web/pages/*/`

### Progressive Enhancement

Build features in two steps:

**Step 1 — Semantic HTML first.** Every interaction must work as a standard HTML form submission or link navigation with no JavaScript. Use `<form method="POST">` for mutations and `<a href="...">` for navigation. This is the baseline that must always work.

**Step 2 — Add htmx for SPA performance.** Once the semantic HTML works, add `hx-boost="true"` to forms and link containers so htmx intercepts them as AJAX requests. Use `hx-target="main" hx-select="main" hx-swap="outerHTML show:none"` to swap only the `<main>` content without scrolling. The server returns the same full HTML response — htmx extracts just the `<main>` fragment.

```html
<!-- Step 1: Works without JS -->
<form method="POST" action="/queue/save">
  <input type="url" name="url" required>
  <button type="submit">Save</button>
</form>

<!-- Step 2: Same form, boosted for SPA feel -->
<form method="POST" action="/queue/save"
      hx-boost="true" hx-target="main" hx-select="main"
      hx-swap="outerHTML show:none">
  <input type="url" name="url" required>
  <button type="submit">Save</button>
</form>
```

No custom `*.client.js` is needed when htmx covers the interaction. Reserve `*.client.js` files for behaviour htmx cannot express (e.g., inline validation, animations).

IMPORTANT: Ask for human intervention whenever a deviation from htmx is needed away from this basic pattern for SPA navigation.

### No Side Effects on GET

Never mutate state on a GET — proxies cache them, prefetchers fire them, crawlers hit them. For URLs that need to trigger a mutation (e.g., a share-able save permalink), render a page with an auto-submitting `<form method="POST">`. See `save.page.ts` for the `/save?url=X` → `/queue?url=X` → auto-submit POST pattern.

```html
<form method="POST" action="/queue/save" data-auto-submit>
  <input type="url" name="url" value="https://...">
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

```css
/* ❌ BAD */
[data-test-segment-type="outbound"] { ... }

/* ✅ GOOD */
.flight-segment--outbound { ... }
```

### CSS Comment Index Format

Use numbered references for multi-line explanations:

```css
/**
 * 1. Use primary color for outbound
 */
.flight-segment--outbound { color: var(--primary); /* 1 */ }
```

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
<script src="/client-dist/thing.client.js" defer></script>
```

The bundle output directory must be inside the runtime asset tree so the Lambda packaging step ships it alongside the handler; the Express app mounts the matching URL prefix as `express.static` so the same relative URL resolves in dev and in prod.

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
- Keep templates close to their page objects (see file organization in `projects/hutch/src/web/pages/`)

## DOM Testing

Use JSDOM to parse HTML responses in tests. See `parseHTML()` usage in test files within `projects/hutch/src/web/pages/`.

## Pre-Commit Checklist

When staged changes include `.css`, `.html`, or `.client.js` files:

- [ ] CSS selectors do NOT use `data-test-*` attributes
- [ ] CSS class names are semantic and use BEM prefixes
- [ ] Client JS does NOT use `data-test-*` attributes
- [ ] Field names are discovered from DOM, not hardcoded
- [ ] URL/query string represents page state
- [ ] Interactive features work without JavaScript
- [ ] Browser JS is bundled and referenced via a same-origin `<script src>`, not inlined via `Function.toString()` or served through the static asset CDN base URL
