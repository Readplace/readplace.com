# Readplace — Brand & Design Guidelines

> Internal reference for anyone building Readplace — developers, designers, contributors.
> Consult this before shipping UI, writing copy, or producing any public-facing asset.

---

## Brand Identity

**Tagline:** Read the Web, not the Slop.

Use this exact form on brand and user-facing surfaces — *Web* and *Slop* capitalised (the two nouns being contrasted), *the* and *not* lowercase, ending in a full stop. It is deliberate noun emphasis: not title case (*not* stays lowercase) and not sentence case (*Web* and *Slop* stay capitalised). Two intentional exceptions: the homepage SEO **keywords** meta uses the comma-free, all-lowercase `read the web not the slop` for keyword matching; and when the phrase runs **mid-sentence as prose** it follows that sentence's case (e.g. "…a place where you read the web, not the slop."). A standalone line or sign-off uses the canonical form above.

**What Readplace is:** A read-it-later app that saves articles, blog posts, and web pages for later reading. Born from a personal reading system refined over 10 years.

**What Readplace feels like:** A well-made tool built by someone who uses it every day. A private reading nook in a home library — warm wood, good lighting, no distractions. Not a co-working space. Not a productivity dashboard. A quiet place that's yours.

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

Every raster asset is generated — never hand-rendered — by `projects/hutch/scripts/generate-brand-assets.mjs` from the vector sources of truth (`brandMarkSvg` in `@packages/web-shell`, `favicon.svg`, and the path-based lockup masters in `projects/hutch/brand/`). To change the mark, change those sources and re-run the script; do not edit or screen-render individual PNGs (screen renders bake the generating monitor's subpixel fringing into the brand).

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
- **Size cutover:** The amber dot ships only at renders **≥ 33px**. Below that (the 16–32px favicon class) use the dotless small-size variant (`favicon.svg` geometry — glyph enlarged 12%, no dot). A dot at those sizes is a smudge that collides with the glyph.
- **Do not** rotate, skew, add drop shadows, apply gradients, or place on busy photographic backgrounds.
- **Do not** recreate or approximate the logo — always use the provided assets.
- **Do not** remove or reposition the amber dot, recolour the ampersand, or change the navy background fill.
- **Backgrounds:** The mark already contains its navy rounded-square tile — keep the full mark intact on both light and dark surfaces rather than swapping fills.
- **Keyline (part of the mark):** The tile carries a hairline white keyline (`#FFFFFF` at 40% opacity, ~1px rendered) stroked on its edge. It is present on every surface and alpha-composites against whatever sits behind the mark, so the navy tile stays delineated at ≥3:1 contrast on dark/navy surfaces (blog/web header in dark mode, extension popup, the navy hero, a dark browser tab strip) where an opaque navy tile would otherwise dissolve into the background. It is imperceptible on light surfaces (the tile is already ~11:1 there), so it is always on. **Do not** remove it, and never lighten the navy fill to compensate — the keyline is what makes the mark legible on dark, not a fill change.
- **`Readplace_Logo_only.svg` is not a web asset.** `projects/hutch/brand/Readplace_Logo_only.svg` is a tile-less navy ampersand kept only as source geometry for the iOS icon pipeline. It has no tile and no keyline, so on web or dark surfaces the navy glyph would vanish — never render it there. Use the full mark everywhere on the web (`brandMarkSvg` from `@packages/web-shell`, `favicon.svg`, or `/embed/icon.svg`).

---

## Colour Palette

> **Source of truth:** `src/packages/web-shell/src/base.styles.ts`

### Primary Colours

| Role | Colour | Hex / HSL | CSS variable | Usage |
|---|---|---|---|---|
| **Warm amber** (Primary) | Warm terracotta/amber-brown | `#c8702a` / `hsl(27 65% 47%)` | `--color-brand`, `--primary`, `--accent` | Interactive elements, CTAs, default header brand text. Not text ink on a light page: it is 3.62:1 on white |
| **Amber dark** | Darker amber | `#a85a1e` | `--color-brand-dark`, `--primary-fill` | Brand text and links on a light page (via `--primary-text`); the hover/active fill of every button (via `--primary-fill`, which is pinned to this value in **both** themes). Never reach for `--color-brand-dark` directly as a hover fill — it flips to a *lighter* `#e89a55` in dark mode, so the hover would darken on a white page and lighten on a dark one |
| **Amber light** | Pale amber tint | `#f5e6d3` | `--color-brand-light` | Subtle brand-tinted backgrounds |
| **Warm amber highlight** | Warm gold — the logo dot colour | `#c8923c` | `--color-highlight` | Highlight words in the wordmark and copy (see Highlight Words below) |
| **Navy** (Secondary) | Deep navy blue | `#2B3A55` | — | Hero background, manifest theme colour, meta tags, extension icon background, extension active states |

### Neutrals

| Role | Light Mode | Dark Mode | CSS variable | Usage |
|---|---|---|---|---|
| **Background** | `#ffffff` | `#121212` | `--color-background` | Page/canvas background |
| **Surface** | `#F7F8FA` | `#1a1a1a` | `--color-surface` | Cards, panels, secondary containers |
| **Surface Elevated** | `#ffffff` | `#222222` | `--color-surface-elevated` | Elevated cards, popovers |
| **Border** | `#E2E5EA` | `#2e2e2e` | `--color-border` | Dividers, input borders, subtle separators |
| **Text — Primary** | `#1A202C` | `#e4e4e4` | `--color-text-primary` | Body text, headings |
| **Text — Secondary** | `#5A6170` | `#9BA1AE` | `--color-text-secondary` | Captions, placeholders, metadata |
| **Text — Muted** | `#8C919D` | `#6b6b6b` | `--color-text-muted` | Disabled states, timestamps |
| **Footer Background** | `#1a1a1a` | `#0d0d0d` | `--footer-bg` | Site footer |

### Functional Colours

| State | Light Mode | Dark Mode | CSS variable | Notes |
|---|---|---|---|---|
| **Success** | `#3D8B6E` | `#4a9f7f` | `--color-success` | Saved confirmations, sync complete |
| **Warning** | `#C8923C` | `#d4a04a` | `--color-warning` | Non-critical alerts |
| **Error** | `#C45C5C` | `#d46b6b` | `--color-error` | Validation errors, failed saves, destructive actions |
| **Error fill** | `hsl(0 43% 52%)` | same | `--error-fill`, `--error-fill-hover` | The solid red of a destructive *surface* — the confirm button in a delete dialog. Pinned to the same value in **both** themes, like `--primary-fill`, and carries `--error-foreground` at 4.85:1. Never fill with `--error` (4.17:1 under white) or `--error-text` (flips to a *lighter* `#D46B6B` in dark, so the fill would invert) |
| **Info** | `#4A7FB5` | — | — | Informational banners, tips |

### Dark Mode Brand Adaptations

In dark mode, the brand colours shift slightly warmer and lighter to maintain contrast:

| Role | Light | Dark | CSS variable |
|---|---|---|---|
| Brand | `#c8702a` | `#d4833a` | `--color-brand` |
| Brand dark | `#a85a1e` | `#e89a55` | `--color-brand-dark` |
| Brand light | `#f5e6d3` | `#3d2a18` | `--color-brand-light` |
| Primary | `hsl(27 65% 47%)` | `hsl(27 65% 52%)` | `--primary` |

### Colour Rules

- **Never use pure black** (`#000000`) for backgrounds or text. Use the dark neutrals above.
- **Never use Pocket red**, Readwise yellow, or neon/high-saturation accents.
- **Dark mode is not an inversion.** Colours adapt to slightly warmer, lighter variants — it doesn't simply flip to white-on-black. Test every colour pairing against both backgrounds.
- **Warm amber on dark backgrounds** is the signature brand combination. When in doubt, lead with this pairing.
- **Reading surfaces should be neutral.** The amber appears in chrome and UI — never as the background behind article text. Article content sits on white/off-white (light) or dark grey (dark).
- **Hero gradient:** `linear-gradient(135deg, #2B3A55 0%, #1E2A40 100%)` — a deep navy gradient that mirrors the logo tile. Warm amber highlights (`--color-highlight`) sit directly on this background.
- **Inline text links use one token — `--primary-text`.** Light `--primary` is 3.62:1 on white, under the 4.5:1 floor the non-negotiable legibility rule in [Typography Rules](#typography-rules) implies, so the link token is the darker amber that clears it (5.06:1 light, 6.34:1 dark). `--primary` keeps the fills it already carries; it is not a link colour. Do not introduce a third amber (`--color-highlight`, `--color-brand`) for a link, and do not redeclare link colour per block. Emphasis inside a link comes from weight (`<strong>`), never a different hue. There is no global bare-`<a>` reset, so an unstyled link renders browser-default blue — that is a styling gap, not a choice; every body-copy link must set `color: var(--primary-text)`.

### Browser Extension Palette

The Firefox extension uses a slightly different palette tuned for small popup contexts:

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
| **Body / UI** | `--font-sans` → `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (Inter loaded from Google Fonts, weights 400–700) | 400, 500, 600, 700 | `base.styles.ts` → `LIGHT_THEME_VARIABLES`, applied on `body` in `BASE_RESET_STYLES`; `base.template.ts` preload link |
| **Headings** | `--font-serif` → `Georgia, "Times New Roman", serif` | 600, 700, 800 | `base.styles.ts` → `LIGHT_THEME_VARIABLES`. Reference implementations: `home.styles.css`, `import.styles.css` |
| **Extension UI** | `Inter, "Source Sans Pro", system-ui, -apple-system, sans-serif` | — | `popup.styles.css` — the popup ships its own stylesheet and never sees the tokens |
| **Brand serif** | `--font-serif` | — | Header wordmark (`.header__brand`); extension popup brand text uses the literal, for the same reason |
| **Reader view** | User-configurable (default: high-legibility serif or sans) | Regular | Article body text in reading mode — this is the user's space |

### Typography Rules

- **Headings are serif; everything you operate is sans.** Every first-party page title (`h1`) and section-level heading (`h2`) uses `var(--font-serif)`. `var(--font-sans)` is reserved for body copy, UI controls, form labels, metadata, and code/mono. The rule is heading-**level**, not the tag: an in-card sub-label (the Import FAQ `h3`), an eyebrow, an empty-state message, or a modal's `aria-labelledby` line is UI, and stays sans. Never inline the `Georgia, "Times New Roman", serif` stack — the font stack has one source of truth, like colours, so a heading cannot silently ship in the body face because its rule forgot the declaration. A heading that inherits the body sans is a drift, not a choice.
- **Legibility is non-negotiable.** This is a product about reading. If a type choice looks good but reads poorly, reject it.
- **Line-height:** Body text uses `1.6` (set in `BASE_RESET_STYLES`). Minimum `1.3` for headings. Generous spacing is a feature, not a waste of space.
- **Never use all-caps** for more than short labels (e.g., "SAVED", "NEW"). Never for headings or body text.
- **International support:** Typefaces must include full Latin Extended character sets (Portuguese, accented characters). The founder is Brazilian-Australian — this is table stakes.
- **Avoid trendy typefaces.** If it will look dated in 2 years, don't ship it.
- **Orphan control.** Prose body copy uses `text-wrap: pretty`; multi-word headings use `text-wrap: balance`. Scope both to the prose/heading selectors — never on `body` (a global `text-wrap` forces a full-page reflow). A single word must never be stranded on a text block's last line. **Exceptions:** an intentional keyword focal point is a designed single-word line and is left alone; a centred title that should read as a top-wide pyramid uses `pretty`, not `balance`, so its first line stays widest. Single-word *headings* (`Cookies`, `Contact`, `Termination`) are acceptable when the visual design is intentional — `balance` is a no-op on them.
- **One-word page titles get deliberate visual mass.** A single-word page title (e.g. the blog `Blog` H1) is given larger size, heavier weight, and/or negative letter-spacing so the whitespace beside it reads as intentional rather than as an unfinished heading.

### Highlight Words

A single highlight word inside a phrase can be recoloured with `--color-highlight` (warm amber `#c8923c` — the logo dot) to draw the eye without bolding, underlining, or changing size. The pattern is analogous to how the **Read**_place_ wordmark splits the brand into a white stem and an amber tail.

**Rules:**

- Use the same serif face as the surrounding text (`var(--font-serif)`). The highlight is colour, not type.
- **No weight or size change.** Motion or contrast does the work — bold would be shouting.
- **Never add space** between the default-colour prefix and the highlight word. Readplace is one word, not two.
- One highlight per phrase. If two words need emphasis, pick the stronger one.
- The highlight is visible against navy, white, and muted surfaces. On the warm amber gradient it collapses — choose navy or another neutral for those panels.

**Canonical uses:**

- **Wordmark:** `Read<span class="header__brand-mark">place</span>` — the header brand logo.
- **Copy:** sentences where one noun is doing load-bearing work — e.g. `We respect your <span>privacy</span>.`

---

## Iconography & UI Elements

### Icon Style

Every UI icon comes from [`@packages/ui-icons`](./src/packages/ui-icons/src/ui-icons.ts), which defines the one line spec. Add a drawing there rather than at a call site.

- **No icon font, no icon CDN, no entity or Unicode glyph (`× ↓ ← → ✓ ✗ ● ▾`), no emoji.** A font glyph's stroke follows the system font and an SVG's does not, so mixing them puts two visual weights on one row — the tell that icons were picked at different times.
- **Filled colour is only for brand and logo marks.** Never a UI icon, and never primary navigation.
- **Typographic punctuation stays text** — em dash, ellipsis, curly quotes, bullet dividers are copy. A plain shape (an unread dot) is CSS, not an icon.
- **An icon carrying meaning alone needs an `.sr-only` twin.** `htmlToMarkdown` drops `<svg>`, so a lone icon reaches AI clients and screen readers as an empty cell.

### List Markers

List markers carry polarity. An included / positive item takes the `check` icon in a success colour; an excluded / negative item — a "what this will **not** do" list — takes the `x` icon in `--color-text-muted` (or `--color-error` for a louder refusal), as `.comparison-table__cross` does. Never mark an exclusion list with a neutral dash or bullet — a dash reads as a feature, not a refusal.

### Buttons

> **Source of truth:** `BUTTON_STYLES` in `src/packages/web-shell/src/base.styles.ts`, injected into every page's `<head>`.

There is **one** button in the product. Every call to action is `.btn` plus exactly one variant, plus — only where its surroundings demand it — one tier modifier. A page stylesheet may add layout (`width`, `margin`, grid/flex placement, `white-space`) and nothing else. A per-page button base class is what let the fill token, radius, height, font size, and hover direction drift apart across ten pages; it is not allowed. See the [web skill](.claude/skills/web/SKILL.md#buttons-come-from-the-shared-system).

#### Variants

| Variant | Style | Usage |
|---|---|---|
| **`primary`** | Amber fill (`--primary`), white text (`--primary-foreground`) | The amber CTA — main action per screen (Save, Import, Subscribe, install, landing and pricing CTAs) |
| **`secondary`** | Subtle amber tint (`--secondary`), amber text (`--primary-text`), 1px inset amber outline | The supporting action beside a primary (View on GitHub, Cancel, Back) |
| **`on-dark`** | White fill, dark-amber text (`--secondary-foreground`) | *Context modifier, not a priority level* — a primary sitting on the navy hero |
| **`on-dark-ghost`** | Translucent white fill, white text, translucent white inset outline | *Context modifier* — the secondary beside an `on-dark` primary |

`primary` **always** means the amber CTA. The `--brand`, `--light` and `--dark` aliases are retired: a variant whose name contradicts this table is naming drift, not a choice. `on-dark` and `on-dark-ghost` carry theme-stable values because the navy hero is navy in both themes.

A **tertiary** action is not a button — it is a plain inline link (`color: var(--primary-text)`, underlined) per [Colour Rules](#colour-rules). Do not render it as a `.btn`, and do not put one beside a button (see Pairing).

A **destructive** action (delete, remove, unsave — muted red outline, red text, solid on hover) is still styled per page (`.account-card__action--destructive`) and has not been folded into this system.

#### Pairing

When two buttons sit side by side, the **first is the primary action and the second is the secondary action** — always in that order, never two of the same weight, and never a button beside a bare text link. A repeated action keeps **one** variant everywhere it appears on a page: if "View on GitHub" is an outlined button in the hero, it is an outlined button in the closing CTA band too, not a text link.

#### Size and padding

> Defined in `base.styles.ts` as CSS custom properties. Reference the tier token — never hardcode button padding.

Every button carries `min-height: 44px` and `border-radius: var(--radius-sm)` (6px) **regardless of tier**, so the touch target and the corners are identical on desktop, tablet, and mobile. The padding tiers below **never change per breakpoint** — the 44px floor is the mobile guarantee, not a per-breakpoint padding override. The tier is chosen by *where the button sits*, not by how important it is.

| Tier | Modifier | Value | CSS variable | Usage |
|---|---|---|---|---|
| **Default** | — | `12px 24px` | `--button-padding` | A CTA on its own line — hero, landing, install, pricing card, import commit |
| **Field-aligned** | `.btn--field` | `min-height: 48px` + `0 24px` | `--input-height`, `--button-padding-x` | A CTA beside a text input, so the row lines up (Save, Fetch links, Upload, auth submit). The input keeps `padding: var(--input-padding)` |
| **Compact** | `.btn--compact` | `8px 16px` | `--button-padding-sm` | A banner or in-card CTA (Subscribe, onboarding Install) |
| **Small / Icon** | — | `4px 8px` | `--button-padding-xs` | Icon, close, dismiss, and row-toggle buttons — sized to content, not `.btn` |

Vertical padding (`12px`) matches `--input-padding`; horizontal follows the 4px spacing scale (`lg` 24 / `md` 16 / `sm` 8). Disclosure toggles (`<details>`/`<summary>` panel headers) and circular icon buttons (the share bubble) are sized to their content, not these tiers.

#### Hover and active

**Hover and active swap the fill — they never fade it.** One mechanism (`background-color`) and one direction: the fill moves *away* from the surface behind it, so the button gains presence rather than losing it.

- A filled amber button darkens to `--primary-fill`. That token is **pinned to the same value in both themes**, so the direction cannot invert, and it carries `--primary-foreground` at 5.06:1.
- A tinted or translucent variant deepens its own fill by the same mechanism.
- **Never `opacity` on a button that has a fill.** It fades the label along with the background, so the button reads as disabled. `opacity: 0.5` is reserved for the actual disabled state.
- **Never `filter: brightness()`** — it lightens, which is the opposite direction.
- **Never `--color-brand-dark` as a hover fill** — it inverts lightness between themes (see [Primary Colours](#primary-colours)).

### Border Radius

> Defined in `base.styles.ts` as CSS custom properties.

| Token | Value | CSS variable | Usage |
|---|---|---|---|
| Small | `6px` | `--radius-sm` | Buttons, inputs, chips |
| Default | `8px` | `--radius` | Cards, panels, navigation links |
| Large | `12px` | `--radius-lg` | Modals, dialogs, dropdown menus |

**Never fully rounded** (pill shapes) for primary UI. This isn't a social app.

A card laid out in a grid is a fully-enclosed box — `1px solid var(--border)` plus a `--radius*` corner. Reserve a bottom-border-only separator for a vertical divided list; never use it for a grid tile, which reads as half-drawn beside its neighbours.

### Shadows & Elevation

> Defined in `base.styles.ts`.

| Token | Light Mode | Dark Mode | CSS variable |
|---|---|---|---|
| Small | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.3)` | `--shadow-sm` |
| Medium | `0 4px 6px rgba(0,0,0,0.07)` | `0 4px 6px rgba(0,0,0,0.4)` | `--shadow-md` |

- Use shadows sparingly. Prefer subtle borders or background colour shifts over drop shadows.
- Maximum two levels of elevation in any screen. Flat is the default.

---

## Spacing & Layout

### Spacing Scale

Use a **4px base unit** with the following standard increments:

| Token | Value | Usage |
|---|---|---|
| `xs` | 4px | Inline spacing, tight gaps |
| `sm` | 8px | Between related elements, icon-to-label gaps |
| `md` | 16px | Standard padding, between list items |
| `lg` | 24px | Section padding, card internal padding |
| `xl` | 32px | Between major sections |
| `2xl` | 48px | Page-level margins, hero spacing |

### Form Inputs

> Defined in `base.styles.ts`.

| Token | Value | CSS variable |
|---|---|---|
| Height | `48px` | `--input-height` |
| Padding | `12px 16px` | `--input-padding` |
| Font size | `16px` | `--input-font-size` |
| Form gap | `20px` (24px on desktop) | `--form-gap` |

**An input paired with a button shares the button's height.** When a text input sits inline with a button (search / save bars, the inbox create row, the import from-url bar, the landing paste field), set `height: var(--input-height)` on the input and give the button the `.btn--field` tier — it carries `min-height: var(--input-height)` and `padding: 0 var(--button-padding-x)` so the row lines up. The input keeps `padding: var(--input-padding)`. Because `box-sizing: border-box` is global, an explicit shared height is the only reliable equaliser — never hand-tune vertical padding or font-size to fake the match, and never re-declare the height on the button itself (see [Buttons](#buttons)). Canonical pairs: `.queue__save-input` / the queue Save button, `.lp-action__input` / the landing hero CTA.

### Layout Principles

- **Content width for reading should max out at ~680px.** Wider text blocks reduce readability. Chrome and navigation can extend wider (max-width `1000px` for header/footer), but article content stays narrow.
- **One measure per page column.** Stacked sections in a column — headings, prose, tab bars, input rows — share one content measure; never cap prose at a per-section `max-width` (e.g. `56ch`) while sibling controls run full-width.
- **Fixed-count card rows use an explicit column count** — the item count or a clean divisor of it. `auto-fit`/`minmax` can strand a lone card in an empty cell; reserve it for genuinely variable-length lists.
- **Responsive container padding.** Card and container padding starts at the `lg` 24px token and grows to 32–40px at `@media (min-width: 768px)` — the same breakpoint `src/packages/web-shell/src/base.styles.ts` uses for `--form-gap`.
- **Generous whitespace is intentional.** Don't fill space because it's empty. Breathing room is core to the brand.
- **Align to grid.** All spacing should use the 4px base. Avoid arbitrary pixel values.
- **Mobile first.** Every feature design starts with the smallest viewport. The extension popup, mobile web, and app are the most constrained contexts — design for those first.
- **Sticky header** with `position: sticky` and `1px solid var(--border)` bottom border. Background matches `--background`.
- **Section background rhythm.** Long marketing pages alternate `--background` and `--muted` section bands so no two adjacent content sections share a fill; every muted band carries a `1px var(--border)` top/bottom rule so grouping stays legible where an accent (the navy hero, a `--card` surface) interrupts the alternation. `--card` is a card-only surface, never a full-bleed section background. See the `.lp-band--muted` pattern in `landing-pages.styles.css` and `.home-band--muted` in `home.styles.css`.
- **Full-width status / alert banners** separate from the block below with `lg` (24px) minimum — never the `md` inter-element gap, and never a `clamp()` that collapses to a tighter value on the smallest viewport, where a full-width alert most needs the separation.

---

## Voice & Copy

### Writing Principles

- **Talk like a person.** Imagine explaining the feature to a friend who's a developer. No marketing speak, no superlatives, no corporate filler.
- **Use "I" not "we."** Readplace is solo-built. "I" is more honest and personal.
- **Be specific over vague.** "Your article is saved" beats "Action completed." "Import your 847 Pocket articles" beats "Migrate your data."
- **Modest language.** Never say "best", "revolutionary", "game-changing", "reimagined". The product speaks for itself.
- **Acknowledge limitations honestly.** "This feature isn't ready yet" is always better than hiding it or over-promising.
- **Affordances are shown, not narrated.** A scroll cue is a chevron, not a sentence. Never label an obvious UI gesture with explanatory microcopy ("keep scrolling, the story is below") — instructional filler is a machine-writing tell; let the animated cue carry it.

### UI Copy Patterns

| Context | Do | Don't |
|---|---|---|
| Empty states | "Nothing saved yet. Hit the extension button on any page to start." | "Wow, it's empty in here!" |
| Confirmations | "Article saved." | "Awesome! Successfully saved to your library!" |
| Errors | "Couldn't save this page. Try again?" | "Oops! Something went wrong" |
| Loading | "Loading your articles..." | "Hang tight! We're fetching your stuff!" |
| Onboarding | "Save articles. Read them later. That's it." | "Welcome to the future of reading!" |

### Tone Rules

- **No emojis in UI.** Emojis are fine in social posts or community replies, never in the product interface.
- **No exclamation marks in confirmations or status messages.** Save those for moments that actually warrant excitement (e.g., "Import complete — 1,247 articles are now in Readplace!").
- **No self-deprecating humour in error states.** Errors are frustrating. Be clear and helpful, not cute.

---

## Platform-Specific Guidance

### Browser Extension

- The toolbar icon is the standalone ampersand mark at 16×16 / 32×32px (dotless at those sizes, per the size cutover), themed light/dark per toolbar (see `projects/browser-extensions/{chrome,firefox}-extension/src/icons/{light,dark}/`).
- The popup should feel like a utility — fast, minimal, single-purpose. Open → save → close. Width: `350px`.
- Respect the user's browser theme. Match system light/dark mode via `prefers-color-scheme`.
- No marketing or upsells inside the extension popup. It's a tool, not a billboard.

### Web App

- The primary reading interface. Design every pixel for long reading sessions.
- Navigation should be quiet and out of the way. The article list and reader view are the product — everything else is supporting cast.
- Keyboard shortcuts for power users. Document them, make them discoverable, but don't require them.
- Default to clean, distraction-free views. Features like tags, search, and filters should be accessible but not visually competing with the reading surface.
- Header uses a transparent variant (`.header--transparent`) on the landing page hero, switching brand text to `--color-on-brand` (white).

### Mobile (Future)

- Touch targets minimum 44×44px.
- The save flow should be possible via share sheet / system share — no need to open the app.
- Offline reading is a first-class feature. Design for it from day one.
- Respect platform conventions (iOS Human Interface Guidelines, Material Design) while maintaining Readplace's visual identity. Don't fight the platform.

### CLI (Future)

- Output should be plain and readable in any terminal emulator.
- Use colour sparingly — stick to the terminal's default palette for compatibility. Amber for highlights if colour is supported.
- Respect `NO_COLOR` environment variable.
- Help text should be concise and follow GNU conventions.

### Email / Newsletters

- HTML emails should use the warm amber palette.
- Keep emails short. One purpose per email, one CTA.
- Always include a plain-text version.
- Sender name: "Fayner from Readplace" (personal, not corporate).

---

## Do's and Don'ts — Quick Reference

### Do

- Lead with the warm amber palette (`--primary` / `--color-brand`).
- Use generous whitespace and spacing.
- Write like a human talking to another human.
- Design for reading comfort above everything.
- Test every UI against both light and dark modes.
- Maintain the quiet, confident, crafted tone.
- Make the product feel fast and lightweight.
- Use the CSS custom properties defined in `base.styles.ts` — never hardcode colour values.

### Don't

- Use pure black, neon colours, or heavy gradients.
- Add emojis, exclamation marks, or playful copy to the product UI.
- Use "we" — Readplace is solo-built; use "I" or speak from the product's perspective.
- Clutter the reading surface with chrome, toolbars, or feature promotions.
- Copy any competitor's visual language (especially Pocket's red or Readwise's yellow).
- Sacrifice legibility for aesthetics.
- Ship something that feels like a startup template.
- Hardcode hex values — always use the CSS custom properties.
- Hardcode button padding — use the `--button-padding*` tier tokens.

---

*Last updated: July 2026*
