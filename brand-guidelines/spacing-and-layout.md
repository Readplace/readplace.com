## Spacing & Layout

### Spacing Scale

A **4px base unit**. Layout spacing (page padding, gutters, gaps between cards and columns, a card's main padding) is always a multiple of 4. Inside a component, 2px half-steps (`6px`, `10px`, `14px`) and the 5px metadata icon gap are allowed where content must sit optically centred in a fixed target or a compact strip — a half-step never sets the space between cards or columns.

| Token | Value | Usage |
|---|---|---|
| `xs` | 4px | Gap between the rows of a rail list; tight inline gaps |
| `sm` | 8px | Between related elements (title → lede, label → field) |
| — | 12px | Between items sharing a row (a heading and its menu, a count and its sort); input padding |
| `md` | 16px | Between cards in a column (side-column panels use `lg`) |
| — | 20px | List-row and compact-card padding; the single-column gap; the phone page gutter, page top and header inset |
| `lg` | 24px | The tablet page gutter, page top and header inset; the stack gap and column gap below 1200px; card side padding; between side-column panels |
| `xl` | 32px | Between major sections of a marketing page; dialog padding from 768px; the page top and stack gap from 1200px |
| `2xl` | 48px | The page gutter, header inset and column gap from 1200px; hero spacing |

Page-level insets (the `--page-top` steps, the `64px` / `80px` bottom) sit on the same 4px base.

### Form Inputs

> **Source of truth:** `FORM_CONTROL_STYLES` in `src/packages/web-shell/src/base.styles.ts`, injected into every page's `<head>`.

Every text field, label, field error, checkbox and radio takes its look from the shared classes below. A page stylesheet may add layout (`width`, `margin`, grid/flex placement) and nothing else. A page never defines its own field class or repaints a field's border, corner, fill, type, placeholder, focus, invalid or disabled look — that is how those values drift apart from page to page.

| Token | Value | CSS variable |
|---|---|---|
| Height | `48px` | `--input-height` |
| Padding | `12px` | `--input-padding` |
| Font size | `16px`; `14px` from 768px with a fine pointer | `--input-font-size` |
| Placeholder | Secondary ink (`--muted-foreground`) | `--input-placeholder` |
| Form gap | `20px` (24px from 768px) | `--form-gap` |

A field stays at 16px under a coarse pointer because iOS zooms into a focused field set smaller than 16px.

| Class | Is |
|---|---|
| `.form-field` | Optional column holding a label, its control and its error, 8px apart |
| `.form-field__label` | The visible label |
| `.form-field__error` | The error line under the control; hidden while empty |
| `.form-field__message` | A neutral status line under the control |
| `.form-input` | A text field |
| `.form-input--multiline` | A `textarea`: at least 2.5 field-heights tall, resizing vertically |
| `.form-input--within` with `.form-input__control` | The field box drawn around a borderless inner control and its neighbours (a read-only copyable input and its Copy button); focus on the inner control shows on the box |
| `.form-input--select` with `.form-input__chevron` | A native `<select>` as the inner control of a `.form-input--within` box: no native arrow, 48px end padding, and a 20px `chevron-down` in `--foreground`, 12px inside the border, that takes no clicks. The option list stays native. |
| `.form-input--leading-icon` | A field whose text starts 40px in, after a 20px `--foreground` glyph (the readlist search) |
| `.form-input--cta-ring` | A marketing field paired with a CTA, focused with the button's outline (see [Quiet controls](iconography/buttons.md#quiet-controls)) |
| `.form-choice` | A checkbox or radio |
| `.form-choice--mark` | The radio ring inside a pressed button; the button's `aria-pressed` draws the dot |

- **A text field** has a 1px `--input` border, `--radius` corners and a `--background` fill — in dark mode that fill sits one step below the `--card` around it, so the field reads as a well. Placeholder text is `--input-placeholder`. The field is named by a visible label above it (14px/500 `--foreground`, 8px gap) or by the heading of the card it sits in; a placeholder is never its only name. A search field the design draws without a label is named by an `.sr-only` label inside a `role="search"` form.
- **Invalid** is `aria-invalid="true"` on the control, which turns its border `--color-error`; one 12px/500 `--error-text` sentence sits 8px below, tied to the control by `aria-describedby` (announced with `role="alert"` when it appears without a page load).
- **A neutral field message** (`.form-field__message`) uses the same 12px/500 metrics in `--muted-foreground` for a status line under a field that reports something other than invalid input, such as the readlist import flash. It is never wired to `aria-describedby`.
- **Disabled** fills the field `--muted` with `--muted-foreground` ink, a `not-allowed` cursor and full opacity; inside a `.form-field` its label greys with it. **In flight:** see [Buttons](iconography/buttons.md#disabled-and-in-flight).
- **Controls use the body face.** The browser gives `input`, `select`, `textarea` and `button` a system font, so every control declares `font: inherit` (or `font-family: inherit` beside its own size, as `.btn` does), or it shows its value and placeholder in a different face from its label.
- **An input paired with a button shares the button's height.** `.form-input` carries `height: var(--input-height)`; pair it with a default (L) button, which is 48px — the same as `--input-height` — so the row lines up with no modifier; the input keeps `padding: var(--input-padding)`. Because `box-sizing: border-box` is global, an explicit shared height is the only reliable equaliser — never fake it with padding or font-size, and never re-declare the height on the button.

Below 600px a field-and-button row stacks when its field would otherwise clip its placeholder, as the import page's from-link card does. The field takes the full width, and the button drops below it at its own width, 16px under, keeping the L button's 48px height. The one exception is the [readlist search row](components/search-and-filters.md#search-and-filters), which keeps its field and icon button on one line.

#### Checkboxes and radios

`.form-choice` is an 18px box with a 1.5px `--foreground` edge — neutral ink, never amber. A checked checkbox fills `--foreground` under a `--background` check, and an indeterminate one carries a `--background` bar instead. A radio is a ring whose checked state is an 8px `--foreground` dot. Both draw the 2px `--ring` outline on `:focus-visible`. A pressed button that stands for one option of a choice draws the same ring as a `.form-choice--mark` inside it, and its `aria-pressed="true"` draws the dot. A disabled choice takes the `--muted` fill with a `--muted-foreground` edge (a checked one fills `--muted-foreground`), at full opacity with the `not-allowed` cursor, and the label wrapping it greys to `--muted-foreground` with it — the same values as a disabled field.

### App Pages

An **app page** is where a reader manages their library, imports or settings — as opposed to reading an article or a marketing page. App pages (signed-in pages and logged-out tools) are built in three surface layers:

| Layer | Light | Dark | Token | Holds |
|---|---|---|---|---|
| **Chrome** | `#FFFFFF` | `#121212` | `--background` | The sticky header; the fill of a text input |
| **Canvas** | `#F7F8FA` | `#1A1A1A` | `--muted` | The full-bleed ground of the page. Uncarded controls (side-rail navigation, tab strips, pagination, page-level alerts) sit directly on it |
| **Card** | `#FFFFFF` | `#222222` | `--card` | Every content panel, enclosed by `1px solid var(--border)` and no shadow |

The page's `main` grows (`flex: 1 1 auto`) so the canvas meets the bottom of the page — a signed-in page has no footer — or the guest footer, with no `--background` strip between. This does not apply to marketing pages (section bands).

**Layout tokens.** Page geometry comes from six tokens stepped at the breakpoints. They are declared on `:root` outside the theme maps, because a theme-pinned `body` re-declares every theme token and would freeze a stepped value at its phone size.

| Token | Below 768px | 768–1199px | From 1200px |
|---|---|---|---|
| `--frame-max-width` (content width) | 1200px | 1200px | 1200px |
| `--page-gutter` | 20px | 24px | 48px |
| `--page-top` | 20px | 24px | 32px |
| `--stack-gap` (between blocks in a column) | 24px | 24px | 32px |
| `--column-gap` | 24px (inert while the page is one column) | 24px | 48px |
| `--header-inset` | 20px | 24px | 48px |

- **The frame is measured on the content, not the outer box.** A frame container is `max-width: calc(var(--frame-max-width) + 2 * var(--page-gutter)); padding-inline: var(--page-gutter)`, so at 1440px its content runs from x=120 to x=1320. A single-column page with its own measure does the same with that measure: `max-width: calc(<measure> + 2 * var(--page-gutter))`, so the gutter never eats into the column. The header and the announcement bars are full-bleed (the header pads by `--header-inset`); only a full-bleed band paints wider than the frame (the page canvas, a hero, a muted marketing band). The footer keeps its centred 1000px column.
- **Workspace columns.** When an app page needs more than one column, it uses one set of tracks from `min-width: 1024px`: a `220px` navigation rail, a `minmax(0, 1fr)` main column, a `300px` side column, `var(--column-gap)` (24px) apart, `align-items: start`. From 1200px the design's wider tracks apply: a `230px` rail and a `340px` side column around the fluid main, `--column-gap` (48px) apart. The container uses the frame formula above and pads its top by `--page-top`. The readlist page sets these tracks; other pages set theirs in their own pass. The main track is always `minmax(0, 1fr)` — never the design's fixed 534px — so every width from 431 to 1439px stays fluid. The readlist caps that track at `--reader-max-width` so a card's excerpt runs a full measure: from 1200px its frame widens to fit the rail, the capped main and the side column, and when every side panel is hidden the main column takes the side track too. A page with no side panels keeps the tracks and leaves the side column empty so its rail and main line up with the rest of the workspace. A single-purpose page (a form, a settings page at 880px) stays one column at its own measure inside the frame — it does not grow a rail to match — unless a side card explains the tool, as on the import page. There the main and side tracks take the widths above with no navigation rail, the side card's top is level with the page title, and the review step keeps the tracks with the side column empty. Side-column panels stack `24px` apart at every width.
- **Reader columns.** A reader (the owner reader, `/view` and the readlist's reader skeleton) has two layouts from `min-width: 1024px`, and its rail picks between them. When the rail shows a card (the table of contents, Article history, past reads; a hidden table of contents does not count), the frame holds two tracks `var(--column-gap)` apart: a `minmax(0, 1fr)` column from the frame's left edge and a `340px` rail, which makes the column 612px at 1024, 716px at 1200, 796px at 1280 and 812px from 1296. When the rail shows no card, the column is centred between two matching lanes of at least `112px`, the Top button's width: a `minmax(0, 812px)` column that narrows only where a lane could not hold Top — 704px at 1024 and 784px at 1200. The reader skeleton always takes the two tracks, because the reader that replaces it shows Article history. Top sits at the start of the rail, under its cards, or at the start of the right lane. From 1024px the Next Read card takes the column's second row, 32px under the taller of the column and the rail. `/view`'s CTA bar keeps the centred tracks, so its edges line up with the card's only when the rail shows no card. Its two buttons, at most 400px each and 8px apart, centre in those tracks and share them equally where the tracks are narrower than 808px. Below 1024px the page is one centred column of at most 812px, and the Next Read card, then Article history, follow the column one `--stack-gap` apart, at its width. Past reads moves into the article card under the summary instead. The article card pads `32px`, or `20px` at `max-width: 600px`.
- **Columns collapse by urgency, not source order.** Below 1024px the tracks fold into one `minmax(0, 1fr)` column (`20px` gap). The import page folds in source order instead, with its side card straight after the active panel, and keeps `--stack-gap` between blocks, because the fold is its main column's own stack. On the readlist, the interleaved main and side columns dissolve (`display: contents`), and `order` places navigation first (the one-row readlist switcher), then any notice the reader must act on, then the alerts and save feedback, then the setup guide, then Add link (All only, wrapped onto its own row above the tabs, at their trailing edge), then the tabs and list. An incomplete guide folds to its progress row by default on iPhone; no-client and success cards take the same position. A time-critical notice never falls below a long list on a phone. `order` moves only the painted position — keyboard and screen-reader order still follow the source, so reorder only self-contained panels. An expanded guide in a desktop browser under 1024px paints above the list but is reached after pagination in keyboard order; this is the accepted platform-based fold default. The preferences page folds the same way: its alert, then the setup guide, then its tabs, purpose panel and Inboxes.
- **Gutters grow; cards don't.** An app page container pads `var(--page-top) var(--page-gutter) 64px`, and 80px at the bottom from 1024px, stepping at the breakpoints (never a fluid `clamp()`); the bottom stays 64/80px because the design's frames are cropped artboards. Editorial and marketing bands (home, landing pages, legal, the blog, the embed page) take `--page-gutter` inline and keep their own vertical rhythm. Card padding is the same at every width — a list row `20px`, a content card `20px 24px` (`20px` all round for a side-column panel), a settings row `24px`, or `24px` all round when it holds a field-and-button row or a dropzone (the import page's panels, per the Final frames), the reader's article card `32px`, and a header strip `14px` vertical. An inline alert has a 16px inset (1px border plus 15px padding). A dense panel may tighten to `20px` at `max-width: 600px`, but no card grows on desktop. A dialog does grow (24 → 32px at 768px), as does a lone centred container that is the whole page's content (see [Layout Principles](#layout-principles)).
- **Breakpoints.** Lay out on four widths. Where a width is used in both directions, the `max-width` query sits one pixel below its `min-width` twin.

  | Name | Query | What changes |
  |---|---|---|
  | Phone | `max-width: 600px` | Last tightening step: a dense panel's padding may drop 24 → 20px; tab strips split the width equally; optional decoration hides |
  | Tablet | `min-width: 768px` (inverse `max-width: 767px`) | Header nav bar replaces the drawer; `--form-gap` 20 → 24px; dialog padding 24 → 32px; `--page-gutter`, `--page-top` and `--header-inset` 20 → 24px; announcement bars leave the phone gutter |
  | Columns | `min-width: 1024px` (inverse `max-width: 1023px`) | App pages go one column → rail / main / side; a rail may stick; the page's bottom padding 64 → 80px |
  | Frame | `min-width: 1200px` | The design's full grid applies; `--page-gutter`, `--header-inset` and `--column-gap` step to 48px and `--page-top` and `--stack-gap` to 32px; the header centres the library nav |

  A component query off this table must answer an observed collision, not a guess.

### Layout Principles

- **Reading text maxes out at `--reader-max-width` (680px).** Prose-led pages (the blog index, marketing copy) cap their column at the token, never a literal `680px`. The reader's measure is its article card's content box instead, at most 746px, and a blog post sits in the same card at `--reading-main-max`. A page of cards has no reading measure of its own: its main column is fluid (`minmax(0, 1fr)`) inside the frame, and card copy stays short (a title, a clamped excerpt, a one-line lede). The readlist's main column stops at the reading measure (see [App Pages](#app-pages)).
- **One measure per page column.** Stacked sections in a column — headings, prose, tab bars, input rows — share one content measure; never cap prose at a per-section `max-width` (e.g. `56ch`) while sibling controls run full-width. The one exception is a centred composition inside a card (an empty state), which may cap its message at ~56ch so centred lines stay short; the cap belongs to the composition, not the column. Left-aligned prose never takes a per-section cap.
- **Fixed-count card rows use an explicit column count** — the item count or a clean divisor of it. `auto-fit`/`minmax` can strand a lone card; reserve it for genuinely variable-length lists.
- **Container padding growth is only for a lone centred container.** Growing padding to 32–40px at `min-width: 768px` applies to a container that is the whole page's content (the sign-in card, a single-column form) and to dialogs. Cards in a multi-card app layout keep a fixed inset at every width — the frame's columns and gaps take up the extra width. The OAuth consent card is the exception: it sits top-aligned `--page-top` under the header, 534px wide, with 24px padding at every width. The other sign-in cards keep the centred, growing container until they are redesigned.
- **Generous whitespace is intentional.** Don't fill space because it's empty.
- **Align to grid.** Layout spacing uses the 4px base; 2px half-steps are allowed inside a component (see [Spacing Scale](#spacing-scale)). Avoid arbitrary pixel values.
- **Mobile first.** Every feature design starts with the smallest viewport.
- **Sticky header** with `position: sticky`, `top: var(--banner-area-height)` (it rides under the fixed announcement bars), a `1px solid var(--border)` bottom edge, and a `--background` fill whatever the page ground — on a `--muted` app page it stays a `--background` band and the border does the separating. **Anything else that sticks offsets from the measured chrome:** `top: calc(var(--banner-area-height) + var(--header-height) + <gap>)`, where the gap is the layout's own top padding, with the same fallbacks the shell's `scroll-padding-top` uses. Never hardcode the header height; the shell keeps `--banner-area-height` current as the banner wraps and measures `--header-height` when the header renders. A sticky column stops sticking once it folds into the single column. The readers show no header: the web reader's toolbar scrolls with the page, and the chromeless reader pins its toolbar at `top: 0` on a full-width `--muted` strip.
- **Section background rhythm (marketing).** Long marketing pages alternate `--background` and `--muted` section bands so no two adjacent content sections share a fill; every muted band carries a `1px var(--border)` top/bottom rule. `--card` is a card-only surface, never a full-bleed section background.
- **An alert in a column of cards is a card.** It is fully enclosed with `--radius`, its variant's opaque tint and mark border, and a 16px content inset (1px border plus 15px padding). It sits in the stack like any sibling. The full-width-banner rule below stays for edge-to-edge banners, which have no border of their own.
- **Full-width status / alert banners** separate from the block below with `lg` (24px) minimum — never the `md` inter-element gap, and never a `clamp()` that collapses on the smallest viewport where a full-width alert most needs the separation.
- **The page scrolls down only, from 320px up.** No width from 320px to desktop scrolls sideways; content wraps. A text-bearing grid track is `minmax(0, 1fr)`, never a bare `1fr`; a text-bearing flex child sets `min-width: 0`; reader-supplied text breaks with `overflow-wrap: anywhere`, except in a saved article's table laid out as a grid, whose cells break with `break-word` so no column is narrower than its longest word. A row of controls (tabs, pagination) wraps rather than becoming a horizontal scroller. Only preformatted code scrolls sideways, in its own box. Tables reflow to stacked cards, and a saved article's table is a grid only when its columns fit the article column (see the [web skill](../.claude/skills/web/SKILL.md)).
