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

Tests asserting on the list use positive assertions on the rendered keys (per [test-driven-design's "Never Rely on `querySelector(...).toBeNull()`"](../../test-driven-design/SKILL.md)):

```typescript
const actions = Array.from(doc.querySelectorAll("[data-test-segment-action]")).map(
	(el) => el.getAttribute("data-test-segment-action"),
);
expect(actions).toEqual(["open"]); // non-owner sees only the open action
```
