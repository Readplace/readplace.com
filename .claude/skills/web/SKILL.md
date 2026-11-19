---
name: web
description: Web adapter conventions for the application domain. Use when working with HTML templates, CSS styles, client-side JavaScript, or SSR patterns. Triggers on changes to .css, .html, .template.html, or .client.ts files.
---

# Web Adapter Guidelines

Conventions for building the web adapter layer that connects the application domain to browser clients.

[Component Pattern](references/component-pattern.md) — read when composing a page or component, or deciding whether to share markup.

[Every CTA Carries Its Own UTM](references/cta-utm.md) — read when adding or changing a call to action or its UTM parameters.

[Server-Side Rendering with Progressive Enhancement](references/server-side-rendering.md) — read when building server-rendered behaviour, a boosted link or form, or a swap.

[CSS and Styling Conventions](references/css-and-styling.md) — read when writing or changing styles, or when a menu, picker or flyout is cut off by its container.

[Client-Side JavaScript Conventions](references/client-side-javascript.md) — read when writing or changing client-side JavaScript.

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

### Ids inside a saved article

Captured markup must never claim the id of an element the page swaps out of band, so the sanitiser drops every id outside two reserved namespaces:

| Namespace | Kept on | Whose anchors |
|---|---|---|
| `section-` | an h2 or h3 | the table of contents' rows |
| `highlight-<uuid>` | a `<mark>` | the highlights rail's Jump links, one per reader highlight |

The one function that both the article body and the table of contents read runs the sanitiser twice:

| Step | Why |
|---|---|
| Sanitise, then mint a `section-` id on each listed heading and clear the id of any heading it does not list | The rows list only headings the body keeps, under the text it shows, and a publisher's `section-` id cannot shadow a minted one |
| Sanitise again, as the last transform | A linkedom serialisation decodes one level of attribute escaping, so an entity-encoded `javascript:` href comes out live unless the sanitiser runs after it |

Both prefixes are exported beside the sanitiser, and each minting step builds its ids from one of them (grep the workspace packages' non-test sources for the quoted `"section-"` or `"highlight-"` literal; the single hit for each is it). The highlight step strips any id a publisher's own `<mark>` carries before it wraps the reader's passages, so a captured `highlight-` id cannot shadow a minted one. Nothing else adds ids to article content.

### MathML inside a saved article

The sanitiser keeps presentation MathML so the reader and the EPUB draw a formula instead of dropping it. Its allow-list sits beside the HTML one (grep the domain package's non-test sources for `"mprescripts"`):

| Kept | What |
|---|---|
| Elements | `math`, `mrow`, `mi`, `mn`, `mo`, `mtext`, `mspace`, `ms`, `mfrac`, `msqrt`, `mroot`, `msub`, `msup`, `msubsup`, `munder`, `mover`, `munderover`, `mmultiscripts`, `mprescripts`, `mtable`, `mtr`, `mtd`, `mstyle`, `mpadded`, `mphantom`, `semantics` |
| Attributes, on any of them | `display` (`block` or `inline`), `mathvariant` (`normal`), `displaystyle` (`true` or `false`); any other value drops the attribute |
| Dropped with their content | `annotation` and `annotation-xml` (a formula's TeX source or alternate markup), and `svg`, which stays dropped |

The sanitiser does not know namespaces and the page has no CSP, so a browser can parse its output differently from how the sanitiser saw it (mutation XSS). Adding `svg`, `style`, `title`, `textarea`, `xmp` or `annotation-xml`, or any URL, event or style attribute, in or beside `math` reopens that hole. The EPUB writer adds the MathML namespace to each `math` element itself, and marks a chapter that holds one with the `mathml` manifest property, so the sanitiser never needs to keep `xmlns`.

## Reserving image boxes in the reader

The reader's image rule keeps `width: auto` for publisher markup that declares `width="0"`. Under it Chromium lays out an image that has not loaded as 0x0, so the text jumps when the bytes arrive and a selection the reader has started moves under them. The reservation must not change how any image looks once it has loaded, for stored and future articles alike.

| Part | Why it is shaped this way |
|---|---|
| Save time writes `data-reader-image-size` only on a re-hosted image whose final size is certain, and strips any copy a publisher sent | Measurement is the only source we trust. A file whose displayed size depends on metadata the measurement does not read (EXIF, a PNG `eXIf` chunk, a GIF frame outside its screen) gets no attribute. So does an SVG, an unsupported `sizes` form or a srcset candidate that was not measured |
| The sanitiser turns the attribute into inert custom properties, and a reader CSS rule applies them only under a marker the reader script sets on the root | Without the script (JavaScript off, a missing bundle) nothing is reserved and the page is exactly what it was before |
| The script removes the attribute and the style on each image's `load` or `error` | A settled image is the same markup under the same CSS as before, so a wrong measurement or a broken image ends looking exactly as it did without the reservation |
| Tables outside the reader's flow layout and embed facades are excluded | Browsers do not reserve the box inside them before load anyway, and the facade sizes itself |

Do not replace this with publisher `width`/`height` attributes, a direct inline width, or removing `width: auto`. Each was tried, and each changed how loaded images look: placeholder attributes shrank full-size images, and a GIF placeholder became a blank square. Bodies saved before the attribute existed stay unreserved until a recrawl rewrites them. Grep the non-test sources for `data-reader-image-size`. It finds the domain module that owns the attribute's name and grammar (the save-time writer and the sanitiser import both from it), the CSS rule, the script, and the browser test that holds a body's images back and checks both that the box is reserved before load and that nothing changes after.

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
is the worked example — the one of the `/account` page's templates that polls with
`hx-trigger="every 3s"`; grep for it: root at 0, body at the placeholder's
indent + 2, closer at the placeholder's indent.

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
- [ ] Every popover carries exactly one `autofocus` — on its commit control, field or first option, never on the panel; tooltip popovers, balloons and menus carry none; the inline or fallback copy of a shared form carries none; a new dialog is in the opening-focus route test's path and key lists
- [ ] Every boosted swap declares its scroll intent with a `show:` modifier, and a new swap shape has a browser test asserting `scrollY` after a real click
- [ ] A pending state ends on the first poll that sees its outcome; a spent budget or a device give-up renders its own outcome for work the reader started, and the stored state's view for work the page started on its own
- [ ] Browser JS is bundled and referenced via a same-origin `<script src>`, not inlined via `Function.toString()` or served through the static asset CDN base URL
- [ ] A panel that opens beside its trigger is in the top layer or `position: fixed`, and a browser test hit-tests its items in every container it opens in
- [ ] Web app manifest is served same-origin (not the static-asset CDN); icon `src` values are absolute CDN URLs
