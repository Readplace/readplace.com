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
| **Extension icons** | 16–128px, light (white halo) + dark themes | `projects/extensions/{chrome,firefox}-extension/src/icons/{light,dark}/icon-*.png` |
| **iOS mark + App Store icon** | 72–216px + 1024px | `projects/ios-readplace/scripts/make-brandmark.sh`, `make-appicon.sh` |

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
| **Warm amber** (Primary) | Warm terracotta/amber-brown | `#c8702a` / `hsl(27 65% 47%)` | `--color-brand`, `--primary`, `--accent` | Interactive elements, CTAs, default header brand text, links |
| **Amber dark** | Darker amber | `#a85a1e` | `--color-brand-dark` | Hover/active states on brand elements |
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

### Browser Extension Palette

The Firefox extension uses a slightly different palette tuned for small popup contexts:

| Role | Light | Dark | CSS variable |
|---|---|---|---|
| Brand | `#c8923c` | `#d4a04a` | `--popup-brand` |
| Active background | `#2b3a55` | `#3d4f6f` | `--popup-active-bg` |

---

## Typography

> **Source of truth:** `src/packages/web-shell/src/base.styles.ts` (body font), `src/packages/web-shell/src/base.template.ts` (font loading)

### Typefaces in Use

| Role | Typeface | Weight | Where defined |
|---|---|---|---|
| **Body / UI** | `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (Inter loaded from Google Fonts, weights 400–700) | 400, 500, 600, 700 | `base.styles.ts` → `BASE_RESET_STYLES`; `base.template.ts` preload link |
| **Extension UI** | `Inter, "Source Sans Pro", system-ui, -apple-system, sans-serif` | — | `popup.styles.css` |
| **Brand serif** | `Georgia, "Times New Roman", serif` | — | Extension popup brand text |
| **Reader view** | User-configurable (default: high-legibility serif or sans) | Regular | Article body text in reading mode — this is the user's space |

### Typography Rules

- **Legibility is non-negotiable.** This is a product about reading. If a type choice looks good but reads poorly, reject it.
- **Line-height:** Body text uses `1.6` (set in `BASE_RESET_STYLES`). Minimum `1.3` for headings. Generous spacing is a feature, not a waste of space.
- **Never use all-caps** for more than short labels (e.g., "SAVED", "NEW"). Never for headings or body text.
- **International support:** Typefaces must include full Latin Extended character sets (Portuguese, accented characters). The founder is Brazilian-Australian — this is table stakes.
- **Avoid trendy typefaces.** If it will look dated in 2 years, don't ship it.

### Highlight Words

A single highlight word inside a phrase can be recoloured with `--color-highlight` (warm amber `#c8923c` — the logo dot) to draw the eye without bolding, underlining, or changing size. The pattern is analogous to how the **Read**_place_ wordmark splits the brand into a white stem and an amber tail.

**Rules:**

- Use the same serif face as the surrounding text (`Georgia, "Times New Roman", serif`). The highlight is colour, not type.
- **No weight or size change.** Motion or contrast does the work — bold would be shouting.
- **Never add space** between the default-colour prefix and the highlight word. Readplace is one word, not two.
- One highlight per phrase. If two words need emphasis, pick the stronger one.
- The highlight is visible against navy, white, and muted surfaces. On the warm amber gradient it collapses — choose navy or another neutral for those panels.

**Canonical uses:**

- **Wordmark:** `Read<span class="header__brand-mark">place</span>` — the header brand logo.
- **Hero headline:** the single word that swaps under `A home for …` (articles, newsletters, essays, longreads, news, blogs, stories, posts, reports, interviews).
- **Copy:** sentences where one noun is doing load-bearing work — e.g. `We respect your <span>privacy</span>.`

---

## Iconography & UI Elements

### Icon Style

- **Line-based**, consistent stroke weight (2px at 24×24 default size).
- Rounded end caps, slightly rounded joins — approachable but not bubbly.
- Use a single consistent icon library across all clients (Lucide, Phosphor, or equivalent).
- Icons should feel calm and functional. No filled/solid icons for primary navigation — save filled variants for active/selected states.

### Buttons

| Type | Style | Usage |
|---|---|---|
| **Primary** | Amber background (`--primary`), white text (`--primary-foreground`) | Main action per screen (Save, Import, Subscribe) |
| **Secondary** | Subtle amber tint (`--secondary`), amber text (`--secondary-foreground`) | Supporting actions (Cancel, Back, Filter) |
| **Destructive** | Muted red outline, red text → solid on hover | Delete, remove, unsave |
| **Ghost** | Text-only with hover underline or subtle background | Tertiary actions, inline links |
| **Brand** | `--primary` background, white text | Landing page CTAs |

#### Padding

> Defined in `src/packages/web-shell/src/base.styles.ts` as CSS custom properties. Reference the tier token — never hardcode button padding.

| Tier | Value | CSS variable | Usage |
|---|---|---|---|
| **Primary / Brand** | `12px 24px` | `--button-padding` | Main CTA per screen (Save, Import, Subscribe, hero + landing buttons) |
| **Secondary / Compact** | `8px 16px` | `--button-padding-sm` | Supporting actions — tabs, pagination, filter/copy chips, banner CTAs |
| **Small / Icon** | `4px 8px` | `--button-padding-xs` | Icon, close, dismiss, and row-toggle buttons |
| **Fixed-height (horizontal)** | `24px` | `--button-padding-x` | Buttons sized by `height` (`--input-height` / 48px, or 40px) use `padding: 0 var(--button-padding-x)` so they align with adjacent inputs |

Vertical padding (`12px`) matches `--input-padding`; horizontal follows the 4px spacing scale (`lg` 24 / `md` 16 / `sm` 8). Disclosure toggles (`<details>`/`<summary>` panel headers) and circular icon buttons (the share bubble) are sized to their content, not these tiers.

### Border Radius

> Defined in `base.styles.ts` as CSS custom properties.

| Token | Value | CSS variable | Usage |
|---|---|---|---|
| Small | `6px` | `--radius-sm` | Buttons, inputs, chips |
| Default | `8px` | `--radius` | Cards, panels, navigation links |
| Large | `12px` | `--radius-lg` | Modals, dialogs, dropdown menus |

**Never fully rounded** (pill shapes) for primary UI. This isn't a social app.

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

### Layout Principles

- **Content width for reading should max out at ~680px.** Wider text blocks reduce readability. Chrome and navigation can extend wider (max-width `1000px` for header/footer), but article content stays narrow.
- **Generous whitespace is intentional.** Don't fill space because it's empty. Breathing room is core to the brand.
- **Align to grid.** All spacing should use the 4px base. Avoid arbitrary pixel values.
- **Mobile first.** Every feature design starts with the smallest viewport. The extension popup, mobile web, and app are the most constrained contexts — design for those first.
- **Sticky header** with `position: sticky` and `1px solid var(--border)` bottom border. Background matches `--background`.

---

## Voice & Copy

### Writing Principles

- **Talk like a person.** Imagine explaining the feature to a friend who's a developer. No marketing speak, no superlatives, no corporate filler.
- **Use "I" not "we."** Readplace is solo-built. "I" is more honest and personal.
- **Be specific over vague.** "Your article is saved" beats "Action completed." "Import your 847 Pocket articles" beats "Migrate your data."
- **Modest language.** Never say "best", "revolutionary", "game-changing", "reimagined". The product speaks for itself.
- **Acknowledge limitations honestly.** "This feature isn't ready yet" is always better than hiding it or over-promising.

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

- The toolbar icon is the standalone ampersand mark at 16×16 / 32×32px (dotless at those sizes, per the size cutover), themed light/dark per toolbar (see `projects/extensions/{chrome,firefox}-extension/src/icons/{light,dark}/`).
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
