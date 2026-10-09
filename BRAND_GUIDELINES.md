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
| **Amber fill** | `hsl(27 65% 41%)` `#AD6225` | same (pinned) | `--primary` | The fill of every amber CTA at rest. The lightest step of the hue that carries white `--primary-foreground` at ≥4.5:1 (4.61:1). Not ink on a surface |
| **Amber fill, hover** | `hsl(27 65% 37%)` `#9C5821` | same (pinned) | `--primary-hover` | Hover of an amber fill; 5.48:1 under white |
| **Amber fill, pressed** | `hsl(27 65% 33%)` `#8B4F1D` | same (pinned) | `--primary-fill` | Active (pressed) of an amber fill, and nothing else; 6.49:1 under white |
| **Amber ink** | `#A85A1E` | `hsl(27 65% 58%)` | `--primary-text` | Every amber word or small amber mark on a neutral surface: links, a title's hover, the unread dot, a work-in-flight mark. 5.06:1 on white, ~6:1 on the dark card. Never on the amber tint (4.13:1 there) |
| **Amber tint** | `var(--color-brand-light)` `#F5E6D3` | `#3D2A18` | `--secondary` | The ground of a secondary button, a selected navigation row and any amber-tinted chip or badge (see [Colour Rules](#colour-rules)) |
| **Amber tint, hover / pressed** | `#EED7BA` / `#E6C9A3` | `#4A3320` / `#5A3E26` | `--secondary-hover`, `--secondary-pressed` | The secondary button's hover and pressed fills |
| **Amber ink on the tint** | `hsl(27 65% 30%)` `#7E481B` | `#EAA162` | `--primary-text-on-tint` | Every amber word or icon on the tint: a secondary button's label, a selected navigation row, a badge. 6.06 / 5.32 / 4.68:1 on the light tint at rest / hover / pressed, 6.33 / 5.47 / 4.54:1 on the dark tint |
| **On-dark amber ink** | `hsl(27 65% 35%)` | same (pinned) | `--secondary-foreground` | The label of a white `.btn--on-dark` |
| **Brand amber** | `#C8702A` | `#D4833A` | `--color-brand` | Non-text marks only: a control's outline (the secondary button's 1px edge, 3.62:1 on white and 5.38:1 on the dark card), an illustration's amber fills, the light-theme wordmark tail (large text, 3.62:1). 3.62:1 on white, so never body words and never a button fill |
| **Brand dark** | `#A85A1E` | `#E89A55` | `--color-brand-dark` | The palette value behind light `--primary-text`. Never referenced directly — it lightens in dark, so as a hover fill it would invert |
| **Brand light** | `#F5E6D3` | `#3D2A18` | `--color-brand-light` | The palette value behind `--secondary` and `--warning-bg`, and the cream sheet in an illustration, inside an ink outline. Anywhere else, reach for those roles, not this value |
| **Announcement** | `#1A202C` | same (pinned) | `--announcement-bg` | The fill of every [announcement bar](#web-app) above the header. White on it is 16.32:1 |
| **Announcement link** | `#D4833A` | same (pinned) | `--announcement-link` | The link word on an announcement bar ("Learn more"): 5.52:1 on `--announcement-bg` at 16px/600, 5.06:1 in greyscale. The design kit's `#C8702A` is 4.51:1 in colour but 4.01:1 in greyscale, below the contrast sweep's floor. Only on that fill |
| **Highlight** | `#C8923C` | `#D4A04A` | `--color-highlight` | Highlight words, the wordmark tail on dark and on navy |
| **Focus ring** | `hsl(27 65% 47%)` | `hsl(27 65% 52%)` | `--ring`, `--ring-shadow` (15% / 25% alpha) | Focus indication only. `--ring-shadow` is a legacy halo that `.form-input` does not draw; only fields not yet on the shared classes still use it |
| **Navy** (Secondary) | `#2B3A55` | `#2B3A55` (pinned) | `--color-secondary`; ink twin `--color-secondary-text` (`#2B3A55` / `#8FA3C8`) | Navy *fills*: hero background, the manifest/tile colour, light-theme `theme-color`, the extension icon background and active states, and the light-theme wordmark stem. Navy *ink* on a surface uses `--color-secondary-text`, never `--color-secondary` (1.39:1 on the dark card) |
| **Avatar** (identity) | `#7C5CE6` | `#8F7AF0` | `--color-avatar` | The fill of the signed-in account's initials disc, and nothing else. It marks a person, not a state or action — never a link, button, status or decoration. A deliberate exception to the no-high-saturation rule. White initials are 4.64:1 light but 3.38:1 dark, so it carries only decorative (`aria-hidden`) initials, never text a reader must read. The design kit's lighter `#B47DF6` is not adopted: white on it is 2.91:1 |

The design kit's amber CTA is `#C8702A`, which carries white at 3.62:1. The product keeps one AA-safe ladder on the same hue instead — rest `#AD6225`, hover `#9C5821`, pressed `#8B4F1D` (the kit's pressed `#8F4C18` is visually identical) — pinned in both themes, and `#C8702A` stays the brand swatch for marks. The kit's amber ink on its tint (`#C8702A` on `#F5E6D3`, 2.95:1) is likewise replaced by `--primary-text-on-tint`.

### Neutrals

| Role | Light | Dark | CSS variable (role) | Usage |
|---|---|---|---|---|
| **Background** | `#FFFFFF` | `#121212` | `--color-background` (`--background`) | The header band, a text input's fill, the reader surface, marketing `--background` bands |
| **Surface** | `#F7F8FA` | `#1A1A1A` | `--color-surface` (`--muted`) | The ground of an app page that lays out cards; muted marketing bands; anything nested inside a card (tiles, chips, a quiet control's hover fill) |
| **Surface Elevated** | `#FFFFFF` | `#222222` | `--color-surface-elevated` (`--card`) | Every card and panel; dropdown menus; dialogs |
| **Border** | `#E2E5EA` | `#2E2E2E` | `--color-border` (`--border` / `--input`) | Card edges, dividers, input borders, subtle separators |
| **Text — Primary** | `#1A202C` | `#E4E4E4` | `--color-text-primary` (`--foreground`) | Body text, headings, titles |
| **Text — Secondary** | `#5A6170` | `#9BA1AE` | `--color-text-secondary` (`--muted-foreground`) | Supporting copy: ledes, excerpts, the header's inactive destinations, a rail heading, pagination text at rest (through `--ink-pagination`), disabled text, a field's placeholder (`--input-placeholder`). Metadata and inactive tabs take `--foreground` through their [ink roles](#type-scale-product-ui) |
| **Text — Muted** | `#8C919D` | `#6B6B6B` | `--color-text-muted` | **Marks only, never words.** ~3:1 in both themes, under the 4.5:1 floor. A decorative mark on a white ground (3.16:1). Never a placeholder (a placeholder is words), a timestamp, metadata, disabled text, or a meaning-bearing icon |
| **Neutral hover / pressed** | `#F7F8FA` / `#EDEFF2` | `#2A2A2A` / `#2E2E2E` | `--neutral-hover`, `--neutral-pressed` | The two fill steps of a `neutral` button |
| **Footer Background** | `#1A1A1A` | `#0D0D0D` | `--footer-bg` | The guest footer |

A card differs from the `--muted` ground by only ~1.1:1, so a card always carries `1px solid var(--border)`. The border draws the card, not the fill. In dark mode the header (`--background`), the canvas (`--muted`) and a card (`--card`) each step lighter, so elevation reads from lightness rather than a shadow.

### Functional Colours

| Role | Light | Dark | CSS variable | Usage |
|---|---|---|---|---|
| **Error mark** | `#C45C5C` | `#D46B6B` | `--color-error` | Border of an errored field or an error notice; a red icon that needs only 3:1. Never words, never a fill (white on it is 4.17:1 light, 3.43:1 dark) |
| **Error ink** | `hsl(0 43% 48%)` `#AF4646` | `hsl(0 43% 68%)` | `--error-text` | Error words: a field message (5.54:1 on white, 4.62:1 on the light tint, 5.82:1 on the dark card, 5.46:1 on the dark tint). Flips *lighter* in dark, so it is never a fill |
| **Error tint** | `#F6E7E7` | `#3A2020` | `--error-bg` | Ground of an error notice or error chip |
| **Error fill** | `hsl(0 43% 52%)` (pressed `hsl(0 43% 44%)`) | same (pinned) | `--error-fill`, `--error-fill-hover`, `--error-foreground` | The hover and pressed fills of a standalone destructive outline button. Pinned in both themes like `--primary-fill`; carries `--error-foreground` at 4.85:1 (6.34:1 when pressed) |
| **Success mark / ink** | `#3D8B6E` / `hsl(158 39% 35%)` | `#4A9F7F` | `--color-success`, `--success-text`, `--success-foreground` | `--color-success` fills a shape whose mark needs 3:1 (a progress bar, a completed step's disc); `--success-text` is success words and a check beside words (4.98:1 on white); `--success-foreground` (white) is a mark on a `--success` fill |
| **Success tint** | `#E8F2EE` | `#17302A` | `--success-bg` | Ground of a success notice or chip |
| **Warning** | `#C8923C` / `--warning-bg` `var(--color-brand-light)` `#F5E6D3` | `#D4A04A` / `#3D2A18` | `--color-warning`, `--warning-bg` | `--color-warning` is a wordless mark or fill: `--foreground` on it is 5.93:1 light but 1.85:1 dark, so never words, and never a lone boundary on white (2.75:1). A warning that carries words sits on the `--warning-bg` tint under `--foreground` (13.32:1 light, 10.71:1 dark) |
| **Warning icon ink** | `hsl(37 56% 40%)` `#9F732D` | `#D4A04A` | `--warning-text` | Warning alert icon only: 3.45:1 on the light tint (3.63:1 in greyscale). The border remains `--color-warning`; in dark mode the icon follows that mark |
| **Info mark** | `#4A7FB5` | `#6B9BD1` | `--color-info` | A wordless informational mark: an icon or a notice's border. Marks only — 4.20:1 on white and 3.63:1 on its tint, too close to the floor for words |
| **Info tint** | `#E8EFF7` | `#1B2836` | `--info-bg` | Ground of an informational notice |

Every tint is opaque, so a pair measures the same on a card and on the canvas: red words (`--error-text`) on `--error-bg` are 4.62:1 light and 5.46:1 dark wherever the notice sits. `--color-error` stays a mark; the error ink was darkened from 50% to 48% lightness.

### Colour Rules

- **Never use pure black** (`#000000`) for backgrounds or text. Use the dark neutrals above.
- **Never use Pocket red**, Readwise yellow, or neon/high-saturation accents. The one saturated hue is the identity `--color-avatar`.
- **A fill that carries a label is pinned; ink on the page follows the page.** A filled control carries its own label, so its fill must not move when the page darkens: `--primary`, `--primary-hover`, `--primary-fill`, `--error-fill`, `--error-fill-hover`, `--announcement-bg` and the navy `--color-secondary` hold one value in both themes, and so do the inks on them (`--primary-foreground`, `--error-foreground`, `--secondary-foreground`, `--color-on-brand`, `--announcement-link`). A word or mark painted straight onto a surface needs the opposite — lighter as the page darkens — so every hue has a page-following ink token: `--primary-text`, `--primary-text-on-tint`, `--error-text`, `--success-text`, `--color-secondary-text`. Never paint words or icons with a pinned fill token, and never fill a labelled control with an ink token (it would invert in dark). Tints (`--secondary` and its hover and pressed steps, `--error-bg`, `--warning-bg`, `--success-bg`, `--info-bg`) and surfaces follow the page.
- **Dark mode is not an inversion.** Colours adapt to slightly warmer, lighter variants — it doesn't simply flip to white-on-black. Test every pairing against both backgrounds and against the surface actually behind the ink (a translucent tint composited onto its ground).
- **Amber ink on the amber tint is `--primary-text-on-tint`.** Any amber-tinted ground carrying amber words or an amber icon (a secondary button, a selected navigation row, a badge) fills with `--secondary` and paints its amber with `--primary-text-on-tint` (6.06:1 light, 6.33:1 dark at rest). `--primary-text` on the tint is 4.13:1 — under the floor — so it never sits there. A tint whose content is neutral ink (the offline bar, a warning notice) takes `--foreground`. An accent tag keeps `--foreground` ink; an accent badge's amber label uses `--primary-text-on-tint`, never `--color-brand` (2.95:1) or `--primary-text` (4.13:1).
- **Navy words or icons on a surface use `--color-secondary-text`** (`#2B3A55` / `#8FA3C8`). `--color-secondary` is a pinned navy *fill*; on the dark card it measures 1.39:1.
- **Announcement bars are near-black `--announcement-bg` (`#1A202C`), not navy.** Navy stays the hero and the logo tile; a bar above the header is the announcement fill with white words and an `--announcement-link` link (see [Web App](#web-app)).
- **State colour is one vocabulary.** Unread and to-do are amber (an 8px CSS dot in `--primary-text`). Done is green (a check in `--success-text` beside words, or a white check on a `--success` fill where the state is a shape). Work in flight is amber ink (a spinning loader or pulsing dot) — but a progress *bar* is always the one green pair (see [Progress and Steppers](#progress-and-steppers)), whether its work is running or done. The current step of a sequence is neutral `--foreground`. Red and green keep their error/success meaning everywhere except a [metadata row's](#lists) fixed per-fact tint.
- **The design kit's off-palette colours map onto tokens.** A toggle's on state is `--color-success` (the kit's `#12BA6C`), its off state `--color-text-muted` with a white knob (the kit's `#A3A3A3` is 2.52:1); a radio's off ring is `--foreground` (see [Checkboxes and radios](#checkboxes-and-radios)); a setup connector or pending pie is `--muted-foreground`; the kit's progress hues (`#F2994A`, `#4C51BF`, `#D92D20`, `#FF9500`) become the state vocabulary above. The kit's star yellow `#FFCF33` is not adopted — no surface draws a star.
- **Inline text links use one token — `--primary-text`.** Light `--primary` is a fill, not a link colour; the link token is the darker amber that clears the floor (5.06:1 light, ~6:1 on the dark card). Do not introduce a third amber for a link, and do not redeclare link colour per block. Emphasis inside a link comes from weight (`<strong>`), never a different hue. There is no global bare-`<a>` reset, so an unstyled link renders browser-default blue — that is a styling gap, not a choice; every body-copy link sets `color: var(--primary-text)`. Links that make up **list UI** (a row title, a source name, a sort control, a page number) are not body copy — they rest in their text-role colour and turn amber or `--foreground` only on hover (see [Components](#lists)).
- **Reading surfaces stay neutral.** Amber appears in chrome and UI — never behind article text. Article content sits on `--background` (light) or dark grey (dark).
- **Hero gradient:** `linear-gradient(135deg, #2B3A55 0%, #1E2A40 100%)` — a deep navy gradient mirroring the logo tile. Warm amber highlights (`--color-highlight`) sit directly on it.
- **Contrast floors.** Words clear 4.5:1, or 3:1 at 24px, or 3:1 at 18.66px/700. Non-text marks clear 3:1 (icons, dots, the fill of an icon-only control). A control labelled by words is judged by its label against its fill. Measure in both themes, and again in greyscale — e-ink panels drop hue, and sRGB greyscale and WCAG luminance disagree by up to 0.7:1. A new surface joins the colour-contrast sweep.
- **A signed-in page renders in the reader's theme.** Every signed-in surface follows the account's Appearance setting (System, Light or Dark), resolved server-side so there is no flash. Never pin a signed-in page to one theme (a light-pinned page flips mid-navigation when the reader opens a dark reader). Logged-out pages are designed art and are pinned light (`LIGHT_ONLY_BODY_CLASS`); the public reader view is the one logged-out page that follows the system theme. The extension popup is the one signed-in exception (see [Browser Extension](#browser-extension)).

### Palette Copies Outside the Web

`base.styles.ts` is the source; the surfaces that cannot read its CSS carry copies, and a palette change updates them in the same change so they never drift from the web.

| Surface | Where | Values |
|---|---|---|
| **HTML email** | `EMAIL_COLORS` in hutch | The CTA fill is `#AD6225` under white (4.61:1) — the same AA-safe fill as `--primary`, not the kit's `#C8702A` — and links are `#A85A1E` |
| **Browser extension popup** | none of its own | The popup takes the web tokens and `BUTTON_STYLES` through the extension build (see [Browser Extension](#browser-extension)), so it follows every web palette change with no copy to update. The one literal is the mark's dot, below |
| **iOS and Android** | `BrandColor` in each app | `primaryFill` `#AD6225`, fixed in both themes, fills anything that carries a white label (the iOS readlist choice's Done button; Android's `colorScheme.primary`, with white `onPrimary`). `amber` stays `#C8702A` / `#D4833A` for the app tint and marks. `secondary` is `#F5E6D3` / `#3D2A18` on both platforms, and Android's `onAmberContainer` is `#7E481B` / `#EAA162`, the native `--primary-text-on-tint` |

**The mark's dot is never a variable.** The popup's inline marks and `brandMarkSvg` keep the literal `fill="#C8923C"`; never point it at a palette variable. The design kit's popup and email frames draw the dot `#C8702A` — that is asset drift, not a new dot colour.

---

## Typography

> **Source of truth:** `src/packages/web-shell/src/base.styles.ts` (the `--font-sans` / `--font-serif` tokens and the body font), `src/packages/web-shell/src/base.template.ts` (font loading)

### Typefaces in Use

| Role | Typeface | Weight | Where defined |
|---|---|---|---|
| **Body, UI and product headings** | `--font-sans` → `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (Inter from Google Fonts, 400–700) | 400, 500, 600, 700 (see [Typography Rules](#typography-rules)) | `base.styles.ts` → `LIGHT_THEME_VARIABLES`, applied on `body` in `BASE_RESET_STYLES`; `base.template.ts` preload |
| **Brand serif** | `--font-serif` → `Georgia, "Times New Roman", serif` | 700 (Georgia ships regular and bold only, so 600+ renders its bold) | The header wordmark (`.header__brand`), the reader view's article title, and display headings on editorial and marketing pages (home, landing pages, blog). The extension popup's wordmark takes it too |
| **Reader view** | User-configurable (default: high-legibility serif or sans) | Regular | Article body text in reading mode — this is the user's space |

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
| Panel / card heading · rail heading | `--text-md` | 600 | `--foreground`; a rail heading `--ink-rail-heading` |
| Tab label | `--text-md` | 600 open · 400 others | `--foreground`; inactive tabs `--ink-tab-inactive` |
| Announcement bar | `--text-md`, 24px line | 600 | white on `--announcement-bg` |
| Button label | `--text-md` (S: `--text-sm`, 20px line) | 600 | per [variant](#variants) |
| Nav, menu and rail row | `--text-sm` | 500 | header: `--ink-nav-current` / `--ink-nav-inactive` |
| Metadata · card body | `--text-sm` | 400 | `--ink-meta` |
| Alert title | `--text-sm` | 600 | `--foreground` |
| Alert body | `--text-sm` | 400 | `--foreground` |
| Field label | `--text-sm` | 500 | `--foreground` |
| Field error | `--text-xs` | 500 | `--error-text` |
| Pagination | `--text-md` | 500 info and numbers · 400 Previous/Next · 600 current | `--ink-pagination`; the current page `--foreground` |
| Chip · badge | `--text-xs` | 500 | per [tone](#chips-tags-and-badges) |
| Tab badge | `--text-sm` | 600 | `--primary-foreground` on `--primary` |
| Large tag | `--text-sm` | 500 | per [tone](#chips-tags-and-badges) |
| Status chip | `--text-xs` | 600 | `--foreground` |
| Figure (stat tile) | `--text-md` | 600, tabular | `--foreground` |
| Stat tile label | `--text-sm` (18px line) | 400 | `--muted-foreground` |
| Plan price | `1.5rem` (24px, no token: the one product figure above `--text-lg`) | 600, tabular | `--foreground`; its "/month" unit `--text-sm`/400 `--foreground` |

**13px, 15px and 17px are off the scale.** The designed components (list rows, empty states, tabs, dialogs, menus, alerts, the rail) move onto these roles one component at a time; where a section below still quotes 13, 15 or 17px, or an ink or weight the tables here replace, that is the component's value today, and the next change to that component moves it to its role here. Stylesheets for pages with no design already name the tokens, with no 13/15/17px literal.

**Ink roles.** A role that has its own ink names a role token, so a later design change moves one value:

| Token | Resolves to | Used by |
|---|---|---|
| `--ink-nav-current` | `--foreground` (16.32:1) | the header's current destination |
| `--ink-nav-inactive` | `--muted-foreground` (6.22:1) | every other header destination |
| `--ink-meta` | `--foreground` | metadata rows |
| `--ink-tab-inactive` | `--foreground` | an inactive line tab |
| `--ink-rail-heading` | `--muted-foreground` | a rail heading |
| `--ink-pagination` | `--muted-foreground` | pagination text at rest |

Buttons and inputs take their sizes from their own tokens (see [Buttons](#buttons) and [Form Inputs](#form-inputs)). Nothing a reader must read goes below 12px; 11px is left to all-caps micro-labels, avatar initials and the footer copyright. Display sizes of 1.25rem and up on editorial and marketing pages (home, landing pages, the blog, the embed page) keep their own scale, as do the reader's article and the blog's editorial body.

### Typography Rules

- **Product headings are sans; the serif is the display voice.** Every heading in the product's working area — panel and card titles, rail headings, list headers, empty states, alerts, dialog titles — uses `var(--font-sans)` at weight 600 in `--foreground`. This covers **every page a reader operates**, signed-in pages and logged-out tools (import, login) alike. `var(--font-serif)` is the display voice: the wordmark, the reader view's article title, and display headings on editorial and marketing pages (home, landing pages, blog). A saved article's title or an email subject shown in a list is sans, like the rest of the list. Declare the font on the heading's own selector so the choice is explicit, not inherited — a heading that inherits the body sans is a drift, not a choice, and the serif stack must never be inlined (one source of truth, like colours).
- **Weight carries hierarchy.** Inter is loaded at 400–700, and each weight has one job. **400** is prose, excerpts, metadata, neutral labels, and an inactive line tab. **500** is navigation a reader moves through (header, rail and menu rows), field labels, tags and badges. **600** is headings, titles, counts, button labels, announcement bars, status chips, the tab badge, stand-alone figures (the 16/600 stat tile, the 24/600 plan price), and the open tab or current page number. **700** is the wordmark and avatar initials. Never set **800** — Inter is not loaded at that weight. Where a weight step does the job, do not reach for a bigger size.
- **Sizes are fixed per role at every width.** A phone gets the same sizes as a desktop and the layout reflows; there is no phone step-down (the design explorations' 18→14, 16→14 and 14→12 steps are not built).
- **A heading brings its own lede.** A panel title (16px/600, `--foreground`) is followed 2–8px below by a lede one or two steps smaller (13–14px/400, `--muted-foreground`). Empty states use 18px over 14px. An alert's title and message are 14px/600 over 14px/400, both `--foreground`; a dialog body uses 14px/400 `--muted-foreground`.
- **A page with persistent navigation names its place through that navigation, not a display title.** Where a rail or tab selection already shows where the reader is, the page renders no visible `h1`: the document `<title>` names the place (`All — Readplace`), and each panel's own `h2` starts the outline.
- **Legibility is non-negotiable.** This is a product about reading. If a type choice looks good but reads poorly, reject it.
- **Line-height.** Body text inherits `1.6` (`BASE_RESET_STYLES`), and a single-line metadata row keeps it. An item or dialog title uses a 28px line at 18px; no heading goes below `1.3`, except the readlist subscription notice title (16px/600), which sits on a 20px line (`1.25`), the design's panel-title box. Supporting copy running several lines may tighten to `1.5`–`1.55`; dialog body copy uses 14px on a 22px line. Empty-state text also sets 14px on a 22px line. Generous spacing is a feature, not a waste of space.
- **Never use all-caps** for more than short micro-labels. Never for headings or body text (see also [Capitalisation](#capitalisation)).
- **International support:** Typefaces must include full Latin Extended character sets (Portuguese, accented characters). The founder is Brazilian-Australian — this is table stakes.
- **Avoid trendy typefaces.** If it will look dated in 2 years, don't ship it.
- **Orphan control.** Prose body copy uses `text-wrap: pretty`; multi-word headings use `text-wrap: balance`. Scope both to the prose/heading selectors — never on `body`. A single word must never be stranded on a text block's last line. A left-aligned list-item title that shares its row with a menu or thumbnail uses `pretty`, not `balance` — `balance` would shorten its first line and leave a gap beside the menu. **Exceptions:** an intentional keyword focal point is a designed single-word line; a centred title that should read as a top-wide pyramid uses `pretty`; single-word *headings* (`Cookies`, `Contact`) are acceptable when intentional (`balance` is a no-op on them).
- **One-word page titles get deliberate visual mass** — larger size, heavier weight, and/or negative letter-spacing so the whitespace beside them reads as intentional.
- **Long strings wrap; a metadata name truncates.** Text supplied by a reader or publisher (article titles, excerpts, readlist names, site names, URLs) must never push the page sideways at 320px. Titles, excerpts and names wrap mid-word (`overflow-wrap: anywhere`); a raw URL breaks with `word-break: break-all`. In a metadata row the one variable-length part (a publisher name) stays on one line and gives way with `text-overflow: ellipsis`, carrying the full text in `title` and a minimum flex basis (`12ch`) so it never collapses to a sliver. Fixed parts (dates, read time) are `white-space: nowrap` and wrap to a second line before the name is crushed.
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

---

## Iconography & UI Elements

### Icon Style

Every UI icon comes from [`@packages/ui-icons`](./src/packages/ui-icons/src/ui-icons.ts), which defines the one line spec: **Hugeicons stroke-rounded** on a 24×24 grid, 1.5px stroke, round caps and joins, no fill, `currentColor`, hidden from assistive tech. The stroke paths are vendored from `@hugeicons/core-free-icons` 4.3.5 under its MIT licence, whose notice travels in that module's header; the package stays dependency-free so the popup and the blog can bundle it. Size an icon by setting width/height on the svg and colour it with `color`. Add a drawing there rather than at a call site, and add only icons a surface actually draws.

- **No icon font, no icon CDN, no entity or Unicode glyph (`× ↓ ← → ✓ ✗ ● ▾`), no emoji, no CSS `content:` glyph.** A font glyph's stroke follows the system font and an SVG's does not, so mixing them puts two weights on one row — the tell that icons were picked at different times.
- **Never override `stroke-width`, and never fill a stroke glyph with CSS.** Four kinds of drawing are filled on purpose, and only these: the solid current-state variant, the fact glyphs, brand and logo marks, and spot [illustrations](#illustrations).
- **A solid variant marks the current state, and nothing else.** The header's current destination draws its solid glyph (see [Web App](#web-app)); every other use of a name draws its stroke. Six names have one — `book`, `file-down`, `file`, `folder`, `inbox` and `sparkles`, the design kit's stroke/solid pairs. Hugeicons Pro is not licensed, so these six are Readplace-drawn fills of the free stroke glyphs: the outer silhouette with the interior detail cut out, or, for `folder` and `sparkles`, the stroke glyph filled. A name with no solid drawing keeps its stroke glyph when current, and its ink step alone marks it. A template asks for the solid with `{{icon "<name>" variant="solid"}}`; a name with no solid drawing, or an unknown variant, fails the render.
- **Fact glyphs are filled.** `globe` (a disc with cut-out meridians), `clock` (a ring, a face at 15% opacity, and hands) and `eye` (an almond with a cut-out pupil ring) are filled 24-grid glyphs in `currentColor`. Their cut-outs let the surface show through, so they read in both themes and in the popup. A name has one drawing, so `clock` is the filled glyph wherever it appears.
- **Logos keep their own colour.** The Chrome client logo is the full-colour mark (flat red `#DB4437`, yellow `#FFCD40`, green `#0F9D58`, a white ring and a blue `#4285F4` centre), as the reader's "via Chrome" line shows it. The other client logos have no colour design and stay monochrome `currentColor`, so the install page's tab strip mixes one colour logo with monochrome ones.
- **Typographic punctuation stays text** — em dash, ellipsis, curly quotes, bullet dividers are copy. The pager's gap is the one exception: it draws the `ellipsis` glyph and keeps `…` as `.sr-only` text, while an ellipsis in running copy stays text. A plain shape (an unread dot, a step marker) is CSS, not an icon.
- **Size an icon by where it sits.**

  | Where | Glyph | Icon-to-label gap |
  |---|---|---|
  | Header destination, rail row, alert lead, search or filter box | 24px | 8px in the header |
  | Kebab trigger | 24px (`1.5rem`) | — |
  | Menu item | 20px (`1.25rem`) | 12px |
  | Inside an L or M [button](#buttons), an announcement-bar link or close | 20px | 8px |
  | Inside an S button | 16px | 6px |
  | Metadata row, chevron | 16–18px | — |
  | Pagination step, pagination gap | 16px (`1em` of `--text-md`) | 4px |

  The shell and the pages with no design use these sizes; a designed component (rail, menus, alerts, metadata rows) takes its size in its own pass, and until then its section below may quote its earlier size. The 6px S-button gap is a half-step inside a component (see [Spacing Scale](#spacing-scale)).
- **A readlist's kind has one glyph.** One table in hutch (`READLIST_KIND_ICON`) maps a readlist's kind to its icon: the default readlist ("All") draws `file`, a custom readlist `folder`. A surface that shows a readlist's kind reads that table rather than choosing its own glyph (the reader's readlist picker still draws `folder` for every option until it adopts the table); the header's Readlist destination keeps `book`.
- **An icon's ink comes from its role.** Navigation icons are monochrome and follow their label: in the header, `--ink-nav-current` on the current destination and `--ink-nav-inactive` on the others (account items stay `--foreground`); in a side rail, the icon follows its label: `--foreground` at rest and `--primary-text-on-tint` on the selected row, 8px from the label. Menu-item icons and kebab triggers are `--foreground`; other icon-only triggers are `--muted-foreground`. A state glyph beside words takes the functional text token (`--success-text`, `--error-text`); an alert glyph takes its variant's mark (`--color-error`, `--color-success`, `--color-info`), except the warning glyph takes `--warning-text` to clear 3:1 on its tint. A progress spinner (`loader`) is `--primary-text`. A **metadata glyph** is a fact glyph tinted through its fact token so rows scan by colour — source/site `globe` in `--fact-site`, saved time `clock` in `--fact-saved`, reading time `eye` in `--fact-read-time` — while the text beside it is `--ink-meta`. The fact tokens resolve to `--color-secondary-text`, `--color-error` and `--color-success`; the design's navy `#004593`, red `#D4284B` and teal gradient are not adopted (`#004593` is 1.72:1 on the dark card). Every fact keeps its text label, so hue is never the only cue. This is the one decorative use of the functional hues; everywhere else red and green mean error and success. Every tinted glyph clears 3:1 against its surface in both themes — reach for a page-following token before a theme-pinned brand value (pinned `--color-secondary` is 1.39:1 on the dark card).
- **Arrows show direction; chevrons show disclosure and paging.** A pagination step (Previous/Next, Newer/Older) uses `chevron-left`/`chevron-right`; arrows are kept for back links and sort, where `arrow-down`/`arrow-up` beside a sort label show the order applied. A disclosure (`<details>` summary, dropdown, account trigger) uses `chevron-down` and rotates it 180° when open — `--muted-foreground` in content, `--foreground` in a 24px slot on the header's account trigger, the readlist switcher, and a setup-guide step or fold; there is no separate up-chevron. A select field's chevron is `--foreground` in a 20px slot and does not turn.
- **An icon carrying meaning alone needs an `.sr-only` twin** naming what it acts on — `htmlToMarkdown` drops `<svg>`, so a lone icon reaches AI clients and screen readers as an empty cell. Prefer `.sr-only` text over an `aria-label` alone (which markdown also drops). A per-row menu is "More options for <item>", a status marker is "Unread"/"Read", a close is "Close" — never a bare "Menu" repeated down a list.

### Illustrations

Spot illustrations lead an empty state, a reader notice, an advisory and an illustrated confirmation. They come from the shared illustrations module, never from the icon set. There are two drawings: the **book with a lightbulb** leads anything that is not a deletion, and the **bin holding a sheet** leads a deletion.

An illustration is filled art: a solid ink silhouette that shows as the outline, with flat shapes on top in at most four paints — ink (`currentColor`, which the container sets to `--foreground`), paper (`--card`), amber (`--color-brand`) and cream (`--color-brand-light`, only inside an ink outline). There are no strokes, washes, opacity, gradients or hex literals, so the art follows the reader's theme and any light pin.

Each drawing carries the size it was drawn at, 64px tall (the book 80×64, the bin 46×64). A container places the art and never scales it.

Illustrations are decorative (`aria-hidden`, `focusable="false"`), never emoji, raster or clip art, and carry no ids, because one page may inline the bin once per card. The accent stays amber even on a delete dialog; its confirmed action uses the dialog's amber `primary` button. A dialog that only edits (rename, create) has no illustration. Add a new drawing to that module, not at the call site, and only once a design uses it.

### List Markers

List markers carry polarity. An included / positive item takes the `check` icon in `--success-text`; an excluded / negative item — a "what this will **not** do" list — takes the `x` icon in `--muted-foreground` (or `--color-error` for a louder refusal). Never mark an exclusion list with a neutral dash or bullet — a dash reads as a feature, not a refusal.

**Item state uses one vocabulary.**

- **Waiting or current** is a small filled CSS dot (8px): `--primary-text` for an unread item, and `--foreground` inside a 1.25px `--foreground` ring for the current step of a sequence. A current step with measured progress uses the quarter pie in [Progress and Steppers](#progress-and-steppers).
- **Done** is the `check` icon in the success colour: `--success-text` beside text, or a white `--success-foreground` check on a `--success` disc inside a `--success` ring for a completed step.
- **Not yet reached** is a 1.25px dashed `--muted-foreground` ring; steps are joined by a 1px dashed `--muted-foreground` connector.
- An inline state marker beside wrapping text sits in a box one line tall, so it stays on the first line and is never centred against a wrapped block.
- A marker that carries meaning alone has an `.sr-only` twin.

### Buttons

> **Source of truth:** `BUTTON_STYLES` in `src/packages/web-shell/src/base.styles.ts`, injected into every page's `<head>` and compiled into the extension popup's stylesheet by its build.

There is **one** button in the product. Every call to action is `.btn` plus exactly one variant, plus — only where its surroundings demand it — one [size](#size-and-padding) modifier. A page stylesheet may add layout (`width`, `margin`, grid/flex placement, `white-space`) and nothing else. A page never defines its own button class or repaints a `.btn` variant's padding, radius, fill or hover — that is how those values drift apart from page to page. **Every variant this section names belongs in `BUTTON_STYLES`.** `.btn` sets no fill or colour of its own, so a variant the module doesn't define renders as an unstyled button: add it there before its first use.

#### Variants

| Variant | Rest | Hover | Pressed | Label | Edge | Usage |
|---|---|---|---|---|---|---|
| **`primary`** | `--primary` | `--primary-hover` | `--primary-fill` | `--primary-foreground` (white) | — | The amber CTA — the main action per screen (Save, Import, Subscribe, install, landing and pricing CTAs, the guest header's Log in) |
| **`secondary`** (the kit's "Secondary") | `--secondary` | `--secondary-hover` | `--secondary-pressed` | `--primary-text-on-tint` | inset 1px `--color-brand` | The supporting action beside a primary (View on GitHub, Cancel, Back), and a list row's state action (Mark as read, Exclude) |
| **`neutral`** (the kit's "Tertiary") | `--card` | `--neutral-hover` | `--neutral-pressed` | `--foreground` | inset 1px `--border` | A low-emphasis action standing alone, such as an empty state's next step or a toast's Undo, or the dismiss beside a dialog's `primary` |
| **`destructive`** | `--card` | `--error-fill` | `--error-fill-hover` | `--error-text` at rest; `--error-foreground` (white) when filled | inset 1px `--color-error` | Standalone destructive actions on account, integrations and crawl versions. The red hover and pressed fills are pinned across themes |
| **`on-dark`** | white | white, deepened | same as hover | `--secondary-foreground` | — | *Context modifier, not a priority level* — a primary sitting on the navy hero |
| **`on-dark-ghost`** | translucent white | more opaque white | same as hover | white | translucent white inset | *Context modifier* — the secondary beside an `on-dark` primary |

`primary` **always** means the amber CTA. The fills are pinned in both themes except `secondary` and `neutral`, which follow the page: in dark the secondary steps `#3D2A18` → `#4A3320` → `#5A3E26` (the kit's dark hover equals its rest fill, which reads as a sheet bug, so hover takes its own step), and the neutral steps from `--card` `#222222` through `#2A2A2A` to `#2E2E2E`. `on-dark`/`on-dark-ghost` carry theme-stable values because the navy hero is navy in both themes. There is no toggle variant that inverts to a solid fill on hover — a row's state action is a `secondary`. A **tertiary** action is not a button — it is a plain inline link (`--primary-text`, underlined). A confirmed delete commits with amber `primary` inside its dialog; red marks destructive actions taken outside a dialog. The *control that opens* a confirmed delete is a neutral [menu](#menus) item, with no red at rest or on hover.

**Row actions.** An action repeated on every row of a list (Mark as read on each card, Exclude on each sender) is a `secondary` at size M, never `primary`, so the screen keeps one amber CTA. While its request is in flight the label hides with `visibility: hidden` (the width holds) and the shared in-flight dots take its place; while the item is still processing it is disabled at `opacity: 0.5`.

#### Pairing

Outside dialogs, when two buttons sit side by side, the **first is the primary action and the second is the secondary action** — always in that order, never two of the same weight, and never a button beside a bare text link. A repeated action keeps **one** variant everywhere it appears on a page. Buttons that share a row share one [size](#size-and-padding): a row never mixes L, M and S.

**Escape hatch.** The one text control allowed beside a button: a control that marks a step done or skips it ("I've done this already") sits under that step's `primary` as a quiet text action — underlined, `--muted-foreground` → `--foreground` on hover, 14px/500. An *alternative path* is still a `secondary` button; a link in prose is still `--primary-text`.

**In a dialog**, L buttons have 24px inline padding and sit in one auto-width row, 8px apart: dismiss (`neutral`) first, commit (`primary`) last. The row is right-aligned, or centred when the dialog is illustrated and holds no field. If a pair is too wide for the row, the commit wraps above the dismiss. Below the designed 534px content width, buttons stack full-width with the commit on top.

#### Size and padding

> Defined in `BUTTON_STYLES`. Pick a size class — a page never sets a button's height, padding or radius.

Sizes come by role, not by importance:

| Size | Class | Height | Padding | Radius | Label | Icon, gap | Hit area | Usage |
|---|---|---|---|---|---|---|---|---|
| **L** | `.btn` (default) | 48px | `12px 16px` | `--radius` (8) | 16px/600, 24px line | 20px, 8px | 48px | A CTA on its own line: hero, landing, install, pricing, import commit, a card's closing CTA (spanning the card), except the readlist subscription notice, **every dialog button**, and a CTA beside a text input — L equals `--input-height`, so the row lines up with no modifier |
| **M** | `.btn--m` | 40px | `8px 14px` | `--radius` (8) | 16px/600 | 20px, 8px | ≥44px (`::before`, `inset: -2px 0`) | A list row's state action (Mark as read, Exclude, Save on an inbox link), a toast's Undo, the guest header's Log in, the readlist subscription notice's full-width CTA |
| **S** | `.btn--s` | 32px | `6px 12px` | `--radius-sm` (6) | 14px/600, 20px line | 16px, 6px | ≥44px (`::before`, `inset: -6px 0`) | An action nested in dense secondary content: a checklist or stepper step, a copy button, a banner CTA, the reader's action bar. Never a card's closing CTA |
| **Icon** | — (not `.btn`) | — | `4px 8px` (`--button-padding-xs`) | `--radius-sm` | — | 16px | per the floor below | Icon-only close and dismiss controls |
| **Kebab** | `.menu__toggle` | ≥36px | — | `--radius-sm` (6) | — | 24px, no fill | ≥36px square | Overflow trigger inside a list |

The kit's XL (56px) is not built: no screen draws it, and unused CSS fails the purge check. `.btn--field`, `.btn--compact` and `.btn--toggle` are retired.

**Tap-target floor is tiered.** Every `.btn` has a ≥44px hit area: L is 48px tall, and M and S stretch a transparent `::before` above and below the box, so the button stays visually small while its target does not. A tab's 40px box reaches 44px through its `::before` hit area, as the M button does; a navigation row and menu item are ≥44px tall. A compact control *inside a list* (an overflow toggle, a page number, Previous/Next) or a removable tag's × is ≥36px square — the one relaxation of the 44px floor, and it still clears WCAG 2.5.8's 24px. A dialog or banner close is the `x` icon in a ≥44px hit box. Nothing interactive is smaller on any viewport.

#### Hover and active

**Hover and pressed are two steps, and they swap the fill — they never fade it.** One mechanism (`background-color`), one direction: the fill moves *away* from the surface behind it, so the button gains presence, and pressing moves it one step further than hover.

- A filled amber button rests on `--primary` (`#AD6225`, 4.61:1 under white), hovers to `--primary-hover` (`#9C5821`, 5.48:1) and presses to `--primary-fill` (`#8B4F1D`, 6.49:1). All three are pinned in both themes, so the direction cannot invert.
- A tinted variant deepens its own fill by the same mechanism: `secondary` steps through `--secondary-hover` and `--secondary-pressed` with its label held at `--primary-text-on-tint`; `neutral` steps through `--neutral-hover` and `--neutral-pressed`. The standalone `destructive` outline fills `--error-fill` on hover and `--error-fill-hover` when pressed, changing its label from `--error-text` to white.
- **Never `opacity` on a button that has a fill** — it fades the label too, reading as disabled. `opacity: 0.5` is the disabled state.
- **Never `filter: brightness()`** — it lightens, the wrong direction.
- **Never `--color-brand-dark` as a hover fill** — it inverts lightness between themes.
- A bordered control keeps its border through hover and active — only the fill moves.

#### Quiet controls

Controls that navigate or tidy without committing (sort, pagination, sidebar rows, "create" rows, kebab triggers, close buttons) are neutral: never amber at rest, never underlined.

- A destination (a sidebar row, a menu item) rests in `--foreground`. A page link is the exception: it rests in `--ink-pagination` (`--muted-foreground`; see [Pagination](#pagination)). A utility (sort, create, close) rests in `--muted-foreground` and turns `--foreground` on hover.
- A kebab trigger rests in `--foreground` and takes no fill or ink change on hover or open.
- A control with a box shows hover by stepping to the neighbouring surface: `--card` when it sits on the `--muted` ground, `--muted` when it sits on a `--card` or `--background` surface. A text-only control changes ink only.
- **Sort** is one link naming the current order with a direction-arrow icon ("Newest first") that toggles it — not a `<select>`.
- A card's title link carries no underline and turns `--primary-text` on hover.
- The selected row of a navigation rail is filled `--secondary` with `--primary-text-on-tint` ink, keeps that fill on hover, and **has no border** — the one exception to the 1px amber border other selected surfaces take, because the design's selected row steps straight from the ground to the tint.

Amber at rest is kept for calls to action, links in prose, and the active sidebar row.

- **Every focusable control paints the amber `--ring` when focused.** A **text field** shows focus on `:focus` by turning its border `--ring` and adding `0 0 0 1px var(--ring)` — a solid 2px edge with no translucent halo — with `outline: none`. On a marketing page, a field that shares a row with its CTA (`.form-input--cta-ring`) paints that button's `:focus-visible` outline instead, so the pair shows one ring. **Everything else** (buttons, links, selects, checkboxes and radios, `summary` toggles, a focusable dialog panel) draws `outline: 2px solid var(--ring)` at 2px offset on `:focus-visible`. A select inside a `.form-input--within` box is the exception: like a text field, it shows focus on the box. The base rule covers `button` and `a`, so any other element declares its own.

#### Disabled and in-flight

- **Disabled** buttons take `opacity: 0.5` and `cursor: not-allowed` (the kit's disabled fill is exactly its rest fill at 50%); a disabled field is never faded — it takes the `--muted` fill (see [Form Inputs](#form-inputs)). A field and the button it pairs with are disabled together.
- **A disabled link is not a faded link.** Render it as a non-link element with `aria-disabled="true"` in `--muted-foreground`. Disabled text is never `--color-text-muted` (under 3.3:1 in both themes).
- **In flight is not disabled.** A control locked only for its round trip keeps full opacity and takes a `progress` cursor. It shows it is working in place of its label — the shared three-dot loader (label hidden by `visibility: hidden` so width holds), or a progress label ("Saving…"). A region waiting to be replaced may dim to ~55% with a `progress` cursor; it never goes blank.

### Border Radius

> Defined in `base.styles.ts` as CSS custom properties.

| Token | Value | CSS variable | Usage |
|---|---|---|---|
| Small | `6px` | `--radius-sm` | S buttons, icon-only buttons, images inside a card, skeleton bars, thumbnails |
| Default | `8px` | `--radius` | L and M buttons, inputs, rail rows and the other readlist-row consumers (the design's selected-row corner fits 8–8.5px, not 12), alerts and callouts (standalone or nested), toasts, pagination targets and the current-page cell, a header destination's hover; and boxes nested inside a card or dialog (tiles, bordered lists) |
| Medium | `12px` | `--radius-md` | Dropdown and row menus, and plan-choice rows |
| Large | `16px` | `--radius-lg` | Cards and panels everywhere, and dialogs |
| Pill | `999px` | `--radius-pill` | Chips and progress bars |

**Corners step down one size per level of nesting** (card or dialog 16 → nested box, text field or control 8 → S control 6), so an inner corner is never rounder than its container. Plan-choice rows are the one exception: they keep the designed 12px (`--radius-md`) inside the 16px dialog. A tile set into a card (a stat or countdown box) is enclosed by 1px `var(--border)` and fills with `--muted`, reading as recessed. An image in a card takes `--radius-sm` and `object-fit: cover`, no border. Pick the token by what the element *is*, not by how prominent it should look.

Every card follows `--radius-lg` to 16px. Menus move onto the values above in their own pass, and until then their sections below quote the token they read today.

**Pills are for chips and progress bars only.** A chip (status chips, tags and badges, all non-interactive labels) and a progress bar are pills (`--radius-pill`). A [tab badge](#chips-tags-and-badges) is attached to a box, so it is the one non-pill badge. A tag that can be removed stays a non-interactive pill; its remove × is a separate icon-only button inside it (`--radius-sm` hover square, ≥36px square target, sr-only "Remove from {name}"), and the pill itself is never the click target. Anything else you *operate* or that *frames content* — buttons, inputs, tabs, menus and cards — stays on the radius tokens. This isn't a social app. Circles (`border-radius: 50%`) are shapes, not pills, and are reserved for avatars, status/unread dots, step markers and radio rings. A checkbox's 5px corner is glyph geometry, not a radius token.

A card laid out in a grid is a fully-enclosed box — `1px solid var(--border)` plus a `--radius*` corner. A vertical divided list lives *inside* one enclosed card (see [Lists](#lists)); its hairlines never run bare on the page ground. Reserve a bottom-border-only separator for a divided list, never a grid tile, which reads as half-drawn beside its neighbours.

### Shadows & Elevation

> Defined in `base.styles.ts`.

An app screen has a canvas and at most two raised layers — never more.

| Layer | Fill | Edge | Shadow | Examples |
|---|---|---|---|---|
| **Canvas** | `--muted` on signed-in app pages; `--background` on reading pages; marketing pages keep the band rhythm | — | none | page ground, uncarded navigation rails and tab strips |
| **Resting** | `--card` (`#FFFFFF` / `#222222`) | 1px `var(--border)` | **none** | cards, panels |
| **Floating** | `--card` (a full-height drawer takes `--background`) | 1px `var(--border)` | dropdown and row menus: `--shadow-menu`; other layers: their shadow token; none for a dialog | dropdown and row menus, popovers, toasts, dialogs, the mobile nav drawer |

| Token | Light | Dark | CSS variable | Role |
|---|---|---|---|---|
| Small | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.3)` | `--shadow-sm` | none |
| Medium | `0 4px 6px rgba(0,0,0,0.07)` | `0 4px 6px rgba(0,0,0,0.4)` | `--shadow-md` | the phone nav drawer |
| Menu | `0 0 8px rgb(0 0 0 / 0.15)` | `0 0 8px rgb(0 0 0 / 0.5)` | `--shadow-menu` | dropdown and row menus |
| Toast | `0 4px 16px rgba(0,0,0,0.12)` | `0 4px 16px rgba(0,0,0,0.5)` | `--shadow-toast` | the toast |

The menu value matches the measured design halo; the toast value is estimated from its halo (±30%). Floating menus use `--shadow-menu`, and a dialog floats on its scrim alone.

- **A shadow means it floats.** A resting card is border-only — the fill step from the canvas is barely visible in either theme, so the hairline does the separating. A floating menu takes `--shadow-menu`; other dismissible layers take their own shadow tokens. That keeps every screen at two planes.
- A **toast** is the one tinted floating layer: the opaque success tint, a 1px `--success` edge and `--shadow-toast`.
- A **modal dialog** is a bordered `--card` over a scrim and blur, with no shadow of its own. The shared values are exported constants from `base.styles.ts`, not tokens, because `var()` does not reach `::backdrop`: `SCRIM_LIGHT` `rgb(0 0 0 / 0.5)` (the design's scrim samples black at 50%), `SCRIM_DARK` `rgb(13 13 13 / 0.72)` (no dark design), and `SCRIM_BLUR` `2px` (estimated) for a backdrop blur that degrades to the plain scrim on e-ink. A dialog interpolates them rather than writing its own literals.
- A focus halo or an inset outline built with `box-shadow` is not elevation.

---

## Components

### Lists

A vertical list of content items (articles, emails, records) is **one enclosed card**: `--card`, 1px `--border`, `--radius-lg` (`--radius` when nested inside a card or dialog), `overflow: hidden`. Rows run flush to the card's edges, split by 1px `--border` dividers — no gap between rows, no box around each row, no divider after the last. A divided list never sits loose on the page ground; a grid of tiles is the opposite pattern (each tile individually boxed). A navigation list (a rail) is not a content list and stays unboxed on the ground.

- **List header.** The card opens with a header row: the item count on the leading edge (14px/600 `--foreground`, tabular figures, "4 Saved Articles", flush with the card's 24px inset) and the sort control on the trailing edge (a [quiet](#quiet-controls) text link naming the current order with a 20px direction arrow). Totals cap at "9999+". The sort control never moves when the count arrives: it holds the trailing edge whatever the count's width, and where the header cannot fit both, the count is hidden rather than meeting it. The header is hidden when the list is empty (see [Empty States](#empty-states)); it returns with the first article. Never claim a total you don't have — leave the slot empty until the count is known, and show zero once it is.
- **Row anatomy.** A row reads top-down: title, excerpt, tag row (when present), then metadata with the row's action. 24px padding; 6px from the title's line box to the excerpt, 12px to the tag row, 16px to the metadata. The title is UI, so it is sans (18px/600, line-height 1.35, `--foreground`, `text-wrap: pretty`); it is the row's link into the item and turns `--primary-text` on hover, never underlined. The excerpt is 14px/1.55, `--muted-foreground`. A row may make its title and excerpt both open the same item, but **only the title is a tab stop** and in the accessibility tree — the duplicates take `tabindex="-1"` (and `aria-hidden` when they carry no text).
- **Clamp only borrowed text.** Prose taken from a page (a meta description, a first paragraph) clamps at two lines (`-webkit-line-clamp: 2`). Text the product wrote itself (a generated teaser) and titles render whole. Never clip a sentence the product authored.
- **Metadata row.** A row of facts 16px apart at 14px in `--ink-meta`; each fact is a 16px `ui-icons` glyph 4px before its text, the glyph tinted by its `--fact-*` token (see [Icon Style](#icon-style)). A fact that links out (the site) turns `--primary-text` on hover. The one unbounded fact (a publisher/sender name) stays on one line and gives way with an ellipsis (full text in `title`, `12ch` flex-basis floor). Bounded facts (dates, durations) never shrink or wrap inside themselves; when the row can't fit, whole facts wrap. A fact with no value is removed, not rendered empty.
- **Status marker.** A readlist row carries no status marker: the open tab names the state and the toggle names the inverse action; a read row keeps the unread row's anatomy and ink. Never use opacity, strike-through or a greyed card for done items.
- **Row actions.** A settled row shows at most one action button — its state action, a `secondary` M [button](#buttons) — at the trailing end of the metadata row where the row fits the facts' natural width beside it, and on its own row at the leading edge where it doesn't; every row of a list switches at the same width. Every other action goes in an [overflow menu](#menus) opened from an `ellipsis` toggle at the trailing end of the title line. Never put a delete button on a row.
- **Scroll.** The list card grows with its rows and the page scrolls; pagination sits 16px below the card.
- **Inbox cards.** The inbox article cards keep the previous row anatomy (action on its own line, 20px padding); they share only the tokens.

### Empty States

An empty list keeps its card, but the card's header (count and sort) is hidden, so the empty state is the card's only content — centred, 48px above and below and 24px at the sides. It holds a spot [illustration](#illustrations) (80×64, its drawn size) 24px above a sans title (18px/600, `--foreground`, `text-wrap: balance`), one or two sentences of body 8px under the title (14px on a 22px line, `--muted-foreground`) capped at ~56ch (the one place prose may take a narrower measure than its column), then at most one action 16px below. Pagination is hidden — never "Showing 0 of 0". Distinguish the reasons a list is empty (never used, all caught up, nothing in this tab, nothing in this scope), each with its own title and a body naming what to do next.

### Tabs

> **Component:** the shared tab strip in `@packages/web-shell` (`UNDERLINE_TABS_STYLES`). The values below belong in that module, never in a page stylesheet.

Tabs that switch between views of the same content are **underline tabs** — never pills, boxed segments or filled chips. The strip is a row of links on a 1px `--border` baseline spanning the content column, above the card it controls, never inside it.

- **Box.** A tab is 40px tall: a 16px label on a 22px line at the top, 16px below it, then a 2px underline slot sitting on the baseline. A transparent `::before` stretches its hit area to 44px, as the M button's does. Side padding is 24px.
- **States.** An inactive tab is 400 in `--ink-tab-inactive`; hover previews the underline in `--muted-foreground`. The open tab carries `aria-current="page"`, and that attribute styles it: 600 `--foreground` with a 2px `--foreground` underline. **The underline is neutral ink, never amber** — amber marks the selected row of a navigation rail, not a selected filter.
- **Dense.** `underline-tabs--dense` narrows the side padding to 12px. Only `/install` uses it, so its two labelled groups of icon tabs share one row at desktop.
- **Phone.** At `max-width: 600px` the tabs split the strip's width equally with 12px side padding. The strip wraps onto another row rather than truncating a label or scrolling sideways.

A tab may carry a count as `Label (N)` (`formatTabCountLabel`), capped at `99+`, `(0)` when there are none, the bare label while the count is unknown. Show a count only where it helps the reader choose the tab, and reserve the width of its widest form so a late count doesn't move the row.

### Pagination

> **Component:** the shared pager in `@packages/web-shell` (`PAGINATION_STYLES`). The values below belong in that module, never in a page stylesheet.

Pagination sits **below** the list card, outside it. The leading edge states the range ("Showing 20 of 21"); the trailing edge holds Previous, the page numbers and Next. Show the first page, the last, and one either side of the current. Pagination is hidden on an empty list, and is never amber and never `.btn` buttons.

- **Text.** All pager text is 16px (`--text-md`) in `--ink-pagination` (`--muted-foreground`) at rest: the range at 500, Previous/Next at 400, the numbers at 500.
- **Ends.** Previous/Next are [quiet](#quiet-controls) text links carrying `chevron-left`/`chevron-right` at 16px (`1em` of the label) with a 4px gap; an enabled end's chevron is `--foreground`. Both always render: a disabled end is `aria-disabled` text wholly in `--muted-foreground` with no hover, so the numbers never shift.
- **Numbers.** Each is a 36px square target with 8px (`--radius`) corners that hovers to a `--card` fill and `--foreground` ink. The current page is not a link: it carries `aria-current="page"` as a `--card` cell with a 1px `--border` and 600 `--foreground`.
- **Gaps.** A gap is the `ellipsis` glyph with `…` as `.sr-only` text.
- **Layout.** The range and the controls sit 24px apart on one row; at `max-width: 600px` the range takes its own row and the controls wrap.

### Menus

> Defined in `src/packages/web-shell/src/shared/menu/menu.styles.ts`.

An overflow menu is a `<details>`/`<summary>` kebab: `ellipsis` on a content row or `ellipsis-vertical` in a narrow rail row. Its 24px `--foreground` glyph is always visible inside a ≥36px hit box, with no fill at rest, on hover or while open. The focus ring sits 2px outside the trigger.

The action panel sits flush below the trigger's hit box with trailing edges aligned. It has a `--card` fill, 1px `--border` edge, `--radius-md` corners, `--shadow-menu`, no inner padding, and a 120px minimum width that grows to fit its content. Full-bleed 44px rows are separated by 1px `--border` hairlines. Each row has 12px side padding, a 20px `--foreground` icon, a 12px gap, and a 14px/500 `--foreground` label. Hover and active fill the whole row with `--muted`; focus draws an inset 2px `--ring`. Delete looks and hovers like every other item; the [dialog](#dialogs) it opens handles the commit.

The desktop header account dropdown uses the same panel and row values without the shared classes. Gmail sender and destination pickers are selection lists: they use the panel tokens with a 4px inset, undivided 8px-radius options and a divider above the create row.

### Dialogs

> **Component:** the shared confirm panel in `@packages/web-shell` (`renderConfirmPopover`, `CONFIRM_POPOVER_STYLES`). The values below belong in that module, never in a page stylesheet.

A dialog is the shared confirm panel, opened as a native popover, and every trigger keeps a plain-form fallback where popover is unsupported. The panel is up to 600px wide, `--card` on a 1px `--border` with no shadow, 16px `--radius-lg` corners, over a [scrim and blur](#shadows--elevation); its padding grows 24px → 32px at 768px.

- **Title** is sans `--text-lg` (18px)/600 on a 28px line in `--foreground`, balanced and 4px above the body. The `x` close control is opt-in for dialogs designed with one and for interim dialogs awaiting their own dismiss action.
- **Body** is `--text-sm` (14px)/22px in `--muted-foreground`, with 24px below it. A list of what the action will touch is a bordered box (1px `--border`, `--radius`) of 56px rows with 24px readlist icons and hairline dividers.
- **Illustration.** A confirmation of a consequential action may carry a 64px-tall [illustration](#illustrations) at the top padding edge, centred 20px above the title line box (about 24px above its glyphs). Its body is centred and capped at 408px. A naming dialog (create or rename a readlist) has none and no ✕, and is left-aligned: the label, then the field (placeholder "Enter readlist name"), then the inline error, then Cancel and a commit named for the action ("Create readlist", "Save"). A problem with the name is an inline field error; the field keeps what the reader typed and takes focus back. The readlist cap and a readlist that no longer exists are page alerts, because no name fixes them. An illustrated confirm that first asks for a choice keeps its art, title and body centred, sets the field left-aligned below the body, and right-aligns the buttons under it (moving or deleting a readlist's articles).
- **Buttons** follow [Pairing](#pairing): the dismiss comes first, the commit last.
- **Plan choice.** The plans are one radio group of bordered rows 12px apart. Each row has 16px padding, `--radius-md` corners and a `--card` fill that hovers to `--neutral-hover`, and holds the radio, the plan name (`--text-sm`/600) over its billed line (`--text-sm` in `--muted-foreground`), and the monthly figure on the right. One commit trails **Cancel**. Only the option a no-choice charge would use starts checked: a returning reader's previous plan, otherwise `DEFAULT_BILLING_PLAN`; the featured option is marked by a [tab badge](#chips-tags-and-badges) and a `--primary` border, and being featured never checks it. The figure drops under the text when the plan form is 348px wide or narrower (phones up to 430px in the dialog). The same form renders inline on `/account/plans`, with no Cancel and named by the page heading.
- **Advisory.** The save tip is illustrated and centred, with no `x` close control; Esc and the backdrop close it. A Tertiary continue control comes before the Primary install action. When the reader already has a capture client, the continue control stands alone as the Primary.

### Alerts and Status

> **Source of truth:** `renderAlert` and `ALERT_STYLES` in `@packages/web-shell`. The design file names this in-page component “Toast”; the product calls it an alert.

An alert stays in its page column until the reader resolves or leaves the state. It fills that column with a 1px border in the variant's mark colour, an opaque variant tint, `--radius` (8px) corners whether standalone or nested, and no shadow. A 1px border plus 15px padding places its content 16px from the outer edge. A 24px icon sits 12px before the text, aligned to its top; a single line of text centres against the icon. The title is Inter 14px/600 and the message is Inter 14px/400, both at 1.6 line height in `--foreground`. A title and message have no gap. The icon is hidden from assistive tech because the text names the state.

| Variant | Border and icon | Fill | Icon | Live region |
|---|---|---|---|---|
| Error | `--color-error` | `--error-bg` | `x-circle` | `role="alert"` |
| Warning | border `--color-warning`; icon `--warning-text` | `--warning-bg` | `alert-triangle` | `role="status"` |
| Success | `--color-success` | `--success-bg` | `check-circle` | `role="status"` |
| Info | `--color-info` | `--info-bg` | `info` | `role="status"` |

An alert may have a title and message, a title alone, or a message alone. Page headings can be `h1` or `h2` inside the alert while keeping the 14px title role. A rich message may contain a link, list, countdown or facts built from escaped server-rendered markup. Links inherit `--foreground`, carry a 1px underline with 3px offset, thicken on hover and use the shared focus ring. Amber link ink falls below 4.5:1 on the light tints. A hidden readlist alert slot has no live-region role. A field error reddens the input's border and sets the message beneath it in `--error-text` (values in [Form Inputs](#form-inputs)).

A **status chip** carries its state's tint fill, a 1px mark border (`--color-error`) and a `--foreground` label at 12px/600, as a [pill](#border-radius): red belongs to the frame, the words stay neutral. `--color-error` is the red for strokes, never a fill.

### Chips, tags and badges

> **Source of truth:** `CHIP_STYLES` in `@packages/web-shell`, injected into every `<head>`. A page stylesheet adds layout only (a margin, its place in a row), never fill, ink, border, type or radius.

One pill family: a 1px border, `--radius-pill`, a declared 1.25 line box, and 8px between a label and an icon. The tab badge is the one exception: `--radius` top corners over square bottom corners, on a 1.2 line box. Height is a `min-height`, so a one-line chip lands exactly on its size and a long name wraps readably.

| Class | Height | Type | Wraps? | Used for |
|---|---|---|---|---|
| `.chip` | 26px | 12px/500 | yes | a tag in a list row or card, the setup guide's progress chip |
| `.chip--badge` | 22px | 12px/500 | no | a short bounded label ("Current", "Me", "Beta") |
| `.chip--large` | 34px | 14px/500 | yes | the reader's tags, including the removable readlist tag |
| `.chip--status` | 34px | 12px/600 | no | a [status chip](#alerts-and-status) |
| `.chip--tab` | 25px | 14px/600 | no | a tab badge ("Most popular"): `--primary` fill and border under `--primary-foreground`, 12px inline padding, `--radius` top corners, attached to the top-left of a bordered box whose top-left corner goes square |

| Tone | Class | Fill / border / ink |
|---|---|---|
| Neutral | (default) | `--muted` / `--border` / `--foreground` |
| Accent | `.chip--accent` | `--color-brand-light` / `--color-brand` / `--foreground`; an accent **badge** paints its label `--primary-text-on-tint` |
| Success | `.chip--success` | `--success-bg` / `--color-success` / `--success-text`, with a trailing `check` in the same ink ("Saved offline") |
| Error | `.chip--error` | `--error-bg` / `--color-error` / `--foreground` |

Labels are sentence case ("Current", "Me"). A name the reader typed wraps inside its pill; a bounded label never wraps. A **removable tag** is a non-interactive `.chip--large` pill holding a POST form whose icon-only `.chip__remove` button draws the 16px × 8px after the label and 12px before the pill edge. The × rests transparent, hovers to a `--card` square, and its focus ring is drawn inset on that `--card` square, because the outset ring on the amber tint falls under 3:1. Its hit area covers the pill's trailing edge and full height (36×36) and stops at the label.

### Toasts

> **Source of truth:** the toast in `@packages/web-shell` (`renderToast`).

A toast confirms a change the reader just made ("Marked as read"). It floats at the bottom right, inset by `--header-inset` to line up with the header (48px on wide screens), and spans the `--page-gutter`s on a phone. It shares the [success alert's](#alerts-and-status) opaque `--success-bg` tint, 1px `--success` border and 24px `check-circle` mark, with `--radius` corners and `--shadow-toast`. Its message is 14px/600 in `--foreground`, with no full stop.

A toast holds at most one action, **Undo**, as a `neutral` M button inside the same 58px box. Each surface renders one toast into a stable mount; a new toast replaces the old. It dismisses after `data-dismiss`, and the shell's `#toast-live-region` announces only its message. The toast itself has no live-region role. **Errors are never toasts** — an error stays on screen as an [alert](#alerts-and-status) or an inline field message until it is resolved.

### Loading States

- **Pending swap.** A tab press that replaces a list responds on the press, not the response: the pressed tab takes the open look at once, the previously open tab drops to its rest look (400, no underline), and the region being replaced dims to `opacity: 0.55` with `cursor: progress` until the new content lands. Dimming a region *about to be replaced* is the one sanctioned opacity fade on live content — never on a single filled button.
- **Processing row.** An item still being processed stays in the list, in place, its metadata replaced by a "Processing" line (the 16px `loader` spinning in `--primary-text` beside 14px `--foreground` text); its disabled state action shares that row, delete stays available. If it runs long, say so plainly and offer the source ("Taking a while — open on example.com").
- **Skeleton row.** When the reader creates an item, a skeleton row stands in where it will land, from the press until the page answers: tinted `--secondary`, bars in `currentColor` at 25% opacity with `--radius-sm` corners, a "Saving…" status led by a pulsing `--primary-text` dot. It matches the height of the row that lands, so the swap doesn't jump.

### Progress and Steppers

**Every progress bar is one pair.** A 6px `--progress-track` (`var(--border)`: `#E2E5EA` / `#2E2E2E`) holding a `--progress-fill` (`var(--success)`: `#3D8B6E` / `#4A9F7F`, 3.25:1 and 4.24:1 against the track), both with pill ends (`--radius-pill`). A bar is green whether its work is running or finished — the design's in-flight bar is green, so the old rule that an in-flight bar is amber is retired; the label beside the bar says which state it is in. The founding-seats bar and setup guide use the pair; import and reader bars move onto it in their own passes.

Multi-step progress is a vertical stepper. Show the total first as a 16px/600 percentage label, 12px over the progress pair. Then list the steps, each with a 20px circular marker in a 24px slot, joined to the next by a 1px dashed `--muted-foreground` line: a done step is a `--success` disc with a white check inside a `--success` ring, the current step a `--foreground` ring with an 8px dot, and an upcoming step a dashed `--muted-foreground` ring. A current step with measured progress uses a `--muted-foreground` pie, rounded up to a quarter and capped at three quarters until complete. Step titles are 14px/600 `--foreground` in every state. Only the current step is expanded by default; done and upcoming steps collapse behind a `chevron-down` that rotates 180° when opened, and a done step never disappears. A step's CTA is `.btn--primary.btn--s`.

The setup guide folds behind its progress row. It is closed by default on phone platforms (iPhone), open on desktop browsers, and its chevron toggles independently of the step chevrons. The title and lede stay above the fold.

### Status Panels and Stat Tiles

An account-status panel reads top to bottom: an optional status chip, a sans title, one muted sentence, the evidence (a date or countdown), one full-width primary CTA, and at most one reassurance line under it. A **countdown or small statistic is a tile**: a `--muted` fill with 1px `--border`, `--radius` and 8px padding, the value first (16px/600, tabular numerals, `--foreground`) and its unit under it (14px/400, `--muted-foreground`), 8px between them. Tiles in a row share equal columns 8px apart.

The readlist subscription notice runs chip → 16 → title → 4 → sentence → 16 → evidence → 16 → CTA → 8 → reassurance line, inside 20px padding. Its CTA is a full-width primary at the M tier (40px).

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
| `.form-input--cta-ring` | A marketing field paired with a CTA, focused with the button's outline (see [Quiet controls](#quiet-controls)) |
| `.form-choice` | A checkbox or radio |

- **A text field** has a 1px `--input` border, `--radius` corners and a `--background` fill — in dark mode that fill sits one step below the `--card` around it, so the field reads as a well. Placeholder text is `--input-placeholder`. The field is named by a visible label above it (14px/500 `--foreground`, 8px gap) or by the heading of the card it sits in; a placeholder is never its only name.
- **Invalid** is `aria-invalid="true"` on the control, which turns its border `--color-error`; one 12px/500 `--error-text` sentence sits 8px below, tied to the control by `aria-describedby` (announced with `role="alert"` when it appears without a page load).
- **A neutral field message** (`.form-field__message`) uses the same 12px/500 metrics in `--muted-foreground` for a status line under a field that reports something other than invalid input, such as the readlist import flash. It is never wired to `aria-describedby`.
- **Disabled** fills the field `--muted` with `--muted-foreground` ink, a `not-allowed` cursor and full opacity; inside a `.form-field` its label greys with it. **In flight:** see [Buttons](#disabled-and-in-flight).
- **Controls use the body face.** The browser gives `input`, `select`, `textarea` and `button` a system font, so every control declares `font: inherit` (or `font-family: inherit` beside its own size, as `.btn` does), or it shows its value and placeholder in a different face from its label.
- **An input paired with a button shares the button's height.** `.form-input` carries `height: var(--input-height)`; pair it with a default (L) button, which is 48px — the same as `--input-height` — so the row lines up with no modifier; the input keeps `padding: var(--input-padding)`. Because `box-sizing: border-box` is global, an explicit shared height is the only reliable equaliser — never fake it with padding or font-size, and never re-declare the height on the button.

Below 600px a field-and-button row stacks when its field would otherwise clip its placeholder, as the readlist save card does. The field takes the full width, and the button drops below it at its own width, 16px under, keeping the L button's 48px height.

#### Checkboxes and radios

`.form-choice` is an 18px box with a 1.5px `--foreground` edge — neutral ink, never amber. A checked checkbox fills `--foreground` under a `--background` check, and an indeterminate one carries a `--background` bar instead. A radio is a ring whose checked state is an 8px `--foreground` dot. Both draw the 2px `--ring` outline on `:focus-visible`.

### App Pages

An **app page** is where a reader manages their library, imports or settings — as opposed to reading an article or a marketing page. App pages (signed-in pages and logged-out tools) are built in three surface layers:

| Layer | Light | Dark | Token | Holds |
|---|---|---|---|---|
| **Chrome** | `#FFFFFF` | `#121212` | `--background` | The sticky header; the fill of a text input |
| **Canvas** | `#F7F8FA` | `#1A1A1A` | `--muted` | The full-bleed ground of the page. Uncarded controls (side-rail navigation, tab strips, pagination, page-level alerts) sit directly on it |
| **Card** | `#FFFFFF` | `#222222` | `--card` | Every content panel, enclosed by `1px solid var(--border)` and no shadow |

The page's `main` grows (`flex: 1 1 auto`) so the canvas meets the bottom of the page — a signed-in page has no footer — or the guest footer, with no `--background` strip between. This does not apply to the reader view (its reading surface stays neutral) or marketing pages (section bands).

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
- **Workspace columns.** When an app page needs more than one column, it uses one set of tracks from `min-width: 1024px`: a `220px` navigation rail, a `minmax(0, 1fr)` main column, a `300px` side column, `var(--column-gap)` (24px) apart, `align-items: start`. From 1200px the design's wider tracks apply: a `230px` rail and a `340px` side column around the fluid main, `--column-gap` (48px) apart. The container uses the frame formula above and pads its top by `--page-top`. The readlist page sets these tracks; other pages set theirs in their own pass. The main track is always `minmax(0, 1fr)` — never the design's fixed 534px — so every width from 431 to 1439px stays fluid. A page with no side panels keeps the tracks and leaves the side column empty so its rail and main line up with the rest of the workspace. A single-purpose page (a form, a settings page) stays one column at its own measure inside the frame — it does not grow a rail to match. Side-column panels stack `24px` apart at every width.
- **Columns collapse by urgency, not source order.** Below 1024px the tracks fold into one `minmax(0, 1fr)` column (`20px` gap). On the readlist, the interleaved main and side columns dissolve (`display: contents`), and `order` places navigation first (the one-row readlist switcher), then any notice the reader must act on, then the alert and save card, then the setup guide, then the tabs and list. An incomplete guide folds to its progress row by default on iPhone; no-client and success cards take the same position. A time-critical notice never falls below a long list on a phone. `order` moves only the painted position — keyboard and screen-reader order still follow the source, so reorder only self-contained panels. An expanded guide in a desktop browser under 1024px paints above the list but is reached after pagination in keyboard order; this is the accepted platform-based fold default. The preferences page keeps its main column together.
- **Gutters grow; cards don't.** An app page container pads `var(--page-top) var(--page-gutter) 64px`, and 80px at the bottom from 1024px, stepping at the breakpoints (never a fluid `clamp()`); the bottom stays 64/80px because the design's frames are cropped artboards. The reader, import and account pages still pad `24px 16px 64px` / `28px 24px 80px` until their own passes move them onto the tokens with their tracks. Editorial and marketing bands (home, landing pages, legal, the blog, the embed page) take `--page-gutter` inline and keep their own vertical rhythm. Card padding is the same at every width — a list row `20px`, a content card `20px 24px` (`20px` all round for a side-column panel), or `24px` all round when it holds a field-and-button row (the readlist save card, per the Final frames), and a header strip `14px` vertical. An inline alert has a 16px inset (1px border plus 15px padding). A dense panel may tighten to `20px` at `max-width: 600px`, but no card grows on desktop. A dialog does grow (24 → 32px at 768px), as does a lone centred container that is the whole page's content (see [Layout Principles](#layout-principles)).
- **Breakpoints.** Lay out on four widths. Where a width is used in both directions, the `max-width` query sits one pixel below its `min-width` twin.

  | Name | Query | What changes |
  |---|---|---|
  | Phone | `max-width: 600px` | Last tightening step: a dense panel's padding may drop 24 → 20px; tab strips split the width equally; optional decoration hides |
  | Tablet | `min-width: 768px` (inverse `max-width: 767px`) | Header nav bar replaces the drawer; `--form-gap` 20 → 24px; dialog padding 24 → 32px; `--page-gutter`, `--page-top` and `--header-inset` 20 → 24px; announcement bars leave the phone gutter |
  | Columns | `min-width: 1024px` (inverse `max-width: 1023px`) | App pages go one column → rail / main / side; a rail may stick; the page's bottom padding 64 → 80px |
  | Frame | `min-width: 1200px` | The design's full grid applies; `--page-gutter`, `--header-inset` and `--column-gap` step to 48px and `--page-top` and `--stack-gap` to 32px; the header centres the library nav |

  A component query off this table must answer an observed collision, not a guess.

### Layout Principles

- **Reading text maxes out at `--reader-max-width` (680px).** Article bodies, the reader view and prose-led pages (the blog, marketing copy) cap their column at the token, never a literal `680px`. A page of cards has no reading measure: its main column is fluid (`minmax(0, 1fr)`) inside the 1200px frame, and card copy stays short (a title, a clamped excerpt, a one-line lede).
- **One measure per page column.** Stacked sections in a column — headings, prose, tab bars, input rows — share one content measure; never cap prose at a per-section `max-width` (e.g. `56ch`) while sibling controls run full-width. The one exception is a centred composition inside a card (an empty state), which may cap its message at ~56ch so centred lines stay short; the cap belongs to the composition, not the column. Left-aligned prose never takes a per-section cap.
- **Fixed-count card rows use an explicit column count** — the item count or a clean divisor of it. `auto-fit`/`minmax` can strand a lone card; reserve it for genuinely variable-length lists.
- **Container padding growth is only for a lone centred container.** Growing padding to 32–40px at `min-width: 768px` applies to a container that is the whole page's content (the sign-in card, a single-column form) and to dialogs. Cards in a multi-card app layout keep a fixed inset at every width — the frame's columns and gaps take up the extra width.
- **Generous whitespace is intentional.** Don't fill space because it's empty.
- **Align to grid.** Layout spacing uses the 4px base; 2px half-steps are allowed inside a component (see [Spacing Scale](#spacing-scale)). Avoid arbitrary pixel values.
- **Mobile first.** Every feature design starts with the smallest viewport.
- **Sticky header** with `position: sticky`, `top: var(--banner-area-height)` (it rides under the fixed announcement bars), a `1px solid var(--border)` bottom edge, and a `--background` fill whatever the page ground — on a `--muted` app page it stays a `--background` band and the border does the separating. **Anything else that sticks offsets from the measured chrome:** `top: calc(var(--banner-area-height) + var(--header-height) + <gap>)`, where the gap is the layout's own top padding, with the same fallbacks the shell's `scroll-padding-top` uses. Never hardcode the header height; the shell keeps `--banner-area-height` current as the banner wraps and measures `--header-height` when the header renders. A sticky column stops sticking once it folds into the single column.
- **Section background rhythm (marketing).** Long marketing pages alternate `--background` and `--muted` section bands so no two adjacent content sections share a fill; every muted band carries a `1px var(--border)` top/bottom rule. `--card` is a card-only surface, never a full-bleed section background.
- **An alert in a column of cards is a card.** It is fully enclosed with `--radius`, its variant's opaque tint and mark border, and a 16px content inset (1px border plus 15px padding). It sits in the stack like any sibling. The full-width-banner rule below stays for edge-to-edge banners, which have no border of their own.
- **Full-width status / alert banners** separate from the block below with `lg` (24px) minimum — never the `md` inter-element gap, and never a `clamp()` that collapses on the smallest viewport where a full-width alert most needs the separation.
- **The page scrolls down only, from 320px up.** No width from 320px to desktop scrolls sideways; content wraps. A text-bearing grid track is `minmax(0, 1fr)`, never a bare `1fr`; a text-bearing flex child sets `min-width: 0`; reader-supplied text breaks with `overflow-wrap: anywhere`. A row of controls (tabs, pagination) wraps rather than becoming a horizontal scroller. Only preformatted code scrolls sideways, in its own box. Wide tables reflow to stacked cards (see the [web skill](./.claude/skills/web/SKILL.md)).

---

## Voice & Copy

### Writing Principles

- **Talk like a person.** Imagine explaining the feature to a friend who's a developer. No marketing speak, no superlatives, no corporate filler.
- **Use contractions.** Write "Couldn't", "You're", "doesn't". "Could not" and "do not" read like a form letter.
- **Product copy is impersonal, but address the reader directly.** Impersonal means no "I" and no "we/our/us" as Readplace's voice; it does **not** mean no "you". Name the actor ("Readplace saves the article", "Readplace doesn't have an app for this device yet") and speak to the reader ("Your saved articles are still here.", "You can create up to 7 readlists."). First person belongs only to correspondence signed by Fayner Brack, Founder & CEO — and there it is "I", never "we".
- **First person needs a visible signature in the same block** — the founder's photo and name, as a greeting ("Hi, I'm Fayner Brack!") or a sign-off ("— Fayner Brack, Founder & CEO"). The "I" stops where that block stops; the page around it returns to product voice. The founder's portrait — a circle, `object-fit: cover`, sized to the text beside it — is the only photograph Readplace supplies itself, and appears only beside his own words, never as decoration on a surface written in the product's voice.
- **A reply button may speak as the reader.** When a control answers a question the product asked, its label may be the reader's reply ("I've done this already"). A confirm dialog instead names the action ("Delete article", "Mark as read everywhere").
- **Say nothing about who or how many build Readplace, or about the business behind it.** Where a legal name is required, the operator is "Proficient Pty Ltd"; the word "company" does not appear in reader-facing copy.
- **Be specific over vague.** "Your article is saved" beats "Action completed." "Import your 847 Pocket articles" beats "Migrate your data."
- **Modest language.** Never "best", "revolutionary", "game-changing", "reimagined". The product speaks for itself.
- **Acknowledge limitations honestly.** "This feature isn't ready yet" beats hiding it or over-promising.
- **Affordances are shown, not narrated.** A scroll cue is a chevron, not a sentence. Never label an obvious gesture with explanatory microcopy — instructional filler is a machine-writing tell.

### Capitalisation

**Use sentence case by default.** Headings, dialog and alert titles, buttons, menu items, form labels, chips, toasts, placeholders and empty states capitalise only the first word and proper names: "Save something for later", "Create a readlist", "Mark as read", "Delete this readlist?", "Readlist limit reached". **Names keep their capitals:** Readplace, feature names ("Next Read"), and the labels of *places and lists* — nav destinations, tabs and list headers ("Import Links", "To Read", "4 Saved Articles"). A name the reader typed renders exactly as typed. Title Case on a button, menu item or form label is drift, not emphasis. The design kit mixes the two ("Mark as Read" beside "Mark as unread"); the product keeps sentence case: "Mark as read", "Log in", "Learn more", "See ways to save". The tagline keeps its own form (see [Brand Identity](#brand-identity)).

### Punctuation

**Labels stop bare; body text stops.** A heading, title, button, tab, chip, menu item, toast, placeholder or status label takes no full stop ("Nothing saved yet", "Marked as read", "50% complete"). A title that asks the reader to decide ends in "?" ("Delete this article?"). Body text — a lede, description, alert or dialog body, note or flash line — ends in a full stop however short ("Cancel anytime.", "3 of 5 links imported."). An ellipsis is the single character "…" ("Saving…"), never three dots. A spaced em dash joins a label to its detail ("Subscribe — $3/month", "Taking a while — open on example.com"). No "Please", no "Oops", no apology in an error.

### Terminology

**Name things consistently.** What a reader pastes, imports or forwards is a **link**. Once Readplace has saved it, it is an **article**. A named list of articles is a **readlist** — lowercase in running text ("Create a readlist", "Delete this readlist?"), capitalised only as a name (the "Readlist" nav item) or at the start of a line. The **library** is everything the reader has saved: what All holds. "URL" stays out of reader-facing copy except for the save tip's "Continue with URL"; elsewhere it belongs on developer surfaces (MCP setup). "Queue" is retired.

### Numbers, Counts and Dates

- **Counts, limits and quantities use numerals**, including small ones: "7 readlists", "Save 50 articles", "0 Saved Articles". Idioms stay words ("one-tap saving", "a few quick steps"). Pluralise from the count ("1 article", "2 articles"), never "article(s)".
- **Zero is an answer; unknown is silence.** Show "(0)" and "0 Saved Articles". A count Readplace can't back yet is left off, leaving the bare label ("Unread", "To Read") — never a placeholder number.
- **Tab counts** read "Label (N)" and cap at "99+" (`formatTabCountLabel`). A count arriving later reserves the width of its widest form so the row doesn't move.
- **Progress** reads "N of M" ("Showing 2 of 2", "Saved 12 of 50") or "N% complete".
- **A plan row's charge** reads "Billed $60 once a year" (`billedLine`); prose keeps "$60 billed once a year" (`billedNote`).
- **Formats:** thousands take a comma ("10,000"), a read time reads "3 min read" with no tilde, dates read "Mar 1, 2027" (`toAbsoluteDate`), prices "$3/month". Numbers that tick or sit in tiles use tabular numerals. A number in a limit comes from the constant that enforces it, never a copied literal.

### UI Copy Patterns

| Context | Do | Don't |
|---|---|---|
| Empty states | Title: "Nothing saved yet" · Line: "Save your first article by pasting a link above, or use the Readplace browser extension to save it in one click." · Action: **Install Chrome extension**. Where no client can be installed — Line: "Save your first article by pasting a link above, or set up one-tap saving from your browser, phone, or AI assistant." · Action: **Set up one-tap saving** | "Wow, it's empty in here!" |
| Advisories | Title: "Save articles the better way" · Body names the client that captures a full page on this device · Buttons: **Continue with URL** / **Explore saving options** | "There are better ways to save!" or "our" as Readplace's voice |
| Confirmations (status) | Toast: "Marked as read", with an **Undo** action | "Awesome! Successfully saved to your library!" |
| Errors | Title: "Readlist limit reached" · Body: "You can create up to 7 readlists. Delete an existing readlist before creating a new one." | "Oops! Something went wrong" |
| Decisions (confirm dialogs) | Title: "Delete this article?" · Body: "This article will be removed from your readlist. You can save it again later." · Buttons: **Delete and don't ask again** / **Delete article** | "Are you sure?" · **OK** / **Cancel** |
| Plan choice | Title: "Choose your plan" · Body: "Get full access to Readplace. Cancel anytime, and everything you've already saved stays readable." · Row: "Yearly" / "Billed $60 once a year" / "$5/month" · Buttons: **Cancel** / **Subscribe now** | **Subscribe Now** in Title Case, or a commit button per plan |
| Loading / in progress | The control's label becomes "Saving…"; a skeleton carries "Saving…"; an overrun says "Taking a while — open on example.com" | "Hang tight! We're fetching your stuff!" |
| Onboarding steps | Step: "Get articles from email" · Why: "Forward a newsletter, or any email with links in it, and the links are saved here for you to read." · Progress: "Saved 12 of 50" | "Welcome to the future of reading!" |

- **An empty state** has three parts: a title stating the fact ("…yet" while emptiness is temporary, plain acknowledgement when empty is the goal — "You're all caught up"), one or two sentences on how the list fills, then at most one button that takes the next step — never a link buried in the sentence. When empty is the goal (all caught up), or the next step is already on screen (a custom readlist is filled from All in the rail), there is no button.
- **A status toast** names the outcome in past tense with no full stop; a reversible change carries **Undo**, an irreversible one asks first.
- **An error's title** names what failed ("Couldn't rename the readlist", "Couldn't create the readlist"); the body gives the cause the reader can check, with the actual limit when there is one, and what to do next.
- **A confirm dialog's title** names the decision ("Delete this article?", "Mark as read in all readlists?", or "Before you leave"); the body states the consequence and what survives. Buttons name their actions ("Delete article", "No, keep unread"); a skippable decision may offer a "don't ask again" alternative. When a delete first needs a choice, the title names the choice ("Move or delete articles"), and the commit keeps one label ("Delete readlist") whatever is picked.
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
- Respect the user's browser theme via `prefers-color-scheme`. The popup paints its first view before it has read anything from the account, so it is the one signed-in surface that follows the system theme rather than the Appearance setting.
- No marketing or upsells inside the popup. It's a tool, not a billboard.
- **The popup uses the same tokens and buttons as every other surface.** Its stylesheet never ships a palette of its own: the extension build puts the theme tokens, `BUTTON_STYLES`, `.sr-only` and the in-flight dots (`DESIGN_SYSTEM_STYLES` in `@packages/web-shell`) ahead of the popup's own rules, which name role tokens and add layout to `.btn` like any page stylesheet. The first-paint skeleton, drawn before that stylesheet loads, carries the same theme tokens inline.

**Compact adaptation.** At 350px the popup keeps one dense line per article. Every other rule in this document applies; these departures hold only in the popup:

- **The popup is the card.** Its body is `--card`, and the list runs edge to edge in it, split by 1px `--border` dividers. There is no list header, count or sort: the collection the popup reads carries no counts.
- **One-line rows.** 8px vertical padding. The title is 14px/600 on one line with an ellipsis and the full title in `title` — the 18px list-title step does not fit beside a row action at this width. A 32px neutral letter disc (`--muted` fill, 1px `--border` ring, `--muted-foreground` initial, `aria-hidden`) marks the site, so the metadata line carries no per-fact glyphs: the site name (truncating, full text in `title`), then the saved time. There is no status marker: the popup lists only unread articles.
- **Row actions sit on the row's trailing edge,** always visible: the state action (`secondary` + `m`) and, only when the server advertises it, an icon-only `trash` delete in a 36px box (`--muted-foreground`, `--error-bg`/`--error-text` on hover, `.sr-only` name). With no overflow menu, this is the one place a delete sits on a row.
- **Saved times stay relative past 30 days** ("3mo ago", "2y ago") rather than switching to a calendar date, so the time never wraps the line.
- **Focus inside the scrolling list** draws `--ring` inset (`outline-offset: -2px`) so the scroller doesn't clip it.
- **Pagination** is centred inside the panel under a `--border` rule, with no "Showing N of M" range. Previous/Next are 36px icon-only `arrow-left`/`arrow-right`, not the web pager's chevrons, with `.sr-only` labels, and the window shows one page either side of the current.
- **Header.** The wordmark is 1.1875rem (19px, still large text for the light tail's 3.62:1) beside a 26px mark, so it shares one row with Save tabs (`neutral` + `s` — the amber CTA is the toolbar save) and Sign out, an icon-only 44px utility. The mark's dot stays the literal `#C8923C` (see [Palette Copies Outside the Web](#palette-copies-outside-the-web)).
- **The filter** is named by an `.sr-only` label rather than a visible one.
- **An empty list always reads "You're all caught up"** — the collection carries no counts to tell never-saved from all-read — and a filter that matches nothing reads "No matching articles". Neither has an illustration or button: the toolbar save is the next step.
- **Full-view skeletons** (the saving card, the list) stay untinted: the `--secondary` tint marks one row being created among settled ones.

### Web App

- The primary reading interface. Design every pixel for long reading sessions.
- **The header has three zones:** the brand on the left, the library destinations centred (from 1200px the header is a `1fr auto 1fr` grid), the account on the right. It is full-bleed, 72px tall including its 1px `--border` bottom edge, padded by `--header-inset` (20px on phones, 24px from 768px, 48px from 1200px), on `--background`. Below 768px the destinations fold into a 44px menu toggle — the 24px `menu` glyph, crossfading to `x` while open — that opens a full-height drawer from the right (`--background`, a `--border` edge, `--shadow-md`, no slide under reduced motion). Each destination is a 24px icon and a 14px/500 label 8px apart, padded `10px 12px` so it is ≥44px tall, 4px from the next, with a `--radius` corner and a `--muted` hover — never amber. Group names (Library, Account) are hidden on the bar (kept for screen readers) and show in the drawer as short uppercase labels, for guests too.
- **The header marks the current page.** The destination for the section the reader is in carries `aria-current="page"`, draws its [solid glyph](#icon-style) and takes `--ink-nav-current` (`#1A202C`); every other destination draws its stroke glyph in `--ink-nav-inactive` (`#5A6170`, 6.22:1). A destination with no solid drawing (Newsletters, Install) is marked by the ink step alone. The section is the path's first segment: `/queue`, `/queues` and `/view` mark Readlist; `/import`, `/inbox`, `/newsletters` and `/install` mark their own destination; every other page — the account page, OAuth consent, the home page, the blog, the auth pages — marks none, and neither does the transparent hero. The current destination stays distinct in greyscale by luminance (16.32:1 against 6.22:1) and by its solid shape. The same states show in the drawer. Account items (the dropdown and the drawer's account section) stay `--foreground`.
- **Announcement bars are near-black and sit above the header.** Every bar is one family sharing one base: an `--announcement-bg` (`#1A202C`, pinned) fill, white 16px/600 text on a 24px line, centred, `14px 72px` padding, no border or shadow. On phones a bar pads by `--page-gutter` and keeps 72px on the side of its close. Bars stack in one fixed area above the header — changelog, offline, verify, extension suggestion — whose measured height drives the header's and every sticky offset.
  - **Close.** A dismissible bar's close is the white 20px `x` in a 44×44 box 12px from the right edge (its glyph sits 29px in), filling white at 15% on hover and focus.
  - **Changelog** (52px): the hook, then 20px on, "Learn more" in `--announcement-link` (`#D4833A`, 5.52:1) with a 20px `arrow-right` 8px after it, underlined on hover. There is no "NEW" chip. Below 480px the hook wraps and the bar grows.
  - **Verify** (52px): "Please verify your email. Check your inbox or spam folder."; while counting down, "Please verify your email within 5 days to keep your account active. Check your inbox or spam folder." A locked account turns it `--error-fill` (`#B95050`, 4.85:1) with `--error-foreground`.
  - **Offline** (no design): a `--warning-bg` band with `--foreground` ink (13.32:1 light, 10.71:1 dark), revealed by its height.
  - **Extension suggestion** (64px): the message and a `secondary` S "See ways to save" CTA as one centred group 16px apart, stacked with a full-width CTA below 768px; no marker, gradient or shadow. The message speaks in the product voice ("Readplace", never the design's "us"): "Some sites don't allow Readplace to save the full article. Use the browser extension or the iPhone app to save the complete page." With the extension installed there is no CTA, and the message says to save the page again with the extension.
  - Never paint bar ink with `--color-secondary` — it is a pinned fill; navy ink uses `--color-secondary-text`. In dark mode the bars stay `#1A202C` above the `#121212` header.
- **The signed-in account is named, not hidden behind an icon.** The right zone shows an initials avatar (a 24px circle in `--color-avatar` with two white 11px/700 initials from the email), the account's name slot — the email, until an account carries a display name — at 14px/500 `--foreground` on one line with an ellipsis (220px at most), and a 24px `chevron-down` in `--foreground` that turns 180° while open; the trigger is ≥44px tall. Account actions — Account, Blog, Privacy, Terms, Sign out, in that order, for a read-only account too — live only in its dropdown, which closes on outside click and Escape. Blog draws `note`; Privacy and Terms draw `file`. The avatar is decorative (`aria-hidden`) — the email beside it is the accessible name. A surface that knows the reader is signed in but not their email (the blog, the embed page) keeps the same dropdown behind a plain "Account" trigger with no avatar. In the phone drawer the identity is a static row above the account items.
- **The guest header** centres Install, Import Links and Features, in that order, and ends with Log in as a `primary` M button carrying the 20px `log-in` glyph. In the drawer the Log in button spans the row.
- **The header carries no trial or subscription countdown.** A trial's state lives on the readlist page, not in the chrome.
- **Only logged-out readers see the footer.** A signed-in reader gets no footer on any page — the product pages, and the blog, legal and marketing pages too — and reaches Privacy and Terms from the account menu. The guest footer keeps its structure on `--footer-bg`: 14px links (`--text-sm`) and an 11px copyright.
- **A section rail is a quiet vertical list.** A sentence-case sans heading (16px/600, `--ink-rail-heading`, flush with the row edge, 12px above the first row) above rows ≥48px tall, 4px apart, with 12px padding and `--radius` corners. Each row is a 24px outline icon and, 8px on, a 14px/500 label, both in `--foreground`; a long label wraps rather than truncating; the current row takes the selected treatment (`--secondary` fill, `--primary-text-on-tint` ink on the label and the outline icon, no border, `aria-current="page"`). A rest row hovers to `--card`. The row that adds an entry is the rail's last row (same geometry, a `plus` icon, a muted label), styled as a row not a `.btn` — the same exception the header's Sign out takes — and removed rather than disabled for an account that cannot write. It opens a naming dialog: Readplace never invents a name for something the reader creates. Per-row actions live in that row's overflow [menu](#menus) in the row's trailing slot, and only rows the reader can change have one — the built-in 'All' readlist has none. Below 1024px the rail collapses into one `<details>` row naming the current readlist (the selected row, with a trailing `chevron-down`); the heading is visually hidden, and the full list, kebabs and create row included, opens inline below it.
- **Signed-in pages follow the reader's Appearance setting** (see [Colour Rules](#colour-rules)). No signed-in page pins a theme.
- **The landing hero uses a transparent header** (`.header--transparent`): no fill, no border, laid over the navy hero, and no destination is current. The wordmark is white with a `--color-highlight` tail; links, icons and the account trigger are white with a translucent white hover; the guest Log in button keeps its `primary` fill. Anything that opens from it (the dropdown, the drawer) is a normal `--card`/`--background` surface with `--foreground` ink.
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

- HTML emails should use the warm amber palette. The CTA is `#AD6225` under white (4.61:1), the web's AA-safe `--primary`, and links are `#A85A1E` — never the kit's `#C8702A` fill, which carries white at 3.62:1 (see [Palette Copies Outside the Web](#palette-copies-outside-the-web)).
- Keep emails short. One purpose per email, one CTA.
- Always include a plain-text version.
- Sender: "Fayner from Readplace <fayner@readplace.com>" on account emails (email verification, welcome, password reset), and "Readplace <readplace@readplace.com>" on every other email. Emails written in the founder's first person sign off "— Fayner Brack, Founder & CEO" (see [Writing Principles](#writing-principles)).

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
- Hardcode hex values or button sizes — use the tokens, and pick a button size class.

---

*Last updated: September 2026*
