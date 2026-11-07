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
| **Amber tint** | `var(--color-brand-light)` `#F5E6D3` | `#3D2A18` | `--secondary` | The ground of a secondary button, a selected navigation row, the reader's current section row and any amber-tinted chip or badge (see [Colour Rules](#colour-rules)) |
| **Amber tint, hover / pressed** | `#EED7BA` / `#E6C9A3` | `#4A3320` / `#583C25` | `--secondary-hover`, `--secondary-pressed` | The secondary button's hover and pressed fills |
| **Amber ink on the tint** | `hsl(27 65% 30%)` `#7E481B` | `#EAA162` | `--primary-text-on-tint` | Every amber word or icon on the tint: a secondary button's label, a selected navigation row, a badge. 6.06 / 5.32 / 4.68:1 on the light tint at rest / hover / pressed, 6.33 / 5.47 / 4.68:1 on the dark tint |
| **On-dark amber ink** | `hsl(27 65% 35%)` | same (pinned) | `--secondary-foreground` | The label of a white `.btn--on-dark` |
| **Brand amber** | `#C8702A` | `#D4833A` | `--color-brand` | Non-text marks only: a control's outline (the secondary button's 1px edge, 3.62:1 on white and 5.38:1 on the dark card), an illustration's amber fills, the light-theme wordmark tail (large text, 3.62:1), the reader summary's solid `sparkles` (3.40:1 on `--muted`, 5.89:1 dark). 3.62:1 on white, so never body words and never a button fill |
| **Brand dark** | `#A85A1E` | `#E89A55` | `--color-brand-dark` | The palette value behind light `--primary-text`. Never referenced directly — it lightens in dark, so as a hover fill it would invert |
| **Brand light** | `#F5E6D3` | `#3D2A18` | `--color-brand-light` | The palette value behind `--secondary` and `--warning-bg`, and the cream sheet in an illustration, inside an ink outline. Anywhere else, reach for those roles, not this value |
| **Announcement** | `#1A202C` | same (pinned) | `--announcement-bg` | The fill of every [announcement bar](platform-specific-guidance.md#web-app) above the header. White on it is 16.32:1 |
| **Announcement link** | `#D4833A` | same (pinned) | `--announcement-link` | The link word on an announcement bar ("Learn more"): 5.52:1 on `--announcement-bg` at 16px/600, 5.06:1 in greyscale. The design kit's `#C8702A` is 4.51:1 in colour but 4.01:1 in greyscale, below the contrast sweep's floor. Only on that fill |
| **Highlight** | `#C8923C` | `#D4A04A` | `--color-highlight` | Highlight words, the wordmark tail on dark and on navy |
| **Focus ring** | `hsl(27 65% 47%)` | `hsl(27 65% 52%)` | `--ring` | Focus indication only |
| **Navy** (Secondary) | `#2B3A55` | `#2B3A55` (pinned) | `--color-secondary`; ink twin `--color-secondary-text` (`#2B3A55` / `#8FA3C8`) | Navy *fills*: hero background, the manifest/tile colour, light-theme `theme-color`, the extension icon background and active states, and the light-theme wordmark stem. Navy *ink* on a surface uses `--color-secondary-text`, never `--color-secondary` (1.39:1 on the dark card) |
| **Avatar** (identity) | `#7C5CE6` | `#8F7AF0` | `--color-avatar` | The fill of the signed-in account's initials disc — the header trigger and the account page's Profile row — and nothing else. One colour for every account, never derived per user or per name. It marks a person, not a state or action — never a link, button, status or decoration. A deliberate exception to the no-high-saturation rule. White initials are 4.64:1 light but 3.38:1 dark, so it carries only decorative (`aria-hidden`) initials, never text a reader must read. The design kit's lighter `#B47DF6` is not adopted: white on it is 2.91:1 |

The design kit's amber CTA is `#C8702A`, which carries white at 3.62:1. The product keeps one AA-safe ladder on the same hue instead — rest `#AD6225`, hover `#9C5821`, pressed `#8B4F1D` (the kit's pressed `#8F4C18` is visually identical) — pinned in both themes, and `#C8702A` stays the brand swatch for marks. The kit's amber ink on its tint (`#C8702A` on `#F5E6D3`, 2.95:1) is likewise replaced by `--primary-text-on-tint`.

### Neutrals

| Role | Light | Dark | CSS variable (role) | Usage |
|---|---|---|---|---|
| **Background** | `#FFFFFF` | `#121212` | `--color-background` (`--background`) | The header band, a text input's fill, marketing `--background` bands |
| **Surface** | `#F7F8FA` | `#1A1A1A` | `--color-surface` (`--muted`) | The ground of an app page that lays out cards; the reader's page ground; muted marketing bands; anything nested inside a card (tiles, chips, a quiet control's hover fill) |
| **Surface Elevated** | `#FFFFFF` | `#222222` | `--color-surface-elevated` (`--card`) | Every card and panel; dropdown menus; dialogs |
| **Border** | `#E2E5EA` | `#2E2E2E` | `--color-border` (`--border` / `--input`) | Card edges, dividers, input borders, subtle separators |
| **Text — Primary** | `#1A202C` | `#E4E4E4` | `--color-text-primary` (`--foreground`) | Body text, headings, titles |
| **Text — Secondary** | `#5A6170` | `#9BA1AE` | `--color-text-secondary` (`--muted-foreground`) | Supporting copy: ledes, excerpts, the header's inactive destinations, a rail heading, pagination text at rest (through `--ink-pagination`), disabled text, a field's placeholder (`--input-placeholder`). Metadata and inactive tabs take `--foreground` through their [ink roles](typography.md#type-scale-product-ui) |
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
- **Amber ink on the amber tint is `--primary-text-on-tint`.** Any amber-tinted ground carrying amber words or an amber icon (a secondary button, a selected navigation row, a badge) fills with `--secondary` and paints its amber with `--primary-text-on-tint` (6.06:1 light, 6.33:1 dark at rest). `--primary-text` on the tint is 4.13:1 — under the floor — so it never sits there. A tint whose content is neutral ink (the offline bar, a warning notice, the reader's current section row) takes `--foreground`. An accent tag keeps `--foreground` ink; an accent badge's amber label uses `--primary-text-on-tint`, never `--color-brand` (2.95:1) or `--primary-text` (4.13:1).
- **Navy words or icons on a surface use `--color-secondary-text`** (`#2B3A55` / `#8FA3C8`). `--color-secondary` is a pinned navy *fill*; on the dark card it measures 1.39:1.
- **Announcement bars are near-black `--announcement-bg` (`#1A202C`), not navy.** Navy stays the hero and the logo tile; a bar above the header is the announcement fill with white words and an `--announcement-link` link (see [Web App](platform-specific-guidance.md#web-app)).
- **State colour is one vocabulary.** Unread and to-do are amber (an 8px CSS dot in `--primary-text`). Done is green (a check in `--success-text` beside words, or a white check on a `--success` fill where the state is a shape). Work in flight is amber ink (a spinning loader or pulsing dot) — but a progress *bar* is always the one green pair (see [Progress and Steppers](components/progress-and-steppers.md#progress-and-steppers)), whether its work is running or done. A [pipeline panel](components/loading-states.md#loading-states) shows its work as that bar, with no spinner. The current step of a sequence is neutral `--foreground`. Red and green keep their error/success meaning everywhere except a [metadata row's](components/lists.md#lists) fixed per-fact tint.
- **The design kit's off-palette colours map onto tokens.** A toggle's on state is `--color-success` (the kit's `#12BA6C`), its off state `--color-text-muted` with a white knob (the kit's `#A3A3A3` is 2.52:1); a radio's off ring is `--foreground` (see [Checkboxes and radios](spacing-and-layout.md#checkboxes-and-radios)); a setup connector or pending pie is `--muted-foreground`; the kit's progress hues (`#F2994A`, `#4C51BF`, `#D92D20`, `#FF9500`) become the state vocabulary above. The kit's star yellow `#FFCF33` is not adopted — no surface draws a star.
- **Inline text links use one token — `--primary-text`.** Light `--primary` is a fill, not a link colour; the link token is the darker amber that clears the floor (5.06:1 light, ~6:1 on the dark card). Do not introduce a third amber for a link, and do not redeclare link colour per block. Emphasis inside a link comes from weight (`<strong>`), never a different hue. There is no global bare-`<a>` reset, so an unstyled link renders browser-default blue — that is a styling gap, not a choice; every body-copy link sets `color: var(--primary-text)`. Links that make up **list UI** (a row title, a source name, a sort control, a page number, the reader header's **Original** link) are not body copy — they rest in their text-role colour and turn amber or `--foreground` only on hover (see [Components](components/lists.md#lists)). Original has no underline and leads with its `external-link` glyph.
- **Reading surfaces stay neutral.** Amber appears in chrome and UI — never behind article text. Article content sits in a `--card` (`#FFFFFF` light, `#222222` dark) on the `--muted` canvas. One named exception: a reader's own highlight is the only amber a reading surface carries, because it is the reader's mark, not chrome. It is `--color-highlight` at about 25% on the light card and about 30% on the dark card, behind the text's own unchanged ink, and the colour-contrast sweep measures it in both themes and in greyscale.
- **Hero gradient:** `linear-gradient(135deg, #2B3A55 0%, #1E2A40 100%)` — a deep navy gradient mirroring the logo tile. Warm amber highlights (`--color-highlight`) sit directly on it.
- **Contrast floors.** Words clear 4.5:1, or 3:1 at 24px, or 3:1 at 18.66px/700. Non-text marks clear 3:1 (icons, dots). A control is judged by what identifies it, against its own fill — its words, or an icon-only control's glyph — and only a control with neither needs its fill to clear 3:1 against what is behind it: the `neutral` filter button's `--card` fill sits on the `--muted` canvas below 3:1, and its glyph carries it. Measure in both themes, and again in greyscale — e-ink panels drop hue, and sRGB greyscale and WCAG luminance disagree by up to 0.7:1. A new surface joins the colour-contrast sweep.
- **A signed-in page renders in the reader's theme.** Every signed-in surface follows the account's Appearance setting (Light, Dark or Auto), resolved server-side so there is no flash. Never pin a signed-in page to one theme (a light-pinned page flips mid-navigation when the reader opens a dark reader). Logged-out pages are designed art and are pinned light (`LIGHT_ONLY_BODY_CLASS`); the public reader view is the one logged-out page that follows the system theme. The extension popup is the one signed-in exception (see [Browser Extension](platform-specific-guidance.md#browser-extension)).

### Palette Copies Outside the Web

`base.styles.ts` is the source; the surfaces that cannot read its CSS carry copies, and a palette change updates them in the same change so they never drift from the web.

| Surface | Where | Values |
|---|---|---|
| **HTML email** | `EMAIL_COLORS` in hutch | The CTA fill is `#AD6225` under white (4.61:1) — the same AA-safe fill as `--primary`, not the kit's `#C8702A` — and links are `#A85A1E` |
| **Browser extension popup** | none of its own | The popup takes the web tokens and `BUTTON_STYLES` through the extension build (see [Browser Extension](platform-specific-guidance.md#browser-extension)), so it follows every web palette change with no copy to update. The one literal is the mark's dot, below |
| **iOS and Android** | `BrandColor` in each app | `primaryFill` `#AD6225`, fixed in both themes, fills anything that carries a white label (the iOS readlist choice's Done button; Android's `colorScheme.primary`, with white `onPrimary`). `amber` stays `#C8702A` / `#D4833A` for the app tint and marks. `secondary` is `#F5E6D3` / `#3D2A18` on both platforms, and Android's `onAmberContainer` is `#7E481B` / `#EAA162`, the native `--primary-text-on-tint` |

**The mark's dot is never a variable.** The popup's inline marks and `brandMarkSvg` keep the literal `fill="#C8923C"`; never point it at a palette variable. The design kit's popup and email frames draw the dot `#C8702A` — that is asset drift, not a new dot colour.
