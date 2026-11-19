## CSS and Styling Conventions

### Core Rules

| Rule | Rationale |
|------|-----------|
| Test attributes are for tests only | Never use `data-test-*` in CSS selectors |
| Use semantic classes | Describe visual state (`.flight-segment--outbound`) |
| Use BEM for scoping | Prevent class collisions (`.flight-segment__label`) |
| Orphan/widow control lives on the prose container, not on `body` | A global `text-wrap` forces a full-page reflow |
| Fonts come from `var(--font-serif)` / `var(--font-sans)` | One source of truth: the shared base-styles module that declares the `--font-serif` token (grep for the quoted `"--font-serif"` key — a TypeScript object, not a stylesheet). Never inline the stack. See [Typography](../../../../brand-guidelines/typography.md#typefaces-in-use) |
| Buttons come from the shared button system | From the button stylesheet the shared base-styles module injects into every `<head>`, and that the extension build compiles into the popup's own stylesheet; a page stylesheet adds layout only. See [Buttons](../../../../brand-guidelines/iconography/buttons.md#buttons) |
| Collapsible cards come from the shared disclosure card | A native `<details>` whose `<summary>` is the card's header, so it opens and closes with no script. Its one stylesheet draws the card, the header, the title and the chevron; a consumer's stylesheet adds layout only, and lays out its own body. See [Disclosure cards](../../../../brand-guidelines/components/disclosure-cards.md#disclosure-cards) |
| Alerts come from the shared alert primitive | Render through the web shell package's alert renderer — the one that gives an error the `alert` role and every other variant `status` (grep the workspace packages for `role: "alert"`) — and ship the alert stylesheet it re-exports, which the extension build also compiles into the popup's own stylesheet. The popup writes the renderer's markup by hand, because its glue fills in the text. A page stylesheet adds placement only. See [Alerts and Status](../../../../brand-guidelines/components/alerts-and-status.md#alerts-and-status) |
| Form controls come from the shared form-control system | From the form-control stylesheet the shared base-styles module injects into every `<head>`; a page stylesheet adds layout only. See [Form Inputs](../../../../brand-guidelines/spacing-and-layout.md#form-inputs) |
| Chips come from the shared chip system | From the chip stylesheet the shared base-styles module injects into every `<head>`; a page stylesheet adds layout only. See [Chips, tags and badges](../../../../brand-guidelines/components/chips-tags-and-badges.md#chips-tags-and-badges) |
| Icons are inline same-origin SVG, drawn by the icon Handlebars helper (the `registerHelper` call in the shared renderer that resolves a name against the shared icon set and returns a SafeString — the other registration is the UTM tracking helper). The stroke drawing is the default; `{{<icon-helper> "<name>" <variant-arg>="solid"}}` (names as that registration defines them) draws the solid one, which a current-state glyph takes, with the one decorative exception Icon Style records, and the variant may come from render data | An unknown name, an unknown variant, or a solid variant the icon has no drawing for fails the render instead of shipping a blank glyph. The one icon not drawn inline is the reader's note marker: nothing may be inserted into the article body, so it masks the shared drawing, encoded into a `data:` URI, onto a pseudo-element (grep the web stylesheets for `mask-image`). See [Icon Style](../../../../brand-guidelines/iconography/icon-style.md#icon-style) |

```css
/* ❌ BAD */
[data-test-segment-type="outbound"] { ... }

/* ✅ GOOD */
.flight-segment--outbound { ... }
```

The brand guidelines own the design rules this skill used to restate — which
heading levels are sans vs serif, orphan control, the button variant/tier
taxonomy, one measure per column, and where container padding may grow. See
[Typography Rules](../../../../brand-guidelines/typography.md#typography-rules),
[Buttons](../../../../brand-guidelines/iconography/buttons.md#buttons) and [Layout
Principles](../../../../brand-guidelines/spacing-and-layout.md#layout-principles). Enforce them in CSS;
don't re-document their values here. One implementation reminder those rules
don't carry: reach for the CSS `text-wrap` property, not a manual `&nbsp;`/`<br>`,
so a later copy edit can't reintroduce an orphan — a hand-placed break only for a
shape the property can't express (e.g. a centred pyramid heading).

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

The token colours, the input/button height pairing, and the marketing
section-band rhythm are all in the brand guidelines ([Colour
Rules](../../../../brand-guidelines/colour-palette.md#colour-rules), [Form
Inputs](../../../../brand-guidelines/spacing-and-layout.md#form-inputs), [Layout
Principles](../../../../brand-guidelines/spacing-and-layout.md#layout-principles)) — reach for those
tokens rather than a bespoke per-element value. Two page-level
reminders:

- **A directional `→` on a guide link is all-or-nothing across a page.** If one forward/guide link carries the trailing arrow, every sibling link to the same destination carries it too — and an arrow-terminated link takes no trailing period.
- **A pager uses the web shell's shared pagination block and stylesheet, never a page-local copy** — the [Pagination](../../../../brand-guidelines/components/pagination.md#pagination) section names the module.

### Copyable Fields Are One Box

A copyable value — a server URL, a CLI command, a prompt — renders as **one** bordered box that wraps **both** the value and its Copy button; the Copy button is always a child inside that box, never a sibling floating outside it. Put the border/background/padding on the row container, not on the inner text element, so a second copyable field can't drift to a different placement; when the value is a read-only `<input>`, that row container is the shared wrapped-field box and the input its inner control (both classes are named in [Form Inputs](../../../../brand-guidelines/spacing-and-layout.md#form-inputs)). Reuse one partial for every copyable field.

### Tables Reflow to Stacked Cards, Never a Sideways Scroll

A wide comparison / data table reflows to a single-column stacked-card layout at mobile widths — never `overflow-x: auto` + `min-width` to permit a sideways swipe. The page body scrolls **down only**. Keep the semantic `<table>` (screen readers, SEO, and `text/markdown` content-negotiation all depend on it) and drive the mobile layout from CSS — `display: block` rows plus a `data-label` prefix on each cell (`td::before { content: attr(data-label) }`) — not by swapping the `<table>` for `<div>`s.

A saved article's tables are publisher markup without `data-label`, so the reader's preparation writes what the reflow needs before its last sanitise (grep the workspace packages' non-test sources for the quoted `"data-reader-fits"` literal: it sits with the other attribute names beside the sanitiser's allowlist, and the step that writes them imports them). Stacking must never hide a heading that no label repeats. Each cell's `data-label` joins every heading above it, outer row first, and a stacked table hides only the header rows marked `data-reader-header`, which are marked only when the labels carry every heading in them. Labels repeat their headings on every cell, so a body's labels may add at most three times the length of the HTML the step receives, spent table by table in document order, and a table that would go past that gets no labels and so keeps its header rows: without the cap a crafted table grew the reader HTML 496-fold, while no saved article measured adds more than 0.8 times that length. Spans, stacked header rows and nested tables can also multiply the work of describing tables without adding to what the step writes, so that work is capped at twice the same length, keeping the time and memory spent describing tables in proportion to the HTML the step receives: without the cap a crafted body of 391 KB held the step for 8.3 seconds and over 4 GB, and one of 1.9 MB ran it out of memory, while no saved article measured needs more than 0.8 times that length. The table that passes the work cap and every table after it, nested or not, get no labels, header marks or fit mark, so they stack with their header rows shown, though a one-column table still flows, because it is told apart from its rows alone, before any counted work; what a table spent is never handed back, or each table of a nested chain could repeat the reading the table around it was refused for. A header row that is one cell across the whole table is the table's title: it stays a visible row and is never a label, because as a label it repeated on every value of the table. A one-column table is marked `data-reader-flow` and drops its box, so a layout table reads as text. A table is an auto-layout grid, its cells breaking with `break-word`, only when it is marked `data-reader-fits` (its longest words, column by column, fit a 600px column), is not nested in another table, and the article column is at least `37.5rem` wide; every other table stacks. That last test is a set of media queries built from the layout, column = min(746px, viewport − offset), because the column narrows when the rail shows a card: 546px at a 1024px viewport, 730px at 1280px. The offsets are 82, 106 and 114px below a 1024px viewport, 478 and 550px with a rail card, and 386 and 482px without one; they follow the page gutter, the column gap, the reading column's maximum, the 340px rail and the card padding, so a change to any of those moves the bands. The bands repeat the reading layout's list of rail children that do not count as a card, and an edit to that list goes in every stylesheet that repeats it (grep the web sources for `.highlights-rail:empty`). `37.5rem` in a media query follows the browser's default font size but not macOS Safari's text-only zoom (Option-Command-+): from about 150% a table marked as fitting can overflow the column, which was accepted. With 15px classic scrollbars a wider layout applies up to 15px early, with no overflow.

The reader's stylesheets hold no in-flow size container (`container-type: inline-size` or `size`): the stylesheet is inserted again with `<main>` on every highlight, note and tag action, and WebKit lays out a newly inserted size container collapsed for one pass, which clamps the scroll position and jumped iOS readers to the top of the article. A jest test over the reader's stylesheets enforces it and exempts the out-of-flow confirm popover; a WebKit e2e spec named for highlights keeping their place covers the flows. Three in-flow size containers remain on other pages whose `<main>` is swapped in place (the readlist header, the inline wizard on a readlist's Preferences tab, the plans form); they are left alone because no jump has been reproduced there. Do not bring back the equal-split fixed layout: at 390px it left a prose cell under 10 characters per line in 20 of the 26 repaired articles that hold tables. Do not choose the layout by column count: in a sample of 133 articles that left 13 tables wider than the column at 1280px. The fit estimate's glyph widths were measured against Inter in Chromium and WebKit; change them only after measuring again.

### A Panel Beside Its Trigger Escapes Every Scroll Container

An overflow menu, picker or flyout positioned `absolute` is cut off by any ancestor whose `overflow` is not `visible`. The clip usually arrives later and from elsewhere: a list boxed with `overflow: hidden`, or a column given `overflow-y: auto` inside a media query or a `:has()` rule. The readlist page's row menus were cut off this way on 2026-11-14 and again on 2026-11-15, first inside the popover that lists the readlists the rail has no room for, then in the rail itself once it could scroll. Flipping the panel upward is not a fix: a container holding one row has no room in either direction.

| Rule | Why |
|---|---|
| The panel is in the top layer (`popover`) or `position: fixed`, placed from its trigger's `getBoundingClientRect()` when it opens | An ancestor's `overflow` clips neither |
| After placing a fixed panel, measure where it landed and correct the difference | An ancestor with `container-type`, `transform`, `filter` or `contain` is the containing block of its fixed descendants, so the panel lands offset by that ancestor's position |
| A fixed panel closes when a scroll, a resize or a content swap moves its trigger | It no longer follows the trigger as an absolute one did, and a swap that shifts the layout fires no scroll |
| A highlight's surfaces — its actions panel, hover preview and note editor — follow their passage on scroll instead of closing, and dock at the bottom of the visual viewport when they cannot sit clear of it | The reader reads the passage while writing about it; a note editor that closed on scroll would throw away what was typed |
| Before adding `overflow`, `contain` or `container-type` to a container, find the panels that open inside it | The clip ships with the container, not with the menu |
| A browser test opens the panel in every container and at every width it can open in, including a container holding a single row, and hit-tests each item with `document.elementFromPoint` | A clipped item keeps its box and passes a visibility check; only a hit test shows it is covered |

The placement and close rules are implemented once, for every options menu on every page, in the shared client module that sets the `--menu-top` custom property (grep the non-test client sources for it). The hit test is in the browser test whose failure message reads `must not be clipped`. That test opens the readlist card's menu at desktop and phone width, and the rail's, the More popover's and the phone sheet's menus at one width each; a new panel adds its own containers, widths and single-row case.
