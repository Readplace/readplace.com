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
