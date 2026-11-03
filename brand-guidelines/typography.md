## Typography

> **Source of truth:** `src/packages/web-shell/src/base.styles.ts` (the `--font-sans` / `--font-serif` tokens and the body font), `src/packages/web-shell/src/base.template.ts` (font loading)

### Typefaces in Use

| Role | Typeface | Weight | Where defined |
|---|---|---|---|
| **Body, UI and product headings** | `--font-sans` → `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (Inter from Google Fonts, 400–700) | 400, 500, 600, 700 (see [Typography Rules](#typography-rules)) | `base.styles.ts` → `LIGHT_THEME_VARIABLES`, applied on `body` in `BASE_RESET_STYLES`; `base.template.ts` preload |
| **Brand serif** | `--font-serif` → `Georgia, "Times New Roman", serif` | 700 (Georgia ships regular and bold only, so 600+ renders its bold) | The header wordmark (`.header__brand`) and display headings on editorial and marketing pages (home, landing pages, blog). The extension popup's wordmark takes it too |
| **Reader view** | `--font-sans` | 400 body, 700 title | Article text in reading mode: a 16/1.5 body under a 24/700/1.5 title — this is the user's space |

### Type Scale (product UI)

Panels, cards, lists and dialogs have **no display type**. Product text takes one of four size tokens, and a role picks its token — never a pixel literal:

| Token | Value |
|---|---|
| `--text-xs` | `0.75rem` (12px) |
| `--text-sm` | `0.875rem` (14px) |
| `--text-md` | `1rem` (16px) |
| `--text-lg` | `1.125rem` (18px) |

| Role | Token | Weight | Ink |
|---|---|---|---|
| Item title in a list · dialog title | `--text-lg`, ~1.55 line (28px) | 600 | `--foreground`; an item title hovers to `--primary-text` |
| Empty-state title | `--text-lg`, 1.3 line | 600 | `--foreground` |
| Drawer title | `1.25rem` (20px, no token), 24px line | 700 | `--foreground` |
| Import page title | `1.25rem` (20px, no token), 1.3 line | 700 | `--foreground` |
| Import page lede | `--text-md`, 24px line | 400 | `--foreground` |
| Import row title · FAQ question | `--text-md` | 500 | `--foreground` |
| Settings page title | `1.5rem` (24px, no token), 1.2 line | 700 | `--foreground` |
| Settings page lede | `--text-md`, 24px line | 500 | `--muted-foreground` |
| Settings section heading | `--text-lg`, 24px line | 700 | `--foreground` |
| Settings row description | `--text-md`, 24px line | 400 | `--muted-foreground` |
| Panel / card heading · rail heading | `--text-md` | 600 | `--foreground`; a rail heading `--ink-rail-heading` |
| Tab label | `--text-md` | 600 open · 400 others | `--foreground`; inactive tabs `--ink-tab-inactive` |
| Announcement bar | `--text-md`, 24px line | 600 | white on `--announcement-bg` |
| Button label | `--text-md` (S: `--text-sm`, 20px line) | 600 | per [variant](iconography/buttons.md#variants) |
| Nav, menu and rail row | `--text-sm` | 500 | header: `--ink-nav-current` / `--ink-nav-inactive` |
| Metadata · card body | `--text-sm` | 400 | `--ink-meta` |
| Alert title | `--text-sm` | 600 | `--foreground` |
| Alert body | `--text-sm` | 400 | `--foreground` |
| Field label | `--text-sm` | 500 | `--foreground` |
| Field error | `--text-xs` | 500 | `--error-text` |
| Pagination | `--text-md` | 500 info and numbers · 400 Previous/Next · 600 current | `--ink-pagination`; the current page `--foreground` |
| Chip · badge | `--text-xs` | 500 | per [tone](components/chips-tags-and-badges.md#chips-tags-and-badges) |
| Filter chip | `--text-md` | 500 | `--foreground` |
| Tab badge | `--text-sm` | 600 | `--primary-foreground` on `--primary` |
| Large tag | `--text-sm` | 500 | per [tone](components/chips-tags-and-badges.md#chips-tags-and-badges) |
| Status chip | `--text-xs` | 600 | `--foreground` |
| Figure (stat tile) | `--text-md` | 600, tabular | `--foreground` |
| Stat tile label | `--text-sm` (18px line) | 400 | `--muted-foreground` |
| Plan price | `1.5rem` (24px, no token: with the drawer, import page and settings page titles, one of four product roles above `--text-lg`) | 600, tabular | `--foreground`; its "/month" unit `--text-sm`/400 `--foreground` |

**13px, 15px and 17px are off the scale.** The designed components (list rows, empty states, tabs, dialogs, menus, alerts, the rail) move onto these roles one component at a time; where a component file under [Components](../BRAND_GUIDELINES.md#components) still quotes 13, 15 or 17px, or an ink or weight the tables here replace, that is the component's value today, and the next change to that component moves it to its role here. Stylesheets for pages with no design already name the tokens, with no 13/15/17px literal.

**Ink roles.** A role that has its own ink names a role token, so a later design change moves one value:

| Token | Resolves to | Used by |
|---|---|---|
| `--ink-nav-current` | `--foreground` (16.32:1) | the header's current destination |
| `--ink-nav-inactive` | `--muted-foreground` (6.22:1) | every other header destination |
| `--ink-meta` | `--foreground` | metadata rows |
| `--ink-tab-inactive` | `--foreground` | an inactive line tab |
| `--ink-rail-heading` | `--muted-foreground` | a rail heading |
| `--ink-pagination` | `--muted-foreground` | pagination text at rest |

Buttons and inputs take their sizes from their own tokens (see [Buttons](iconography/buttons.md#buttons) and [Form Inputs](spacing-and-layout.md#form-inputs)). Nothing a reader must read goes below 12px; 11px is left to all-caps micro-labels, avatar initials (the account page's 48px disc sets them at 18px) and the footer copyright. Display sizes of 1.25rem and up on editorial and marketing pages (home, landing pages, the blog, the embed page) keep their own scale. A blog post's body sets its text like the reader's article body, `--text-md`/400/1.5. The reader's article sets its own type: the title 24/700/1.5, the header's meta row `--text-md`/400 on a 24px line in `--ink-meta`, body text `--text-md`/400/1.5, an `h1` or `h2` 20/700, an `h3` `--text-lg`/600, an `h4` `--text-md`/600, table cells at `--text-md` with a 600 header, and a stacked table cell's label at `--text-sm`/600 in `--muted-foreground`.

### Typography Rules

- **Product headings are sans; the serif is the display voice.** Every heading in the product's working area — panel and card titles, rail headings, list headers, empty states, alerts, dialog titles — uses `var(--font-sans)` at weight 600 in `--foreground`, except where a design draws another weight: the [Next Read card's](components/suggestion-card-next-read.md#suggestion-card-next-read) heading at 500, the import page's title at 700 and its FAQ questions at 500, and the settings page's title and section headings at 700. This covers **every page a reader operates**, signed-in pages and logged-out tools (import, login) alike. `var(--font-serif)` is the display voice: the wordmark and display headings on editorial and marketing pages (home, landing pages, blog). A saved article's title or an email subject shown in a list is sans, like the rest of the list. Declare the font on the heading's own selector so the choice is explicit, not inherited — a heading that inherits the body sans is a drift, not a choice, and the serif stack must never be inlined (one source of truth, like colours).
- **Weight carries hierarchy.** Inter is loaded at 400–700, and each weight has one job. **400** is prose, excerpts, metadata, neutral labels, and an inactive line tab. **500** is navigation a reader moves through (header, rail and menu rows), field labels, tags and badges, the import page's row titles and FAQ questions, and the settings page lede. **600** is headings, titles, counts, button labels, announcement bars, status chips, the tab badge, stand-alone figures (the 16/600 stat tile, the 24/600 plan price), and the open tab or current page number. **700** is the wordmark, avatar initials, the import page title, and the settings page title and section headings. Never set **800** — Inter is not loaded at that weight. Where a weight step does the job, do not reach for a bigger size.
- **Sizes are fixed per role at every width.** A phone gets the same sizes as a desktop and the layout reflows; there is no phone step-down (the design explorations' 18→14, 16→14 and 14→12 steps are not built).
- **A heading brings its own lede.** A panel title (16px/600, `--foreground`) is followed 2–8px below by a lede one or two steps smaller (13–14px/400, `--muted-foreground`); a [settings row's](components/settings-pages.md#settings-pages) description is one exception, 16px/400 `--muted-foreground` 2px under its 16px/600 title, and the OAuth consent card's signed-in line is another, 16px/400 `--muted-foreground` 4px under its 16px/600 "Account" heading, with the email at 16px/600 `--foreground`. Empty states use 18px over 14px. An alert's title and message are 14px/600 over 14px/400, both `--foreground`; a dialog body uses 14px/400 `--muted-foreground`. A [pipeline panel's](components/loading-states.md#loading-states) description is 14px/400 `--foreground`, and so is the [table of contents'](components/disclosure-cards.md#disclosure-cards) empty state, under its 16px/600 `--foreground` title.
- **A page with persistent navigation names its place through that navigation, not a display title.** Where a rail or tab selection already shows where the reader is, the page renders no visible `h1`: the document `<title>` names the place (`All — Readplace`), and each panel's own `h2` starts the outline. Tabs that pick how to do one task, as the import page's Paste a link and Upload a file do, name no place, so that page keeps its `h1`.
- **Legibility is non-negotiable.** This is a product about reading. If a type choice looks good but reads poorly, reject it.
- **Line-height.** Body text inherits `1.6` (`BASE_RESET_STYLES`), and a single-line metadata row keeps it, except the reader header's meta row, which takes the reader's 24px line. An item or dialog title uses a 28px line at 18px; no heading goes below `1.3`, except the readlist subscription notice title (16px/600), which sits on a 20px line (`1.25`), the design's panel-title box, the settings page title (24px/700), which sits on a `1.2` line, and the OAuth consent card's title and "Account" heading (16px/600), which also sit on a `1.2` line. Supporting copy running several lines may tighten to `1.5`–`1.55`; dialog body copy and the OAuth consent card's body use 14px on a 22px line. Empty-state text also sets 14px on a 22px line, except a rail card's compact empty state, which takes the design's 24px line. Generous spacing is a feature, not a waste of space.
- **Never use all-caps** for more than short micro-labels. Never for headings or body text (see also [Capitalisation](voice-and-copy.md#capitalisation)).
- **International support:** Typefaces must include full Latin Extended character sets (Portuguese, accented characters). The founder is Brazilian-Australian — this is table stakes.
- **Avoid trendy typefaces.** If it will look dated in 2 years, don't ship it.
- **Orphan control.** Prose body copy uses `text-wrap: pretty`; multi-word headings use `text-wrap: balance`. Scope both to the prose/heading selectors — never on `body`. A single word must never be stranded on a text block's last line. A left-aligned list-item title that shares its row with a menu or thumbnail uses `pretty`, not `balance` — `balance` would shorten its first line and leave a gap beside the menu. **Exceptions:** an intentional keyword focal point is a designed single-word line; a centred title that should read as a top-wide pyramid uses `pretty`; single-word *headings* (`Cookies`, `Contact`) are acceptable when intentional (`balance` is a no-op on them).
- **One-word page titles get deliberate visual mass** — larger size, heavier weight, and/or negative letter-spacing so the whitespace beside them reads as intentional.
- **Long strings wrap; a metadata name truncates.** Text supplied by a reader or publisher (article titles, excerpts, readlist names, site names, URLs) must never push the page sideways at 320px. Titles, excerpts and names wrap mid-word (`overflow-wrap: anywhere`); a raw URL breaks with `word-break: break-all`. In a metadata row the variable-length parts (a publisher name, a sender name) each stay on one line and give way with `text-overflow: ellipsis`, carrying the full text in `title` — or the sender address, when the label is a catalogue name, with the newsletter's name and address a tap away in the sender popover — and a minimum flex basis (`12ch`) so neither collapses to a sliver. The reader header's names take their content as their basis instead, with no floor, so whole facts wrap first. Fixed parts (dates, read time) are `white-space: nowrap` and wrap to a second line before the name is crushed.
- **Tabular figures.** Figures that tick or are compared side by side (countdowns, stat tiles, live counters) set `font-variant-numeric: tabular-nums` so digits hold their width.
- **Tracking stays at the face's default.** Product text, headings and the wordmark included, sets no `letter-spacing`. The only exceptions are chrome: all-caps micro-labels (`0.06em`) and avatar initials (`0.02em`).
- **Nothing moves when a late value arrives.** A label filled in or changed in place (a tab count, a countdown, an in-flight button) keeps its footprint: reserve the width of its widest value, set changing figures tabular, hide an in-flight label with `visibility: hidden` rather than removing it, and keep the value on screen across an in-place update instead of blanking it.

### Highlight Words

A single highlight word inside a phrase can be recoloured with `--color-highlight` (warm amber `#c8923c` — the logo dot) to draw the eye without bolding, underlining, or changing size.

**Rules:**

- Use the same face as the surrounding text (`var(--font-serif)` in a serif heading, `var(--font-sans)` in body). The highlight is colour, not type.
- **No weight or size change.** Contrast does the work — bold would be shouting.
- **Never add space** between the default-colour prefix and the highlight word.
- One highlight per phrase. If two words need emphasis, pick the stronger one.
- The highlight is visible against navy, white, and muted surfaces. On the warm amber gradient it collapses — choose navy or another neutral there.

**Wordmark.** `Read<span class="header__brand-mark">place</span>`, set in `var(--font-serif)` at 16px/700 (`--text-md`) with normal tracking, beside the 30px mark with a 4px gap — a lockup about 120px wide, the same on phones, and the one place the serif appears in product chrome. Its halves take theme tokens, never literals: the stem is `--header-brand-stem` (navy `#2B3A55` light, `#E4E4E4` dark) and the tail is `--header-brand-tail` (`--color-brand` `#C8702A` light, `--color-highlight` `#D4A04A` dark). On the navy hero (`.header--transparent`) the stem turns `--color-on-brand` white and the tail `--color-highlight`. The wordmark splits the brand into a neutral stem and an amber tail — the pattern this highlight rule generalises.
