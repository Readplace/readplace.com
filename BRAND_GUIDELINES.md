# Readplace — Brand & Design Guidelines

> Internal reference for anyone building Readplace — developers, designers, contributors.
> Consult this before shipping UI, writing copy, or producing any public-facing asset.

---

## Brand Identity

**Tagline:** Read the Web, not the Slop.

Use this exact form on brand and user-facing surfaces — *Web* and *Slop* capitalised (the two nouns being contrasted), *the* and *not* lowercase, ending in a full stop. It is deliberate noun emphasis: not title case (*not* stays lowercase) and not sentence case (*Web* and *Slop* stay capitalised). Two intentional exceptions: the homepage SEO **keywords** meta uses the comma-free, all-lowercase `read the web not the slop` for keyword matching; and when the phrase runs **mid-sentence as prose** it follows that sentence's case (e.g. "…a place where you read the web, not the slop."). A standalone line or sign-off uses the canonical form above.

**What Readplace is:** A read-it-later app that saves articles, blog posts, and web pages for later reading. Born from a personal reading system refined over 10 years.

**What Readplace feels like:** A well-made tool shaped by daily use. A private reading nook in a home library — warm wood, good lighting, no distractions. Not a co-working space. Not a productivity dashboard. A quiet place that's yours.

### Brand Attributes

| Attribute | Means | Does NOT mean |
|---|---|---|
| Trustworthy | Reliable, transparent, proven over time | Corporate, institutional, stiff |
| Warm | Approachable, personal, human-built | Cutesy, childish, overly playful |
| Quiet confidence | Knows its value without shouting | Arrogant, flashy, "disruptive" |
| Crafted | Thoughtful attention to detail | Overdesigned, trendy, maximalist |
| Enduring | Built to last, not built to sell | Disposable, startup-y, growth-hacky |

---

## Logo

### The Icon

The icon is a serif **"&"** (ampersand) in white on a navy (`#2B3A55`) rounded square, its crossbar ending in a soft upturned palm on which a single warm amber (`#C8923C`) dot rests. The ampersand stands for *this and that*, *now and later*, *your articles and the time to read them*. The dot is the marker — the place you left off, the place you'll come back to.

The mark carries a second, quieter reading: the ampersand is a person sitting — one hand resting on the floor (the bowl and foot share one implied floor line), the other raised, holding the amber globe up to look at it. The globe is the web, read as it is. Both readings coexist; neither may be strengthened at the cost of the mark reading as a dignified ampersand first.

The glyph is **fixed `<path>` geometry** (Noto Serif Bold outlines, OFL-licensed, with the palm and floor edits from the July 2026 mark review). Never render the mark with a `<text>` element — the glyph shape would then depend on whatever fonts the rendering machine has installed, which is how the brand once shipped five different ampersands (Georgia, DejaVu, Liberation Serif, and two visitor-dependent SVGs) without anyone choosing them.

### Assets

Every raster asset is generated — never hand-rendered — by `projects/hutch/scripts/generate-brand-assets.mjs` from the vector sources of truth (`brandMarkSvg` in `@packages/web-shell`, `favicon.svg` — whose glyph a test holds equal to `brandMarkSmallSvg` in the same package — and the path-based lockup masters in `projects/hutch/brand/`). To change the mark, change those sources and re-run the script; do not edit or screen-render individual PNGs (screen renders bake the generating monitor's subpixel fringing into the brand).

| Asset | Sizes available | Location |
|---|---|---|
| **Favicon** | 16, 32 (dotless), 48, 96px + multi-entry `.ico` | `projects/hutch/static-assets/favicon-*.png` |
| **Apple Touch Icon** | 57–180px, opaque full-bleed (iOS applies its own mask) | `projects/hutch/static-assets/apple-touch-icon-*.png` |
| **Android Chrome** | 48–512px + full-bleed maskable variants | `projects/hutch/static-assets/android-chrome-*.png` |
| **Windows Tile** | 70, 150, 310×150 (lockup), 310px | `projects/hutch/static-assets/mstile-*.png` |
| **Social cards** | 1200×630 (OG), 1200×600 (Twitter) | `projects/hutch/static-assets/og-image-*.png`, `twitter-card-*.png` |
| **Extension icons** | 16–128px, light (white halo) + dark themes | `projects/browser-extensions/{chrome,firefox}-extension/src/icons/{light,dark}/icon-*.png` |
| **iOS mark + App Store icon** | 72–216px + 1024px | `projects/native-apps/ios/scripts/make-brandmark.sh`, `make-appicon.sh` |

### Usage Rules

- **Minimum clear space:** Maintain padding equal to at least the diameter of the amber dot on all sides of the icon.
- **Internal clear space (amended July 2026):** Inside the mark, keep ≥ 0.20 dot-diameters between the dot's rim and all glyph ink — **except the palm seat**, which is deliberately near-tangent (a 4.65-unit hairline seam at 512) so the globe rests *on* the hand at every size that carries the dot.
- **Size cutover:** The amber dot ships only at renders **≥ 33px**. Below that (the 16–32px favicon class) use the dotless small-size variant (`favicon.svg` geometry — glyph enlarged 12%, no dot), served on the web as `brandMarkSmallSvg` from `@packages/web-shell` or `/embed/icon-small.svg`. A dot at those sizes is a smudge that collides with the glyph.
- **Do not** rotate, skew, add drop shadows, apply gradients, or place on busy photographic backgrounds.
- **Do not** recreate or approximate the logo — always use the provided assets.
- **Do not** remove or reposition the amber dot, recolour the ampersand, or change the navy background fill.
- **Backgrounds:** The mark already contains its navy rounded-square tile — keep the full mark intact on both light and dark surfaces rather than swapping fills.
- **Keyline (part of the mark):** The tile carries a hairline white keyline (`#FFFFFF` at 40% opacity, ~1px rendered) stroked on its edge. It is present on every surface and alpha-composites against whatever sits behind the mark, so the navy tile stays delineated at ≥3:1 contrast on dark/navy surfaces (blog/web header in dark mode, extension popup, the navy hero, a dark browser tab strip) where an opaque navy tile would otherwise dissolve into the background. It is imperceptible on light surfaces (the tile is already ~11:1 there), so it is always on. **Do not** remove it, and never lighten the navy fill to compensate — the keyline is what makes the mark legible on dark, not a fill change.
- **`Readplace_Logo_only.svg` is not a web asset.** `projects/hutch/brand/Readplace_Logo_only.svg` is a tile-less navy ampersand kept only as source geometry for the iOS icon pipeline. It has no tile and no keyline, so on web or dark surfaces the navy glyph would vanish — never render it there. Use the full mark everywhere on the web (`brandMarkSvg` from `@packages/web-shell`, `favicon.svg`, or `/embed/icon.svg`), and its dotless small-size variant below the size cutover (`brandMarkSmallSvg`, or `/embed/icon-small.svg`).

---

## Colour Palette

> **Source of truth:** `src/packages/web-shell/src/base.styles.ts`

Every table below carries both themes. A stylesheet names a **role token** (`--primary`, `--foreground`, `--error-text`); the `--color-*` value beside it is what that role resolves to. Never hardcode a hex — reach for the role.

### Primary Colours

Amber is one hue at several lightnesses, and each lightness has one job. Pick the role token, never the hex.

| Role | Light | Dark | CSS variable | Usage |
|---|---|---|---|---|
| **Amber fill** | `hsl(27 65% 41%)` | same (pinned) | `--primary` | The fill of every amber CTA. The lightest step of the hue that carries white `--primary-foreground` at ≥4.5:1 (4.61:1). Not ink on a surface |
| **Amber fill, pressed** | `hsl(27 65% 33%)` | same (pinned) | `--primary-fill` | Hover/active of an amber fill; 6.49:1 under white |
| **Amber ink** | `#A85A1E` | `hsl(27 65% 58%)` | `--primary-text` | Every amber word or small amber mark on a surface: links, a selected navigation row, a title's hover, the unread dot, a work-in-flight mark, a secondary button's label. 5.06:1 on white, ~6:1 on the dark card |
| **Amber tint** | `hsl(27 30% 95%)` | `hsl(27 15% 18%)` | `--secondary` | The ground for amber ink (see [Colour Rules](#colour-rules)) |
| **On-dark amber ink** | `hsl(27 65% 35%)` | same (pinned) | `--secondary-foreground` | The label of a white `.btn--on-dark` |
| **Brand amber** | `#C8702A` | `#D4833A` | `--color-brand` | Non-text marks only: a control's outline, an illustration's accent stroke, the light-theme wordmark tail (large text, 3.62:1). 3.62:1 on white, so never body words and never a button fill |
| **Brand dark** | `#A85A1E` | `#E89A55` | `--color-brand-dark` | The palette value behind light `--primary-text`. Never referenced directly — it lightens in dark, so as a hover fill it would invert |
| **Brand light** | `#F5E6D3` | `#3D2A18` | `--color-brand-light` | A tint behind **neutral** ink only, never a ground for amber ink (4.13:1) |
| **Highlight** | `#C8923C` | `#D4A04A` | `--color-highlight` | Highlight words, the wordmark tail on dark and on navy, an illustration's glow |
| **Focus ring** | `hsl(27 65% 47%)` | `hsl(27 65% 52%)` | `--ring`, `--ring-shadow` (15% / 25% alpha) | Focus indication only |
| **Navy** (Secondary) | `#2B3A55` | `#2B3A55` (pinned) | `--color-secondary`; ink twin `--color-secondary-text` (`#2B3A55` / `#8FA3C8`) | Navy *fills*: hero background, the announcement bars above the header, the manifest/tile colour, light-theme `theme-color`, the extension icon background and active states, and the light-theme wordmark stem. Navy *ink* on a surface uses `--color-secondary-text`, never `--color-secondary` (1.39:1 on the dark card) |
| **Avatar** (identity) | `#7C5CE6` | `#8F7AF0` | `--color-avatar` | The fill of the signed-in account's initials disc, and nothing else. It marks a person, not a state or action — never a link, button, status or decoration. A deliberate exception to the no-high-saturation rule. White initials are 4.64:1 light but 3.38:1 dark, so it carries only decorative (`aria-hidden`) initials, never text a reader must read |

### Neutrals

| Role | Light | Dark | CSS variable (role) | Usage |
|---|---|---|---|---|
| **Background** | `#FFFFFF` | `#121212` | `--color-background` (`--background`) | The header band, a text input's fill, the reader surface, marketing `--background` bands |
| **Surface** | `#F7F8FA` | `#1A1A1A` | `--color-surface` (`--muted`) | The ground of an app page that lays out cards; muted marketing bands; anything nested inside a card (tiles, progress tracks, chips, a quiet control's hover fill) |
| **Surface Elevated** | `#FFFFFF` | `#222222` | `--color-surface-elevated` (`--card`) | Every card and panel; dropdown menus; dialogs |
| **Border** | `#E2E5EA` | `#2E2E2E` | `--color-border` (`--border` / `--input`) | Card edges, dividers, input borders, subtle separators |
| **Text — Primary** | `#1A202C` | `#E4E4E4` | `--color-text-primary` (`--foreground`) | Body text, headings, titles |
| **Text — Secondary** | `#5A6170` | `#9BA1AE` | `--color-text-secondary` (`--muted-foreground`) | Supporting copy: ledes, excerpts, metadata and timestamps, alert bodies, inactive tabs, an inactive pagination link, an already-read item's title, disabled text |
| **Text — Muted** | `#8C919D` | `#6B6B6B` | `--color-text-muted` | **Marks only, never words.** ~3:1 in both themes, under the 4.5:1 floor. Input placeholders, and a decorative mark on a white ground (3.16:1). Never a timestamp, metadata, disabled text, or a meaning-bearing icon |
| **Footer Background** | `#1A1A1A` | `#0D0D0D` | `--footer-bg` | Site footer |

A card differs from the `--muted` ground by only ~1.1:1, so a card always carries `1px solid var(--border)`. The border draws the card, not the fill. In dark mode the header (`--background`), the canvas (`--muted`) and a card (`--card`) each step lighter, so elevation reads from lightness rather than a shadow.

### Functional Colours

| Role | Light | Dark | CSS variable | Usage |
|---|---|---|---|---|
| **Error mark** | `#C45C5C` | `#D46B6B` | `--color-error` | Border of an errored field or an error notice; a red icon that needs only 3:1. Never words, never a fill (white on it is 4.17:1 light, 3.43:1 dark) |
| **Error ink** | `hsl(0 43% 50%)` | `hsl(0 43% 68%)` | `--error-text` | Error words: a field message, a status chip's label, a destructive menu row on hover (5.20:1 on white, 5.85:1 on the dark card). Flips *lighter* in dark, so it is never a fill |
| **Error tint** | `hsl(0 43% 56% / 0.10)` | `hsl(0 43% 56% / 0.15)` | `--error-bg` | Ground of an error notice, an error chip, a destructive row's hover |
| **Error fill** | `hsl(0 43% 52%)` (hover `hsl(0 43% 44%)`) | same (pinned) | `--error-fill`, `--error-fill-hover`, `--error-foreground` | The solid red of a destructive *surface* — the confirm button of a delete dialog. Pinned in both themes like `--primary-fill`; carries `--error-foreground` at 4.85:1 (6.34:1 on hover) |
| **Success mark / ink** | `#3D8B6E` / `hsl(158 39% 35%)` | `#4A9F7F` | `--color-success`, `--success-text`, `--success-foreground` | `--color-success` fills a shape whose mark needs 3:1 (a progress bar, a completed step's disc); `--success-text` is success words and a check beside words (4.98:1 on white); `--success-foreground` (white) is a mark on a `--success` fill |
| **Warning** | `#C8923C` / `--warning-bg` `hsl(37 56% 51% / 0.12)` | `#D4A04A` / `hsl(37 62% 56% / 0.18)` | `--color-warning`, `--warning-bg` | `--color-warning` is a wordless mark or fill: `--foreground` on it is 5.93:1 light but 1.85:1 dark, so never words, and never a lone boundary on white (2.75:1). A warning that carries words sits on the `--warning-bg` tint under `--foreground` |

Red words (`--error-text`) on `--error-bg` clear 4.5:1 only over a `--card` (4.61:1 light, 4.95:1 dark); over the `--muted` canvas they fall to 4.35:1, so an error notice on the canvas keeps its words neutral. There is no `Info` token — informational banners reuse the navy or neutral surfaces.

### Colour Rules

- **Never use pure black** (`#000000`) for backgrounds or text. Use the dark neutrals above.
- **Never use Pocket red**, Readwise yellow, or neon/high-saturation accents. The one saturated hue is the identity `--color-avatar`.
- **A fill that carries a label is pinned; ink on the page follows the page.** A filled control carries its own label, so its fill must not move when the page darkens: `--primary`, `--primary-fill`, `--error-fill`, `--error-fill-hover` and the navy `--color-secondary` hold one value in both themes, and so do the inks on them (`--primary-foreground`, `--error-foreground`, `--secondary-foreground`, `--color-on-brand`). A word or mark painted straight onto a surface needs the opposite — lighter as the page darkens — so every hue has a page-following ink token: `--primary-text`, `--error-text`, `--success-text`, `--color-secondary-text`. Never paint words or icons with a pinned fill token, and never fill a labelled control with an ink token (it would invert in dark). Tints (`--secondary`, `--error-bg`, `--warning-bg`) and surfaces follow the page.
- **Dark mode is not an inversion.** Colours adapt to slightly warmer, lighter variants — it doesn't simply flip to white-on-black. Test every pairing against both backgrounds and against the surface actually behind the ink (a translucent tint composited onto its ground).
- **Amber ink sits on `--secondary`, never on `--color-brand-light`.** Any amber-tinted ground carrying amber words or an amber icon (a secondary button, a selected navigation row, a toggle at rest) fills with `--secondary`, which carries `--primary-text` at 4.55:1 light / 5.06:1 dark. `--primary-text` on `--color-brand-light` is 4.13:1 — under the floor. `--color-brand-light` may tint only a ground whose content is neutral ink.
- **Navy words or icons on a surface use `--color-secondary-text`** (`#2B3A55` / `#8FA3C8`). `--color-secondary` is a pinned navy *fill*; on the dark card it measures 1.39:1.
- **State colour is one vocabulary.** Unread and to-do are amber (an 8px CSS dot in `--primary-text`). Done is green (a check in `--success-text` beside words, or a white check on a `--success` fill where the state is a shape). Work in flight is amber ink (a spinning loader or pulsing dot). The current step of a sequence is neutral `--foreground`. A done item's title dims to `--muted-foreground`. Red and green keep their error/success meaning everywhere except a [metadata row's](#lists) fixed per-fact tint.
- **Inline text links use one token — `--primary-text`.** Light `--primary` is a fill, not a link colour; the link token is the darker amber that clears the floor (5.06:1 light, ~6:1 on the dark card). Do not introduce a third amber for a link, and do not redeclare link colour per block. Emphasis inside a link comes from weight (`<strong>`), never a different hue. There is no global bare-`<a>` reset, so an unstyled link renders browser-default blue — that is a styling gap, not a choice; every body-copy link sets `color: var(--primary-text)`. Links that make up **list UI** (a row title, a source name, a sort control, a page number) are not body copy — they rest in their text-role colour and turn amber or `--foreground` only on hover (see [Components](#lists)).
- **Reading surfaces stay neutral.** Amber appears in chrome and UI — never behind article text. Article content sits on `--background` (light) or dark grey (dark).
- **Hero gradient:** `linear-gradient(135deg, #2B3A55 0%, #1E2A40 100%)` — a deep navy gradient mirroring the logo tile. Warm amber highlights (`--color-highlight`) sit directly on it.
- **Contrast floors.** Words clear 4.5:1, or 3:1 at 24px, or 3:1 at 18.66px/700. Non-text marks clear 3:1 (icons, dots, the fill of an icon-only control). A control labelled by words is judged by its label against its fill. Measure in both themes, and again in greyscale — e-ink panels drop hue, and sRGB greyscale and WCAG luminance disagree by up to 0.7:1. A new surface joins the colour-contrast sweep.
- **A signed-in page renders in the reader's theme.** Every signed-in surface follows the account's Appearance setting (System, Light or Dark), resolved server-side so there is no flash. Never pin a signed-in page to one theme (a light-pinned page flips mid-navigation when the reader opens a dark reader). Logged-out pages are designed art and are pinned light (`LIGHT_ONLY_BODY_CLASS`); the public reader view is the one logged-out page that follows the system theme.

### Browser Extension Palette

Both extensions compile one shared popup stylesheet (`projects/browser-extensions/browser-extension-core/src/popup/popup.styles.css`), which never sees the tokens, so it carries a small palette tuned for popup contexts:

| Role | Light | Dark | CSS variable |
|---|---|---|---|
| Brand | `#c8923c` | `#d4a04a` | `--popup-brand` |
| Active background | `#2b3a55` | `#3d4f6f` | `--popup-active-bg` |

---

## Typography

> **Source of truth:** `src/packages/web-shell/src/base.styles.ts` (the `--font-sans` / `--font-serif` tokens and the body font), `src/packages/web-shell/src/base.template.ts` (font loading)

### Typefaces in Use

| Role | Typeface | Weight | Where defined |
|---|---|---|---|
| **Body, UI and product headings** | `--font-sans` → `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (Inter from Google Fonts, 400–700) | 400, 500, 600, 700 (see [Typography Rules](#typography-rules)) | `base.styles.ts` → `LIGHT_THEME_VARIABLES`, applied on `body` in `BASE_RESET_STYLES`; `base.template.ts` preload |
| **Brand serif** | `--font-serif` → `Georgia, "Times New Roman", serif` | 700 (Georgia ships regular and bold only, so 600+ renders its bold) | The header wordmark (`.header__brand`), the reader view's article title, and display headings on editorial and marketing pages (home, landing pages, blog). The extension popup brand text uses the literal, for the same reason it ships its own palette |
| **Reader view** | User-configurable (default: high-legibility serif or sans) | Regular | Article body text in reading mode — this is the user's space |

### Type Scale (product UI)

Panels, cards, lists and dialogs have **no display type**. Their largest text is a 17px title; everything else sits one or two steps below it. A stand-alone figure (a stat tile, a price) may be larger. Sizes are fixed per role and do not change per breakpoint — a phone gets the same sizes and the layout reflows. The reader's article and editorial/marketing pages keep their own display scale.

| Role | Size | Weight | Ink |
|---|---|---|---|
| Item title in a list · empty-state title · dialog title | `1.0625rem` (17px) | 600 (dialog 700) | `--foreground`; an item title hovers to `--primary-text` |
| Panel / card heading | `1rem` (16px) | 600 | `--foreground` |
| Rail heading · tab label · dialog body | `0.9375rem` (15px) | 600 · 500 (600 current) · 400 | `--foreground`; inactive tabs `--muted-foreground` |
| UI text: nav and menu items, list header, excerpts, ledes, pagination | `0.875rem` (14px) | 400–600 | `--foreground` or `--muted-foreground` |
| Supporting: metadata, card and alert body, errors, field labels | `0.8125rem` (13px) | 400 (labels 600) | `--muted-foreground`; errors `--error-text` |
| Chip · tile label | `0.75rem` (12px) | 500–600 · 400 | per chip · `--muted-foreground` |
| Figure (stat tile) | `1.125rem` (18px) | 700, tabular | `--foreground` |

Buttons and inputs take their sizes from their own tokens (see [Buttons](#buttons) and [Form Inputs](#form-inputs)). Nothing a reader must read goes below 12px; 11px is left to all-caps micro-labels, avatar initials and the footer copyright.

### Typography Rules

- **Product headings are sans; the serif is the display voice.** Every heading in the product's working area — panel and card titles, rail headings, list headers, empty states, alerts, dialog titles — uses `var(--font-sans)` at weight 600 (700 for a dialog title) in `--foreground`. This covers **every page a reader operates**, signed-in pages and logged-out tools (import, login) alike. `var(--font-serif)` is the display voice: the wordmark, the reader view's article title, and display headings on editorial and marketing pages (home, landing pages, blog). A saved article's title or an email subject shown in a list is sans, like the rest of the list. Declare the font on the heading's own selector so the choice is explicit, not inherited — a heading that inherits the body sans is a drift, not a choice, and the serif stack must never be inlined (one source of truth, like colours).
- **Weight carries hierarchy.** Inter is loaded at 400–700, and each weight has one job. **400** is prose, excerpts, metadata, menu items, neutral labels. **500** is navigation a reader moves through (rail and header links, inactive tabs) and neutral chips. **600** is headings, titles, form labels, counts, status chips, button labels, and the current tab or page number. **700** is dialog titles, stand-alone figures, the wordmark and avatar initials. Never set **800** — Inter is not loaded at that weight. Where a weight step does the job, do not reach for a bigger size.
- **A heading brings its own lede.** A panel title (16px/600, `--foreground`) is followed 2–8px below by a lede one or two steps smaller (13–14px/400, `--muted-foreground`). Alerts use the pair one step down (14px/600 over 13px), empty states one step up (17px over 14px). The two lines differ by weight and ink, not by a large size gap. A dialog's body is the exception — it is the message, so it stays `--foreground`.
- **A page with persistent navigation names its place through that navigation, not a display title.** Where a rail or tab selection already shows where the reader is, the page renders no visible `h1`: the document `<title>` names the place (`All — Readplace`), and each panel's own `h2` starts the outline.
- **Legibility is non-negotiable.** This is a product about reading. If a type choice looks good but reads poorly, reject it.
- **Line-height.** Body text inherits `1.6` (`BASE_RESET_STYLES`), and a single-line metadata row keeps it. A 17px item or dialog title that wraps tightens to `1.3`–`1.35`; no heading goes below `1.3`. Supporting copy at 13–15px running several lines (card/dialog body, excerpts, empty-state text) may tighten to `1.5`–`1.55`. Generous spacing is a feature, not a waste of space.
- **Never use all-caps** for more than short micro-labels. Never for headings or body text (see also [Capitalisation](#capitalisation)).
- **International support:** Typefaces must include full Latin Extended character sets (Portuguese, accented characters). The founder is Brazilian-Australian — this is table stakes.
- **Avoid trendy typefaces.** If it will look dated in 2 years, don't ship it.
- **Orphan control.** Prose body copy uses `text-wrap: pretty`; multi-word headings use `text-wrap: balance`. Scope both to the prose/heading selectors — never on `body`. A single word must never be stranded on a text block's last line. A left-aligned list-item title that shares its row with a menu or thumbnail uses `pretty`, not `balance` — `balance` would shorten its first line and leave a gap beside the menu. **Exceptions:** an intentional keyword focal point is a designed single-word line; a centred title that should read as a top-wide pyramid uses `pretty`; single-word *headings* (`Cookies`, `Contact`) are acceptable when intentional (`balance` is a no-op on them).
- **One-word page titles get deliberate visual mass** — larger size, heavier weight, and/or negative letter-spacing so the whitespace beside them reads as intentional.
- **Long strings wrap; a metadata name truncates.** Text supplied by a reader or publisher (article titles, excerpts, readlist names, site names, URLs) must never push the page sideways at 320px. Titles, excerpts and names wrap mid-word (`overflow-wrap: anywhere`); a raw URL breaks with `word-break: break-all`. In a metadata row the one variable-length part (a publisher name) stays on one line and gives way with `text-overflow: ellipsis`, carrying the full text in `title` and a minimum flex basis (`12ch`) so it never collapses to a sliver. Fixed parts (dates, read time) are `white-space: nowrap` and wrap to a second line before the name is crushed.
- **Tabular figures.** Figures that tick or are compared side by side (countdowns, stat tiles, live counters) set `font-variant-numeric: tabular-nums` so digits hold their width.
- **Tracking stays at the face's default.** Product text, headings included, sets no `letter-spacing`. The only exceptions are chrome: the wordmark (`-0.02em`), all-caps micro-labels (`0.06em`), avatar initials (`0.02em`), the trial countdown (`0.01em`).
- **Nothing moves when a late value arrives.** A label filled in or changed in place (a tab count, a countdown, an in-flight button) keeps its footprint: reserve the width of its widest value, set changing figures tabular, hide an in-flight label with `visibility: hidden` rather than removing it, and keep the value on screen across an in-place update instead of blanking it.

### Highlight Words

A single highlight word inside a phrase can be recoloured with `--color-highlight` (warm amber `#c8923c` — the logo dot) to draw the eye without bolding, underlining, or changing size.

**Rules:**

- Use the same face as the surrounding text (`var(--font-serif)` in a serif heading, `var(--font-sans)` in body). The highlight is colour, not type.
- **No weight or size change.** Contrast does the work — bold would be shouting.
- **Never add space** between the default-colour prefix and the highlight word.
- One highlight per phrase. If two words need emphasis, pick the stronger one.
- The highlight is visible against navy, white, and muted surfaces. On the warm amber gradient it collapses — choose navy or another neutral there.

**Wordmark.** `Read<span class="header__brand-mark">place</span>`, set in `var(--font-serif)` at 1.5rem/700, `-0.02em`, beside the 26px mark with an 8px gap — the one place the serif appears in product chrome. Its halves take theme tokens, never literals: the stem is `--header-brand-stem` (navy `#2B3A55` light, `#E4E4E4` dark) and the tail is `--header-brand-tail` (`--color-brand` `#C8702A` light, `--color-highlight` `#D4A04A` dark). On the navy hero (`.header--transparent`) the stem turns `--color-on-brand` white and the tail `--color-highlight`. The wordmark splits the brand into a neutral stem and an amber tail — the pattern this highlight rule generalises.

---

## Iconography & UI Elements

### Icon Style

Every UI icon comes from [`@packages/ui-icons`](./src/packages/ui-icons/src/ui-icons.ts), which defines the one line spec: Lucide geometry on a 24×24 grid, 2px stroke, round caps and joins, no fill, `currentColor`, hidden from assistive tech. Size an icon by setting width/height on the svg (in `rem`/`em`) and colour it with `color`. Add a drawing there rather than at a call site, and add only icons a surface actually draws.

- **No icon font, no icon CDN, no entity or Unicode glyph (`× ↓ ← → ✓ ✗ ● ▾`), no emoji, no CSS `content:` glyph.** A font glyph's stroke follows the system font and an SVG's does not, so mixing them puts two weights on one row — the tell that icons were picked at different times.
- **Never override `stroke-width`, never fill a UI icon, never mix in a solid-style variant.** Filled colour is only for brand and logo marks.
- **Typographic punctuation stays text** — em dash, ellipsis, curly quotes, bullet dividers are copy. A plain shape (an unread dot, a step marker) is CSS, not an icon.
- **Size an icon to the label it sits beside.**

  | Where | Glyph | Icon-to-label gap |
  |---|---|---|
  | Inline in a text link or control label (sort, Previous/Next, a banner link) | `1em` of the text | 4–6px |
  | Metadata row (13px text) | `0.9375rem` (15px) | 5px |
  | Menu item (14px label) | `1rem` (16px) | 10px |
  | Icon-only button (overflow trigger, close) | `1rem` (16px) | — |
  | Navigation row (14px label) | `1.125rem` (18px) | 10px |
  | Status banner or callout lead | `1.125rem` (18px) | 12px |

  These gaps are the one place icon spacing leaves the 4px grid (see [Layout Principles](#layout-principles)).
- **An icon's ink comes from its role.** Navigation icons are monochrome and follow their label: `--foreground` in the header; in a side rail, `--muted-foreground` at rest and `--primary-text` on the selected row. Menu-item icons and icon-only triggers are `--muted-foreground`. A state glyph takes the functional text token (`--success-text`, `--error-text`); a progress spinner (`loader`) is `--primary-text`. A **metadata glyph** carries one fixed tint per fact so rows scan by colour — source/site `globe` in `--color-secondary-text`, saved time `clock` in `--color-error`, reading time `eye` in `--color-success` — while the text beside it stays `--muted-foreground`. This is the one decorative use of the functional hues; everywhere else red and green mean error and success. Every tinted glyph clears 3:1 against its surface in both themes — reach for a page-following token before a theme-pinned brand value (pinned `--color-secondary` is 1.39:1 on the dark card).
- **Arrows show direction; chevrons show disclosure.** `arrow-left`/`arrow-right` lead Previous / trail Next; `arrow-down`/`arrow-up` beside a sort label show the order applied. A disclosure (`<details>` summary, dropdown, account trigger) uses `chevron-down` in `--muted-foreground` and rotates it 180° when open; there is no separate up-chevron.
- **An icon carrying meaning alone needs an `.sr-only` twin** naming what it acts on — `htmlToMarkdown` drops `<svg>`, so a lone icon reaches AI clients and screen readers as an empty cell. Prefer `.sr-only` text over an `aria-label` alone (which markdown also drops). A per-row menu is "More options for <item>", a status marker is "Unread"/"Read", a close is "Close" — never a bare "Menu" repeated down a list.

### Illustrations

Spot illustrations lead an empty state and a destructive confirmation dialog. They come from the shared illustrations module, not the icon set. An illustration is line art in the icon idiom: inline SVG, 2px round-capped strokes in `currentColor` (the container sets `--foreground`), one accent element stroked in `--color-brand` (a book's cover, a bin's lid), and at most one soft `--color-highlight` wash at ~35% opacity — the only fill allowed outside brand marks. The accent stays brand amber even on a destructive dialog; the confirm button carries the danger. Illustrations are decorative (`aria-hidden`, `focusable="false"`), 72–96px, and never emoji, raster or clip art. A dialog that only edits (rename) has no illustration. Add a new drawing to that module, not at the call site.

### List Markers

List markers carry polarity. An included / positive item takes the `check` icon in `--success-text`; an excluded / negative item — a "what this will **not** do" list — takes the `x` icon in `--muted-foreground` (or `--color-error` for a louder refusal). Never mark an exclusion list with a neutral dash or bullet — a dash reads as a feature, not a refusal.

**Item state uses one vocabulary.**

- **Waiting or current** is a small filled CSS dot (8px): `--primary-text` for an unread item, and `--foreground` inside a 2px `--foreground` ring for the current step of a sequence.
- **Done** is the `check` icon in the success colour: `--success-text` beside text, or a white `--success-foreground` check on a solid `--success` circle for a completed step.
- **Not yet reached** is a 2px dashed `var(--border)` ring; steps are joined by a 2px dashed `var(--border)` connector.
- An inline state marker beside wrapping text sits in a box one line tall, so it stays on the first line and is never centred against a wrapped block.
- A marker that carries meaning alone has an `.sr-only` twin.

### Buttons

> **Source of truth:** `BUTTON_STYLES` in `src/packages/web-shell/src/base.styles.ts`, injected into every page's `<head>`.

There is **one** button in the product. Every call to action is `.btn` plus exactly one variant, plus — only where its surroundings demand it — one tier modifier. A page stylesheet may add layout (`width`, `margin`, grid/flex placement, `white-space`) and nothing else. A page never defines its own button class or repaints a `.btn` variant's padding, radius, fill or hover — that is how those values drift apart from page to page. **Every variant this section names belongs in `BUTTON_STYLES`.** `.btn` sets no fill or colour of its own, so a variant the module doesn't define renders as an unstyled button: add it there before its first use.

#### Variants

| Variant | Style | Usage |
|---|---|---|
| **`primary`** | Amber fill (`--primary`), white text (`--primary-foreground`) | The amber CTA — the main action per screen (Save, Import, Subscribe, install, landing and pricing CTAs) |
| **`secondary`** | Subtle amber tint (`--secondary`), amber text (`--primary-text`), 1px inset amber outline | The supporting action beside a primary (View on GitHub, Cancel, Back) |
| **`destructive`** | Solid red fill (`--error-fill`), white label (`--error-foreground`); hover/active swaps to `--error-fill-hover` | The commit of a destructive action: delete, remove, disconnect, cancel a subscription. Both red fills are pinned across themes; there is no outline-that-fills-on-hover destructive style |
| **`neutral`** | Card fill (`--card`), ink label (`--foreground`), 1px inset `--border` outline; hover/active fills `--muted` | A low-emphasis action standing alone on a screen whose amber CTA is elsewhere, such as an empty state's next step. Never pairs with a `primary` |
| **`toggle`** | Rests like `secondary` (`--secondary` fill, `--primary-text` label, amber outline); hover/active fills solid `--primary` with a `--primary-foreground` label and keeps the outline, previewing the committed state | A list row's state toggle only (Mark as read, Exclude) |
| **`on-dark`** | White fill, dark-amber text (`--secondary-foreground`) | *Context modifier, not a priority level* — a primary sitting on the navy hero |
| **`on-dark-ghost`** | Translucent white fill, white text, translucent white inset outline | *Context modifier* — the secondary beside an `on-dark` primary |

`primary` **always** means the amber CTA. `on-dark`/`on-dark-ghost` carry theme-stable values because the navy hero is navy in both themes. A **tertiary** action is not a button — it is a plain inline link (`--primary-text`, underlined). Red is spent only at the moment of commitment: the *control that opens* a confirmed delete is a neutral [menu](#menus) item that tints red on hover, and only the dialog's confirm button is `destructive`.

**Row actions.** An action repeated on every row of a list (Mark as read on each card, Exclude on each sender) is the `toggle` variant at the `compact` tier, never `primary`, so the screen keeps one amber CTA. While its request is in flight the label hides with `visibility: hidden` (the width holds) and the shared in-flight dots take its place; while the item is still processing it is disabled at `opacity: 0.5`.

#### Pairing

When two buttons sit side by side, the **first is the primary action and the second is the secondary action** — always in that order, never two of the same weight, and never a button beside a bare text link. A repeated action keeps **one** variant everywhere it appears on a page.

**Escape hatch.** The one text control allowed beside a button: a control that marks a step done or skips it ("I've done this already") sits under that step's `primary` as a quiet text action — underlined, `--muted-foreground` → `--foreground` on hover, 13px/500. An *alternative path* is still a `secondary` button; a link in prose is still `--primary-text`.

**In a dialog**, buttons are default tier and together fill the panel width. When they stack, the commit is on top and its alternative below (primary then secondary, or destructive then secondary). When a dismiss and a commit share one row, as in a form dialog's Cancel / Save, the commit trails: Cancel (`secondary`), then Save (`primary`).

#### Size and padding

> Defined in `base.styles.ts` as CSS custom properties. Reference the tier token — never hardcode button padding.

Tap targets come in tiers by role, not by importance:

| Tier | Modifier | Value | CSS variable | Usage |
|---|---|---|---|---|
| **Default** | — | `12px 24px` | `--button-padding` | A CTA on its own line: hero, landing, install, pricing, import commit, a card's closing CTA (spanning the card), **and every dialog button**. ≥44px tall |
| **Field-aligned** | `.btn--field` | `min-height: 48px` + `0 24px` | `--input-height`, `--button-padding-x` | A CTA beside a text input so the row lines up (Save, Fetch links, Upload, auth submit). The input keeps `padding: var(--input-padding)` |
| **Compact** | `.btn--compact` | `8px 16px`, label 13px | `--button-padding-sm` | An action nested in dense secondary content: a checklist/stepper step (≥44px), a `toggle` (≥40px), a toast, a banner row. Height follows the tiered floor below. Never a card's closing CTA |
| **Small / Icon** | — | `4px 8px` | `--button-padding-xs` | Icon-only controls (close, dismiss, kebab): a 16px glyph inside its hit area, `--radius-sm`. Not `.btn` |

**Tap-target floor is tiered.** A `.btn`, a tab and a navigation row are ≥44px tall. A menu item and a list row's state toggle are ≥40px. A compact control *inside a list* (an overflow toggle, a page number, Previous/Next) is ≥36px square — the one relaxation of the 44px floor, and it still clears WCAG 2.5.8's 24px. A dialog or banner close is the `x` icon in a ≥44px hit box. Nothing interactive is smaller on any viewport.

#### Hover and active

**Hover and active swap the fill — they never fade it.** One mechanism (`background-color`), one direction: the fill moves *away* from the surface behind it, so the button gains presence.

- A filled amber button rests on `--primary` (`hsl(27 65% 41%)`, 4.61:1 under white) and darkens to `--primary-fill` (`hsl(27 65% 33%)`, 6.49:1). Both are pinned in both themes, so the direction cannot invert.
- A tinted or translucent variant deepens its own fill by the same mechanism. The one exception is the [`toggle`](#variants) variant, which inverts to solid `--primary` to preview the commit.
- **Never `opacity` on a button that has a fill** — it fades the label too, reading as disabled. `opacity: 0.5` is the disabled state.
- **Never `filter: brightness()`** — it lightens, the wrong direction.
- **Never `--color-brand-dark` as a hover fill** — it inverts lightness between themes.
- A bordered control keeps its border through hover and active — only the fill moves.

#### Quiet controls

Controls that navigate or tidy without committing (sort, pagination, sidebar rows, "create" rows, kebab triggers, close buttons) are neutral: never amber at rest, never underlined.

- A destination (a sidebar row, a page link, a menu item) rests in `--foreground`. A utility (sort, create, kebab, close) rests in `--muted-foreground` and turns `--foreground` on hover.
- A control with a box shows hover by stepping to the neighbouring surface: `--card` when it sits on the `--muted` ground, `--muted` when it sits on a `--card` or `--background` surface. A text-only control changes ink only.
- **Sort** is one link naming the current order with a direction-arrow icon ("Newest first") that toggles it — not a `<select>`.
- A card's title link carries no underline and turns `--primary-text` on hover.
- The selected row of a navigation rail is filled `--secondary` with `--primary-text` ink and keeps that fill on hover.

Amber at rest is kept for calls to action, links in prose, and the active sidebar row.

- **Every focusable control paints the amber `--ring` when focused.** A **text field** shows focus on `:focus` by turning its border `--ring` and adding `0 0 0 3px var(--ring-shadow)`, with `outline: none`. On a marketing page, a field that shares a row with its CTA paints that button's `:focus-visible` outline instead, so the pair shows one ring. **Everything else** (buttons, links, selects, `summary` toggles, a focusable dialog panel) draws `outline: 2px solid var(--ring)` at 2px offset on `:focus-visible`. The base rule covers `button` and `a`, so any other element declares its own.

#### Disabled and in-flight

- **Disabled** buttons and fields take `opacity: 0.5` and `cursor: not-allowed`. A field and the button it pairs with are disabled together.
- **A disabled link is not a faded link.** Render it as a non-link element with `aria-disabled="true"` in `--muted-foreground`. Disabled text is never `--color-text-muted` (under 3.3:1 in both themes).
- **In flight is not disabled.** A control locked only for its round trip keeps full opacity and takes a `progress` cursor. It shows it is working in place of its label — the shared three-dot loader (label hidden by `visibility: hidden` so width holds), or a progress label ("Saving…"). A region waiting to be replaced may dim to ~55% with a `progress` cursor; it never goes blank.

### Border Radius

> Defined in `base.styles.ts` as CSS custom properties.

| Token | Value | CSS variable | Usage |
|---|---|---|---|
| Small | `6px` | `--radius-sm` | Controls: buttons, inputs, selects, menu items, icon-only buttons, labels, images inside a card, progress tracks, skeleton bars, thumbnails (a non-interactive status chip is a pill, not `--radius-sm` — see the carve-out below) |
| Default | `8px` | `--radius` | Rows and small floating layers: navigation rows (rail rows, header links), dropdown and row menus, toasts; and boxes nested inside a card or dialog (tiles, callouts, bordered lists) |
| Large | `12px` | `--radius-lg` | Page-level surfaces: cards and panels, including a standalone alert card |
| Dialog | `16px` | — | Modal dialogs — one step above a card |

**Corners step down one size per level of nesting** (dialog 16 → card 12 → nested box 8 → control 6), so an inner corner is never rounder than its container. A tile set into a card (a stat or countdown box) is enclosed by 1px `var(--border)` and fills with `--muted`, reading as recessed. An image in a card takes `--radius-sm` and `object-fit: cover`, no border. Pick the token by what the element *is*, not by how prominent it should look.

**Never fully rounded** (pill shapes) for anything you *operate* or that *frames content* — buttons, inputs, tabs, menus and cards stay on the radius tokens. This isn't a social app. The one carve-out is a **non-interactive status chip**, which is a pill (`border-radius: 999px`) so it reads as a badge, not a control. Circles (`border-radius: 50%`) are shapes, not pills, and are reserved for avatars, status/unread dots and step markers.

A card laid out in a grid is a fully-enclosed box — `1px solid var(--border)` plus a `--radius*` corner. A vertical divided list lives *inside* one enclosed card (see [Lists](#lists)); its hairlines never run bare on the page ground. Reserve a bottom-border-only separator for a divided list, never a grid tile, which reads as half-drawn beside its neighbours.

### Shadows & Elevation

> Defined in `base.styles.ts`.

An app screen has a canvas and at most two raised layers — never more.

| Layer | Fill | Edge | Shadow | Examples |
|---|---|---|---|---|
| **Canvas** | `--muted` on signed-in app pages; `--background` on reading pages; marketing pages keep the band rhythm | — | none | page ground, uncarded navigation rails and tab strips |
| **Resting** | `--card` (`#FFFFFF` / `#222222`) | 1px `var(--border)` | **none** | cards, panels, alert cards |
| **Floating** | `--card` (a full-height drawer takes `--background`) | 1px `var(--border)` | `--shadow-md` | dropdown and row menus, popovers, dialogs, the mobile nav drawer |

| Token | Light | Dark | CSS variable |
|---|---|---|---|
| Small | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.3)` | `--shadow-sm` |
| Medium | `0 4px 6px rgba(0,0,0,0.07)` | `0 4px 6px rgba(0,0,0,0.4)` | `--shadow-md` |

- **A shadow means it floats.** A resting card is border-only — the fill step from the canvas is barely visible in either theme, so the hairline does the separating. `--shadow-md` belongs to things that sit over the page and can be dismissed. That keeps every screen at two planes.
- A **toast** is the inverted floating layer: `--foreground` fill, `--background` ink, a 1px white edge at ~30%, `--shadow-md`.
- A **modal dialog** also dims the page with a scrim: `rgb(26 32 44 / 0.55)` light, `rgb(13 13 13 / 0.72)` dark. These are literals because `var()` does not reach `::backdrop`.
- A focus halo or an inset outline built with `box-shadow` is not elevation.
- `--shadow-sm` has no role.

---

## Components

### Lists

A vertical list of content items (articles, emails, records) is **one enclosed card**: `--card`, 1px `--border`, `--radius-lg` (`--radius` when nested inside a card or dialog), `overflow: hidden`. Rows run flush to the card's edges, split by 1px `--border` dividers — no gap between rows, no box around each row, no divider after the last. A divided list never sits loose on the page ground; a grid of tiles is the opposite pattern (each tile individually boxed). A navigation list (a rail) is not a content list and stays unboxed on the ground.

- **List header.** The card opens with a header row: the item count on the leading edge (14px/600 `--foreground`, tabular figures, a noun naming what the open tab lists — "12 Unread", "3 Read") and the sort control on the trailing edge (a [quiet](#quiet-controls) text link naming the current order with a direction arrow). The number sits in a slot reserved for its widest value (totals cap at "9999+"), so the noun never moves when the count arrives. The header stays when the list is empty. Never claim a total you don't have — leave the slot empty until the count is known, and show zero once it is.
- **Row anatomy.** A row reads top-down: title, excerpt, metadata, action. 20px padding, 10px between parts. The title is UI, so it is sans (17px/600, line-height 1.35, `--foreground`, `text-wrap: pretty`); it is the row's link into the item and turns `--primary-text` on hover, never underlined. The excerpt is 14px/1.55, `--muted-foreground`. A row may make its title, excerpt and thumbnail all open the same item, but **only the title is a tab stop** and in the accessibility tree — the duplicates take `tabindex="-1"` (and `aria-hidden` when they carry no text).
- **Clamp only borrowed text.** Prose taken from a page (a meta description, a first paragraph) clamps at two lines (`-webkit-line-clamp: 2`). Text the product wrote itself (a generated teaser) and titles render whole. Never clip a sentence the product authored.
- **Metadata row.** A row of facts 14px apart; each fact is a 15px `ui-icons` glyph 5px before its text, the text `--muted-foreground` and the glyph its fixed per-fact tint (see [Icon Style](#icon-style)). The one unbounded fact (a publisher/sender name) stays on one line and gives way with an ellipsis (full text in `title`, `12ch` flex-basis floor). Bounded facts (dates, durations) never shrink or wrap inside themselves; when the row can't fit, whole facts wrap. A fact with no value is removed, not rendered empty.
- **Status marker.** An item's read state is a marker at the start of its metadata row: unread an 8px dot in `--primary-text`, read the `check` at 14px in `--success-text`, each with an `.sr-only` word. The marker sits in a box one metadata line tall, aligned to the first line. A finished item keeps the same anatomy — only its title drops to `--muted-foreground` (still amber on hover), and its toggle names the inverse action. Never use opacity, strike-through or a greyed card for done items.
- **Row actions.** A settled row shows at most one action button — its state [toggle](#buttons) — on its own line below the metadata at the leading edge, so it lands in the same place on every row regardless of width or thumbnail. Every other action goes in an [overflow menu](#menus) opened from an `ellipsis` toggle at the trailing end of the title line. Never put a delete button on a row.
- **Thumbnail.** A row's thumbnail sits on the trailing edge, vertically centred against the row's full height: 4:3, cover-cropped, `--radius-sm`, `clamp(72px, 18vw, 104px)` with a `clamp(12px, 3vw, 16px)` gutter. It is decorative (`alt=""`, `aria-hidden`, out of the tab order). One that fails to load removes itself; a row without one gives its text the full width.

### Empty States

An empty list keeps its frame: the list card and header stay, the count reads zero, and the empty state fills the card body — centred, 40px above / 44px below / 8px between parts. It holds a spot [illustration](#illustrations) (~96×80), a sans title (17px/600, `--foreground`, `text-wrap: balance`), one or two sentences of 14px `--muted-foreground` body capped at ~44ch (the one place prose may take a narrower measure than its column), then the next-step action(s) 12px below. Pagination is hidden — never "Showing 0 of 0". Distinguish the reasons a list is empty (never used, all caught up, nothing in this tab, nothing in this scope), each with its own title and a body naming what to do next.

### Tabs

Tabs that switch between views of the same content are **underline tabs** — never pills, boxed segments or filled chips. The strip is a row of links on a 1px `--border` baseline spanning the content column, above the card it controls, never inside it. Each tab is ≥44px tall, 15px/500, `--muted-foreground` → `--foreground` on hover. The open tab is `--foreground`/600 with a 2px `--foreground` underline laid over the baseline (`margin-bottom: -1px`) and `aria-current="page"`. **The underline is neutral ink, never amber** — amber marks the selected row of a navigation rail, not a selected filter. The strip wraps at narrow widths rather than scrolling sideways.

A tab may carry a count as `Label (N)` (`formatTabCountLabel`), capped at `99+`, `(0)` when there are none, the bare label while the count is unknown. Show a count only where it helps the reader choose the tab, and reserve the width of its widest form so a late count doesn't move the row.

### Pagination

Pagination sits **below** the list card, outside it. The leading edge states the range ("Showing 20 of 21", 14px `--muted-foreground`); the trailing edge holds Previous, the page numbers and Next. Previous/Next are [quiet](#quiet-controls) text links (14px `--foreground`) carrying `ui-icons` arrows, always rendered — at the ends they become `aria-disabled` text in `--muted-foreground` with no hover, so the numbers never shift. Page numbers are square `--radius-sm` targets taking a `--card` fill on hover; the current page is not a link — it carries `aria-current="page"` as a `--card` tile with a 1px `--border` and weight 600. Show the first page, the last, and one either side of the current, with `…` gaps in `--muted-foreground`. Pagination is hidden on an empty list, wraps at narrow widths, and is never amber and never `.btn` buttons.

### Menus

An overflow menu is a `<details>`/`<summary>` kebab: an icon-only trigger (`ellipsis` on a content row, `ellipsis-vertical` in a narrow rail row; 16px, `--muted-foreground`, always visible — never revealed on hover), never a text label. It opens a panel anchored to the trigger's trailing edge, 4px below: `--card`, 1px `--border`, `--radius`, `--shadow-md`, 6px inner padding. Items are inset rows at `--radius-sm`, ≥40px tall, a 16px icon in `--muted-foreground` plus a 14px label in `--foreground` (10px gap), hovering to `--muted`; every item carries an icon. A **destructive item** looks like its siblings at rest and turns `--error-bg` / `--error-text` on hover — the solid red belongs to the [dialog](#dialogs) it opens, not the item.

### Dialogs

> **Component:** the shared confirm panel in `@packages/web-shell` (`renderConfirmPopover`, `CONFIRM_POPOVER_STYLES`). The values below belong in that module, never in a page stylesheet.

A dialog is the shared confirm panel, opened as a native popover, and every trigger keeps a plain-form fallback where popover is unsupported. The panel is `--card` on a 1px `--border` with `--shadow-md`, 16px corners (see [Border Radius](#border-radius)), over a dark [scrim](#shadows--elevation); its padding grows 24px → 32px at 768px.

- **Title** is UI, not a section heading: sans, 17px/700, balanced. The close control is the `x` icon in the top-right corner.
- **Body** is 15px/1.5 and stays `--foreground` — it is the message. A list of what the action will touch is a bordered list box (1px `--border`, `--radius`, hairline-split rows), not bullets.
- **Illustration.** A confirmation of a consequential action (a delete) may carry a 72px line [illustration](#illustrations) above the title; an illustrated dialog centres its composition and pins the close control to the corner. A dialog that only edits (rename) has none and is left-aligned: label above the field, inline error below, buttons last.
- **Buttons** follow [Pairing](#pairing).

### Alerts and Status

An error alert is a tinted box that stays on screen (never a toast): 1px `--color-error` border, `--error-bg` fill, `--radius-lg` standalone (`--radius` nested in a card), `14px 16px` padding, `role="alert"`. It leads with `x-circle` (18px, `--error-text`, 12px from the text, aligned to the title's first line); a short title (14px/600 `--foreground`, no full stop) names what happened and a body line (13px `--muted-foreground`) says what to do next. **Red belongs to the frame and the icon; the words stay neutral ink.** A field error reddens the input's border and sets the message beneath it in `--error-text`.

A **status chip** carries its state's triad (e.g. `--error-bg` fill, `--error-text` label, 1px `--color-error` border) at 12px/600, as a [pill](#border-radius). `--error-text` is the red for wording, `--color-error` the red for strokes; neither is a fill.

### Toasts

> **Source of truth:** the toast in `@packages/web-shell` (`renderToast`).

A toast confirms a change the reader just made ("Marked as read"): the shared toast, bottom-centre, inverted (`--foreground` fill, `--background` text), `--radius`, `--shadow-md`, 14px/500. It takes at most one action (Undo) as `primary` + `compact`, and dismisses itself. **Errors are never toasts** — an error stays on screen as an [alert](#alerts-and-status) or an inline field message until it is resolved.

### Loading States

- **Pending swap.** A tab press that replaces a list responds on the press, not the response: the pressed tab takes the open look at once, the previously open tab drops to `--muted-foreground`, and the region being replaced dims to `opacity: 0.55` with `cursor: progress` until the new content lands. Dimming a region *about to be replaced* is the one sanctioned opacity fade on live content — never on a single filled button.
- **Processing row.** An item still being processed stays in the list, in place, its metadata replaced by a "Processing" line (`loader` spinning in `--primary-text` beside 13px `--muted-foreground` text); its toggle is disabled, delete stays available. If it runs long, say so plainly and offer the source ("Taking a while — open on example.com").
- **Skeleton row.** When the reader creates an item, a skeleton row stands in where it will land, from the press until the page answers: tinted `--secondary`, bars in `currentColor` at 25% opacity with `--radius-sm` corners, a "Saving…" status led by a pulsing `--primary-text` dot. It matches the height of the row that lands, so the swap doesn't jump.

### Progress and Steppers

Multi-step progress is a vertical stepper. Show the total first as a percentage label over a thin (6px) `--success` bar on a `--muted` track. Then list the steps, each with a 20px circular marker joined to the next by a 2px dashed `--border` line: a done step is a `--success` disc with a white check, the current step a `--foreground` ring with a dot, an upcoming step a dashed `--border` ring. Only the current step is expanded; done and upcoming steps collapse behind a `chevron-down` that rotates 180° when opened, and a done step never disappears. A step's CTA is `.btn--primary.btn--compact`. A **completion** bar is `--success`; an **in-flight** progress bar (an import running) is amber — the two are different states.

### Status Panels and Stat Tiles

An account-status panel reads top to bottom: an optional status chip, a sans title, one muted sentence, the evidence (a date or countdown), one full-width primary CTA, and at most one reassurance line under it. A **countdown or small statistic is a tile**: a `--muted` fill with 1px `--border` and `--radius`, the value first (18px/700, tabular numerals, `--foreground`) and its unit under it (12px, `--muted-foreground`). Tiles in a row share equal columns.

### Motion

- **State changes are quick colour changes, not choreography.** Hover, selection and disclosure transition `background-color`, `color`, `border-color` or a chevron's rotation over `150ms ease`. Nothing bounces, scales or slides in on hover.
- **Only work in progress loops.** A spinning `loader`, a pulsing dot or the three in-flight dots mark a request in flight and stop when it lands. Nothing else animates on its own.
- **Every animation has an off-switch.** Any `animation`, and any transition that moves an element (a drawer, a sliding header, a toast's exit), is disabled under `@media (prefers-reduced-motion: reduce)`. The static state must still read correctly.

---

## Spacing & Layout

### Spacing Scale

A **4px base unit**. Layout spacing (page padding, gutters, gaps between cards and columns, a card's main padding) is always a multiple of 4. Inside a component, 2px half-steps (`6px`, `10px`, `14px`) and the 5px metadata icon gap are allowed where content must sit optically centred in a fixed target or a compact strip — a half-step never sets the space between cards or columns.

| Token | Value | Usage |
|---|---|---|
| `xs` | 4px | Gap between the rows of a rail or menu list; tight inline gaps |
| `sm` | 8px | Between related elements (title → lede, label → field) |
| — | 12px | Between items sharing a row (a heading and its menu, a count and its sort) |
| `md` | 16px | Between cards in a column; the phone page gutter; input side padding |
| — | 20px | List-row and compact-card padding; the single-column gap |
| `lg` | 24px | Desktop page gutter and column gap; card side padding |
| `xl` | 32px | Between major sections of a marketing page; dialog padding from 768px |
| `2xl` | 48px | Page-level margins, hero spacing |

Page-level insets (the `28px` desktop top, the `64px` / `80px` bottom) sit on the same 4px base.

### Form Inputs

> Defined in `base.styles.ts`.

| Token | Value | CSS variable |
|---|---|---|
| Height | `48px` | `--input-height` |
| Padding | `12px 16px` | `--input-padding` |
| Font size | `16px` | `--input-font-size` |
| Form gap | `20px` (24px from 768px) | `--form-gap` |

- **A text field** has a 1px `--input` border, `--radius-sm` corners and a `--background` fill — in dark mode that fill sits one step below the `--card` around it, so the field reads as a well. Placeholder text is `--color-text-muted`. The field is named by a visible label above it (13px/600 `--foreground`, 8px gap) or by the heading of the card it sits in; a placeholder is never its only name. **Invalid:** the border turns `--color-error` and one 13px `--error-text` sentence appears directly below (announced with `role="alert"` when it appears without a page load). **Disabled/in-flight:** see [Buttons](#disabled-and-in-flight).
- **Controls use the body face.** The browser gives `input`, `select`, `textarea` and `button` a system font, so every control declares `font: inherit` (or `font-family: inherit` beside its own size, as `.btn` does), or it shows its value and placeholder in a different face from its label.
- **An input paired with a button shares the button's height.** Set `height: var(--input-height)` on the input and give the button the `.btn--field` tier (which carries `min-height: var(--input-height)` and `padding: 0 var(--button-padding-x)`); the input keeps `padding: var(--input-padding)`. Because `box-sizing: border-box` is global, an explicit shared height is the only reliable equaliser — never fake it with padding or font-size, and never re-declare the height on the button.

### App Pages

An **app page** is where a reader manages their library, imports or settings — as opposed to reading an article or a marketing page. App pages (signed-in pages and logged-out tools) are built in three surface layers:

| Layer | Light | Dark | Token | Holds |
|---|---|---|---|---|
| **Chrome** | `#FFFFFF` | `#121212` | `--background` | The sticky header; the fill of a text input |
| **Canvas** | `#F7F8FA` | `#1A1A1A` | `--muted` | The full-bleed ground of the page. Uncarded controls (side-rail navigation, tab strips, pagination, page-level alerts) sit directly on it |
| **Card** | `#FFFFFF` | `#222222` | `--card` | Every content panel, enclosed by `1px solid var(--border)` and no shadow |

The page's `main` grows (`flex: 1 1 auto`) so the canvas meets the footer with no `--background` strip between. This does not apply to the reader view (its reading surface stays neutral) or marketing pages (section bands).

- **The site frame is 1200px, measured on the outer box.** Header content, the announcement bars above it, and every multi-column app layout cap their container at `max-width: 1200px; margin: 0 auto`. A layout's gutter sits *inside* that box (16px on phones, 24px from 1024px). Only a full-bleed band paints wider (the page canvas, a hero, a muted marketing band). The footer keeps its centred 1000px column.
- **Workspace columns.** When an app page needs more than one column, it uses one set of tracks from `min-width: 1024px`: a `220px` navigation rail, a `minmax(0, 1fr)` main column, a `300px` side column, `24px` apart, `align-items: start`. A page with no side panels keeps the tracks and leaves the side column empty so its rail and main line up with the rest of the workspace. A single-purpose page (a form, a settings page) stays one column at its own measure inside the frame — it does not grow a rail to match.
- **Columns collapse by urgency, not source order.** Below 1024px the tracks fold into one `minmax(0, 1fr)` column (`20px` gap); the side column dissolves (`display: contents`) and `order` re-sequences its panels: navigation first, then any notice the reader must act on (a trial or subscription ending), then the main content, then supporting panels (a setup guide, tips). A time-critical notice never falls below a long list on a phone. `order` moves only the painted position — keyboard and screen-reader order still follow the source, so reorder only self-contained panels.
- **Gutters grow; cards don't.** The page container pads `24px 16px 64px` below 1024px and `28px 24px 80px` from 1024px, stepping at the breakpoint (never a fluid `clamp()`). Card padding is the same at every width — a list row `20px`, a content card `20px 24px` (`24px` all round for a dense side panel), a header strip or inline alert `14px` vertical. A dense panel may tighten to `20px` at `max-width: 600px`, but no card grows on desktop. A dialog does grow (24 → 32px at 768px), as does a lone centred container that is the whole page's content (see [Layout Principles](#layout-principles)).
- **Breakpoints.** Lay out on four widths. Where a width is used in both directions, the `max-width` query sits one pixel below its `min-width` twin.

  | Name | Query | What changes |
  |---|---|---|
  | Phone | `max-width: 600px` | Last tightening step: a dense panel's padding may drop 24 → 20px; optional decoration hides |
  | Tablet | `min-width: 768px` (inverse `max-width: 767px`) | Header nav bar replaces the drawer; `--form-gap` 20 → 24px; dialog padding 24 → 32px |
  | Columns | `min-width: 1024px` (inverse `max-width: 1023px`) | App pages go one column → rail / main / side; a rail may stick; page gutter 16 → 24px |
  | Frame | `min-width: 1200px` | The 1200px frame is reached; the header centres the library nav |

  A component query off this table must answer an observed collision, not a guess.

### Layout Principles

- **Reading text maxes out at `--reader-max-width` (680px).** Article bodies, the reader view and prose-led pages (the blog, marketing copy) cap their column at the token, never a literal `680px`. A page of cards has no reading measure: its main column is fluid (`minmax(0, 1fr)`) inside the 1200px frame, and card copy stays short (a title, a clamped excerpt, a one-line lede).
- **One measure per page column.** Stacked sections in a column — headings, prose, tab bars, input rows — share one content measure; never cap prose at a per-section `max-width` (e.g. `56ch`) while sibling controls run full-width. The one exception is a centred composition inside a card (an empty state), which may cap its message at ~44ch so centred lines stay short; the cap belongs to the composition, not the column. Left-aligned prose never takes a per-section cap.
- **Fixed-count card rows use an explicit column count** — the item count or a clean divisor of it. `auto-fit`/`minmax` can strand a lone card; reserve it for genuinely variable-length lists.
- **Container padding growth is only for a lone centred container.** Growing padding to 32–40px at `min-width: 768px` applies to a container that is the whole page's content (the sign-in card, a single-column form) and to dialogs. Cards in a multi-card app layout keep a fixed inset at every width — the frame's columns and gaps take up the extra width.
- **Generous whitespace is intentional.** Don't fill space because it's empty.
- **Align to grid.** Layout spacing uses the 4px base; 2px half-steps are allowed inside a component (see [Spacing Scale](#spacing-scale)). Avoid arbitrary pixel values.
- **Mobile first.** Every feature design starts with the smallest viewport.
- **Sticky header** with `position: sticky`, `top: var(--banner-area-height)` (it rides under the fixed announcement bars), a `1px solid var(--border)` bottom edge, and a `--background` fill whatever the page ground — on a `--muted` app page it stays a `--background` band and the border does the separating. **Anything else that sticks offsets from the measured chrome:** `top: calc(var(--banner-area-height) + var(--header-height) + <gap>)`, where the gap is the layout's own top padding, with the same fallbacks the shell's `scroll-padding-top` uses. Never hardcode the header height; the shell keeps `--banner-area-height` current as the banner wraps and measures `--header-height` when the header renders. A sticky column stops sticking once it folds into the single column.
- **Section background rhythm (marketing).** Long marketing pages alternate `--background` and `--muted` section bands so no two adjacent content sections share a fill; every muted band carries a `1px var(--border)` top/bottom rule. `--card` is a card-only surface, never a full-bleed section background.
- **An alert in a column of cards is a card.** It takes the card shape (fully enclosed, `--radius-lg`, tinted with its state's `-bg` token, bordered in its state colour, `14px 16px` padding) and sits in the stack like any sibling. The full-width-banner rule below stays for edge-to-edge banners, which have no border of their own.
- **Full-width status / alert banners** separate from the block below with `lg` (24px) minimum — never the `md` inter-element gap, and never a `clamp()` that collapses on the smallest viewport where a full-width alert most needs the separation.
- **The page scrolls down only, from 320px up.** No width from 320px to desktop scrolls sideways; content wraps. A text-bearing grid track is `minmax(0, 1fr)`, never a bare `1fr`; a text-bearing flex child sets `min-width: 0`; reader-supplied text breaks with `overflow-wrap: anywhere`. A row of controls (tabs, pagination) wraps rather than becoming a horizontal scroller. Only preformatted code scrolls sideways, in its own box. Wide tables reflow to stacked cards (see the [web skill](./.claude/skills/web/SKILL.md)).

---

## Voice & Copy

### Writing Principles

- **Talk like a person.** Imagine explaining the feature to a friend who's a developer. No marketing speak, no superlatives, no corporate filler.
- **Use contractions.** Write "Couldn't", "You're", "doesn't". "Could not" and "do not" read like a form letter.
- **Product copy is impersonal, but address the reader directly.** Impersonal means no "I" and no "we/our/us" as Readplace's voice; it does **not** mean no "you". Name the actor ("Readplace saves the article", "Readplace doesn't have an app for this device yet") and speak to the reader ("Your saved articles are still here.", "You can create up to 7 readlists."). First person belongs only to correspondence signed by Fayner Brack, Founder & CEO — and there it is "I", never "we".
- **First person needs a visible signature in the same block** — the founder's photo and name, as a greeting ("Hi, I'm Fayner Brack!") or a sign-off ("— Fayner Brack, Founder & CEO"). The "I" stops where that block stops; the checklist or page around it returns to product voice ("Your quick setup guide"). The founder's portrait — a circle, `object-fit: cover`, sized to the text beside it — is the only photograph Readplace supplies itself, and appears only beside his own words, never as decoration on a surface written in the product's voice.
- **A reply button may speak as the reader.** When a control answers a question the product asked, its label is the reader's reply ("Yes, delete it", "I've done this already", "Ok, I understand"). That "I" is the reader's, not Readplace's.
- **Say nothing about who or how many build Readplace, or about the business behind it.** Where a legal name is required, the operator is "Proficient Pty Ltd"; the word "company" does not appear in reader-facing copy.
- **Be specific over vague.** "Your article is saved" beats "Action completed." "Import your 847 Pocket articles" beats "Migrate your data."
- **Modest language.** Never "best", "revolutionary", "game-changing", "reimagined". The product speaks for itself.
- **Acknowledge limitations honestly.** "This feature isn't ready yet" beats hiding it or over-promising.
- **Affordances are shown, not narrated.** A scroll cue is a chevron, not a sentence. Never label an obvious gesture with explanatory microcopy — instructional filler is a machine-writing tell.

### Capitalisation

**Use sentence case by default.** Headings, dialog and alert titles, buttons, menu items, form labels, chips, toasts, placeholders and empty states capitalise only the first word and proper names: "Save something for later", "Create a readlist", "Mark as read", "Delete this readlist?", "Readlist limit reached". **Names keep their capitals:** Readplace, feature names ("Next Read"), and the labels of *places and lists* — nav destinations, tabs and list headers ("Import Links", "To Read (2)", "12 Unread"). A name the reader typed renders exactly as typed. Title Case on a button, menu item or form label is drift, not emphasis. The tagline keeps its own form (see [Brand Identity](#brand-identity)).

### Punctuation

**Labels stop bare; body text stops.** A heading, title, button, tab, chip, menu item, toast, placeholder or status label takes no full stop ("Nothing saved yet", "Marked as read", "50% complete"). A title that asks the reader to decide ends in "?" ("Delete this article?"). Body text — a lede, description, alert or dialog body, note or flash line — ends in a full stop however short ("Cancel anytime.", "Imported 3 of 5 links."). An ellipsis is the single character "…" ("Saving…"), never three dots. A spaced em dash joins a label to its detail ("Subscribe — $3/month", "Taking a while — open on example.com"). No "Please", no "Oops", no apology in an error.

### Terminology

**Name things consistently.** What a reader pastes, imports or forwards is a **link**. Once Readplace has saved it, it is an **article**. A named list of articles is a **readlist** — lowercase in running text ("Create a readlist", "Delete this readlist?"), capitalised only as a name (the "Readlist" nav item) or at the start of a line. "URL" stays out of reader-facing copy; it belongs on developer surfaces (MCP setup). "Queue" is retired.

### Numbers, Counts and Dates

- **Counts, limits and quantities use numerals**, including small ones: "7 readlists", "Save 50 articles", "0 Unread". Idioms stay words ("one-tap saving", "a few quick steps"). Pluralise from the count ("1 article", "2 articles"), never "article(s)".
- **Zero is an answer; unknown is silence.** Show "(0)" and "0 Unread". A count Readplace can't back yet is left off, leaving the bare label ("Unread", "To Read") — never a placeholder number.
- **Tab counts** read "Label (N)" and cap at "99+" (`formatTabCountLabel`). A count arriving later reserves the width of its widest form so the row doesn't move.
- **Progress** reads "N of M" ("Showing 2 of 2", "Saved 12 of 50") or "N% complete".
- **Formats:** thousands take a comma ("10,000"), estimates a tilde ("~3 min read"), dates read "Mar 1, 2027" (`toAbsoluteDate`), prices "$3/month". Numbers that tick or sit in tiles use tabular numerals. A number in a limit comes from the constant that enforces it, never a copied literal.

### UI Copy Patterns

| Context | Do | Don't |
|---|---|---|
| Empty states | Title: "Nothing saved yet" · Line: "Save your first article by pasting a link above, or set up one-tap saving from your browser, phone, or AI assistant." · Action: **Set up one-tap saving** | "Wow, it's empty in here!" |
| Confirmations (status) | Toast: "Marked as read", with an **Undo** action | "Awesome! Successfully saved to your library!" |
| Errors | Title: "Readlist limit reached" · Body: "You can create up to 7 readlists. Delete an existing readlist before creating a new one." | "Oops! Something went wrong" |
| Decisions (confirm dialogs) | Title: "Delete this article?" · Body: the consequence ("Anything you also saved in All stays there.") · Buttons: **Yes, delete it** / **Yes, delete it and don't ask again** | "Are you sure?" · **OK** / **Cancel** |
| Loading / in progress | The control's label becomes "Saving…"; a skeleton carries "Saving…"; an overrun says "Taking a while — open on example.com" | "Hang tight! We're fetching your stuff!" |
| Onboarding steps | Step: "Get articles from email" · Why: "Forward a newsletter, or any email with links in it, and the links are saved here for you to read." · Progress: "Saved 12 of 50" | "Welcome to the future of reading!" |

- **An empty state** has three parts: a title stating the fact ("…yet" while emptiness is temporary, plain acknowledgement when empty is the goal — "You're all caught up"), one or two sentences on how the list fills, then one or two buttons that take the next step — never a link buried in the sentence.
- **A status toast** names the outcome in past tense with no full stop; a reversible change carries **Undo**, an irreversible one asks first.
- **An error's title** names what failed ("Couldn't rename the readlist"); the body gives the cause the reader can check, with the actual limit when there is one, and what to do next.
- **A confirm dialog's title** is a yes/no question naming the action and object; the body states the consequence and what survives; the confirm button answers in the reader's words ("Yes, delete it"), with a "don't ask again" twin as the secondary where the dialog can be skipped.
- **In-progress copy** is short, starts with a present participle ("Saving…", "Processing", "Loading your articles…"), and sits where the result will land.
- **A setup step** is an imperative naming the concrete thing ("Install the Chrome browser extension"), then one or two sentences on what it gets the reader; progress is stated in numbers.

### Tone Rules

- **No emojis in UI.** Fine in social posts or community replies, never in the product interface.
- **An exclamation mark is reserved for two moments:** a milestone the reader just finished ("Import complete — 1,247 articles are now in Readplace!") and the founder's signed greeting ("Hi, I'm Fayner Brack!"). Never in a status message, toast, error, button, dialog or advisory.
- **No self-deprecating humour in error states.** Errors are frustrating. Be clear and helpful, not cute.

---

## Platform-Specific Guidance

### Browser Extension

- The toolbar icon is the standalone ampersand mark at 16×16 / 32×32px (dotless at those sizes, per the size cutover), themed light/dark per toolbar.
- The popup should feel like a utility — fast, minimal, single-purpose. Open → save → close. Width: `350px`.
- Respect the user's browser theme via `prefers-color-scheme`.
- No marketing or upsells inside the popup. It's a tool, not a billboard.

### Web App

- The primary reading interface. Design every pixel for long reading sessions.
- **The header has three zones:** the brand on the left, the library destinations centred, the signed-in account on the right. Below 768px they fold into a hamburger opening a full-height drawer from the right (`--background`, a `--border` edge, `--shadow-md`, no slide under reduced motion). Each destination is an outline icon plus a short label, both `--foreground`, 14px/500 with a `--radius` corner and a `--muted` hover — never amber or filled. Group names are hidden on the bar (kept for screen readers) and show in the drawer as short uppercase labels. The header has **no current-page state**: a page with its own sections shows where the reader is in its rail or tabs (`aria-current="page"`).
- **Announcement bars are navy and sit above the header.** A site-wide announcement (the changelog, email verification) is a flat `--color-secondary` bar with centred `--color-on-brand` text at 14px/500, no border or shadow. A state bar keeps its state colour instead: a locked account turns the verification bar `--error-fill` (with `--error-foreground`, pinned), and the offline notice is a `--warning-bg` band with `--foreground` ink. Never paint bar ink with `--color-secondary` — it is a pinned fill; navy ink uses `--color-secondary-text`.
- **The signed-in account is named, not hidden behind an icon.** The right zone shows an initials avatar (a 28px circle in `--color-avatar` with two white 11px/700 initials from the email), the account email on one line with an ellipsis, and a `chevron-down` that turns 180° while open. Account actions (Account, Sign out) live only in its dropdown, which closes on outside click and Escape. The avatar is decorative (`aria-hidden`) — the email beside it is the accessible name. In the phone drawer the identity is a static row above the account items.
- **A section rail is a quiet vertical list.** A sentence-case sans heading (15px/600, `--foreground`, indented to the row text) above rows ≥44px tall (`10px 12px`, `--radius`). Each row is an 18px outline icon in `--muted-foreground` and a 14px/500 `--foreground` label; a long label wraps rather than truncating; the current row takes the selected treatment (`--secondary` fill, `--primary-text` ink, `aria-current="page"`). The row that adds an entry is the rail's last row (same geometry, a `plus` icon, a muted label), styled as a row not a `.btn` — the same exception the header's Sign out takes — and removed rather than disabled for an account that cannot write. Per-row actions live in that row's overflow [menu](#menus), and only rows the reader can change have one.
- **Signed-in pages follow the reader's Appearance setting** (see [Colour Rules](#colour-rules)). No signed-in page pins a theme.
- **The landing hero uses a transparent header** (`.header--transparent`): no fill, no border, laid over the navy hero. The wordmark is white with a `--color-highlight` tail; links, icons and the account trigger are white with a translucent white hover. Anything that opens from it (the dropdown, the drawer) is a normal `--card`/`--background` surface with `--foreground` ink.
- Keyboard shortcuts for power users. Document them, make them discoverable, but don't require them.
- Default to clean, distraction-free views. Tags, search and filters accessible but not competing with the reading surface.

### Mobile (Future)

- Touch targets minimum 44×44px.
- The save flow should be possible via share sheet / system share — no need to open the app.
- Offline reading is a first-class feature. Design for it from day one.
- Respect platform conventions (iOS HIG, Material Design) while maintaining Readplace's visual identity. Don't fight the platform.

### CLI (Future)

- Output should be plain and readable in any terminal emulator.
- Use colour sparingly — stick to the terminal's default palette. Amber for highlights if colour is supported.
- Respect `NO_COLOR`.
- Help text concise, following GNU conventions.

### Email / Newsletters

- HTML emails should use the warm amber palette.
- Keep emails short. One purpose per email, one CTA.
- Always include a plain-text version.
- Sender name: "Fayner from Readplace" (personal, not corporate). Sign off "— Fayner Brack, Founder & CEO".

---

## Do's and Don'ts — Quick Reference

### Do

- Lead with warm amber (`--primary` fills, `--primary-text` ink).
- Use generous whitespace and spacing.
- Write like a human talking to another human, in sentence case.
- Design for reading comfort above everything.
- Test every UI against both light and dark modes.
- Maintain the quiet, confident, crafted tone.
- Make the product feel fast and lightweight.
- Use the CSS custom properties defined in `base.styles.ts` — never hardcode colour values.

### Don't

- Use pure black, neon colours, or heavy gradients.
- Add emojis, playful copy, or an exclamation mark outside a finished milestone or a signed greeting.
- Use "I", "we" or "our" as Readplace's voice — "I" belongs to signed correspondence, or to a button written as the reader's reply.
- Clutter the reading surface with chrome, toolbars, or feature promotions.
- Copy any competitor's visual language (especially Pocket's red or Readwise's yellow).
- Sacrifice legibility for aesthetics.
- Ship something that feels like a startup template.
- Hardcode hex values or button padding — always use the tokens.

---

*Last updated: September 2026*
