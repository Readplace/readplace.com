### Buttons

> **Source of truth:** `BUTTON_STYLES` in `src/packages/web-shell/src/base.styles.ts`, injected into every page's `<head>` and compiled into the extension popup's stylesheet by its build.

There is **one** button in the product. Every call to action is `.btn` plus exactly one variant, plus — only where its surroundings demand it — one [size](#size-and-padding) modifier. A page stylesheet may add layout (`width`, `margin`, grid/flex placement, `white-space`) and nothing else. A page never defines its own button class or repaints a `.btn` variant's padding, radius, fill or hover — that is how those values drift apart from page to page. **Every variant this section names belongs in `BUTTON_STYLES`.** `.btn` sets no fill or colour of its own, so a variant the module doesn't define renders as an unstyled button: add it there before its first use.

#### Variants

| Variant | Rest | Hover | Pressed | Label | Edge | Usage |
|---|---|---|---|---|---|---|
| **`primary`** | `--primary` | `--primary-hover` | `--primary-fill` | `--primary-foreground` (white) | — | The amber CTA — the main action per screen (Save, Import, Subscribe, install, landing and pricing CTAs, the guest header's Log in) |
| **`secondary`** (the kit's "Secondary") | `--secondary` | `--secondary-hover` | `--secondary-pressed` | `--primary-text-on-tint` | inset 1px `--color-brand` | The supporting action beside a primary (View on GitHub, Cancel, Back), and a list row's state action (Mark as read, Exclude) |
| **`neutral`** (the kit's "Tertiary") | `--card` | `--neutral-hover` | `--neutral-pressed` | `--foreground` | inset 1px `--border` | A low-emphasis action standing alone, such as an empty state's next step or a toast's Undo, or the dismiss beside a dialog's `primary`, or the alternative beside the public reader bar's `primary`, or the dismiss beside the OAuth consent card's `primary` |
| **`destructive`** | `--card` | `--error-fill` | `--error-fill-hover` | `--error-text` at rest; `--error-foreground` (white) when filled | inset 1px `--color-error` | Standalone destructive actions on account and integrations. The red hover and pressed fills are pinned across themes |
| **`on-dark`** | white | white, deepened | same as hover | `--secondary-foreground` | — | *Context modifier, not a priority level* — a primary sitting on the navy hero |
| **`on-dark-ghost`** | translucent white | more opaque white | same as hover | white | translucent white inset | *Context modifier* — the secondary beside an `on-dark` primary |

`primary` **always** means the amber CTA. The fills are pinned in both themes except `secondary` and `neutral`, which follow the page: in dark the secondary steps `#3D2A18` → `#4A3320` → `#583C25` (the kit's dark hover equals its rest fill, which reads as a sheet bug, so hover takes its own step), and the neutral steps from `--card` `#222222` through `#2A2A2A` to `#2E2E2E`. `on-dark`/`on-dark-ghost` carry theme-stable values because the navy hero is navy in both themes. There is no toggle variant that inverts to a solid fill on hover — a row's state action is a `secondary`. A **tertiary** action is not a button — it is a plain inline link (`--primary-text`, underlined). A confirmed delete commits with amber `primary` inside its dialog; red marks destructive actions taken outside a dialog. The *control that opens* a confirmed delete is a neutral [menu](../components/menus.md#menus) item or, on an Article history row, a neutral trash icon (see [Lists](../components/lists.md#lists)), with no red at rest or on hover. On a [settings row](../components/settings-pages.md#settings-pages), the control that opens a destructive confirmation is a `destructive` M button, the row's one action (Delete account, Disconnect).

**Row actions.** An action repeated on every row of a list (Mark as read on each card, Exclude on each sender) is a `secondary` at size M, never `primary`, so the screen keeps one amber CTA. While its request is in flight the label hides with `visibility: hidden` (the width holds) and the shared in-flight dots take its place; while the item is still processing it is disabled at `opacity: 0.5`.

#### Pairing

Outside dialogs, when two buttons sit side by side, the **first is the primary action and the second is the secondary action** — always in that order, never two of the same weight, and never a button beside a bare text link. A repeated action keeps **one** variant everywhere it appears on a page. A settings choice row's options are one choice, not a pair: each is `neutral`, and the pressed one carries the radio dot. Buttons that share a row share one [size](#size-and-padding): a row never mixes XL, L, M and S.

**Escape hatch.** Two text controls are allowed beside a button:

- a control that marks a step done or skips it ("I've done this already") sits under that step's `primary` as a quiet text action — underlined, `--muted-foreground` → `--foreground` on hover, 14px/500;
- under the OAuth consent card's button row, "Use a different account" is a text button in `--foreground`, 16px/600, underlined 1px at a 3px offset (2px on hover), in a 44px hit box.

An *alternative path* is still a `secondary` button; a link in prose is still `--primary-text`.

**In a dialog**, L buttons have 24px inline padding and sit in one auto-width row, 8px apart: dismiss (`neutral`) first, commit (`primary`) last. The row is right-aligned, or centred when the dialog is illustrated and holds no field. If a pair is too wide for the row, the commit wraps above the dismiss. Below the designed 534px content width, buttons stack full-width with the commit on top.

**In the filter drawer's footer**, Clear all (`neutral`) and Apply filters (`primary`) pair the same way, 16px apart, with 24px inline padding; when they cannot share a line, Apply wraps above Clear all.

**In the public reader's sticky action bar**, Paste another link (`neutral`) and Save to My Readlist (`primary`) pair the same way as XL buttons. They sit 8px apart, at most 400px each, and share the row equally when it is narrower. DOM order is visual order.

**On the OAuth consent card**, Cancel (`neutral`) and Allow access (`primary`) pair the same way as L buttons with 24px inline padding, 8px apart, left-aligned at their content width. When they cannot share a line, Allow access wraps below Cancel at the same left edge, so DOM order stays visual order.

#### Size and padding

> Defined in `BUTTON_STYLES`. Pick a size class — a page never sets a button's height, padding or radius, except the 24px inline padding of a dialog's button row, the filter drawer's footer or the OAuth consent card's button row.

Sizes come by role, not by importance:

| Size | Class | Height | Padding | Radius | Label | Icon, gap | Hit area | Usage |
|---|---|---|---|---|---|---|---|---|
| **XL** | `.btn--xl` | 56px | `16px 24px` | `--radius-md` (12) | 16px/600, 24px line | 20px, 8px | 56px | The public reader's sticky action bar; never a card or dialog button |
| **L** | `.btn` (default) | 48px | `12px 16px` | `--radius` (8) | 16px/600, 24px line | 20px, 8px | 48px | A CTA on its own line: hero, landing, install, pricing, import commit, a card's closing CTA (spanning the card), except the readlist subscription notice, **every dialog button**, a CTA beside a text input — L equals `--input-height`, so the row lines up with no modifier — and the reader's toolbar (Add, Mark) |
| **M** | `.btn--m` | 40px | `8px 14px` | `--radius` (8) | 16px/600 | 20px, 8px | ≥44px (`::before`, `inset: -2px 0`) | A list row's state action (Mark as read, Exclude, Save on an inbox link), a toast's Undo, the guest header's Log in, the readlist subscription notice's full-width CTA, a settings row's actions |
| **S** | `.btn--s` | 32px | `6px 12px` | `--radius-sm` (6) | 14px/600, 20px line | 16px, 6px | ≥44px (`::before`, `inset: -6px 0`) | An action nested in dense secondary content: a checklist or stepper step, a copy button, a banner CTA. Never a card's closing CTA |
| **Icon-only** | `.btn--icon` (with L) | 48px square | `0` | `--radius` (8) | `.sr-only` name | 20px (the filter button's glyph is 24px) | 48px | A bordered icon control in an L row: the readlist's filter button beside its field, the reader toolbar's Share, Download and menu |
| **Icon** | — (not `.btn`) | — | `4px 8px` (`--button-padding-xs`) | `--radius-sm` | — | 16px | per the floor below | Icon-only close and dismiss controls |
| **Kebab** | `.menu__toggle` | ≥36px | — | `--radius-sm` (6) | — | 24px, no fill | ≥36px square | Overflow trigger inside a list |

`.btn--field`, `.btn--compact` and `.btn--toggle` are retired.

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

- A destination (a sidebar row, a menu item) rests in `--foreground`. A page link is the exception: it rests in `--ink-pagination` (`--muted-foreground`; see [Pagination](../components/pagination.md#pagination)). A utility (sort, create, close) rests in `--muted-foreground` and turns `--foreground` on hover.
- A kebab trigger rests in `--foreground` and takes no fill or ink change on hover or open.
- A control with a box shows hover by stepping to the neighbouring surface: `--card` when it sits on the `--muted` ground, `--muted` when it sits on a `--card` or `--background` surface. A text-only control changes ink only.
- **Sort** is one link naming the current order with a direction-arrow icon ("Newest first") that toggles it — not a `<select>`.
- A card's title link carries no underline and turns `--primary-text` on hover.
- The selected row of a navigation rail is filled `--secondary` with `--primary-text-on-tint` ink, keeps that fill on hover, and **has no border** — the one exception to the 1px amber border other selected surfaces take, because the design's selected row steps straight from the ground to the tint.

Amber at rest is kept for calls to action, links in prose, and the active sidebar row.

- **Every focusable control paints the amber `--ring` when focused.** A **text field** shows focus on `:focus` by turning its border `--ring` and adding `0 0 0 1px var(--ring)` — a solid 2px edge with no translucent halo — with `outline: none`. On a marketing page, a field that shares a row with its CTA (`.form-input--cta-ring`) paints that button's `:focus-visible` outline instead, so the pair shows one ring. **Everything else** (buttons, links, selects, checkboxes and radios, `summary` toggles) draws `outline: 2px solid var(--ring)` at 2px offset on `:focus-visible`. A select inside a `.form-input--within` box is the exception: like a text field, it shows focus on the box. The base rule covers `button` and `a`, so any other element declares its own. A dialog panel never takes focus, so it draws no ring; see [Dialogs](../components/dialogs.md#dialogs).

#### Disabled and in-flight

- **Disabled** buttons take `opacity: 0.5` and `cursor: not-allowed` (the kit's disabled fill is exactly its rest fill at 50%); a disabled field is never faded — it takes the `--muted` fill (see [Form Inputs](../spacing-and-layout.md#form-inputs)). A field and the button it pairs with are disabled together.
- **A disabled control that explains itself** is a `<button aria-disabled="true">`, never `disabled`, so it stays in the tab order and can still open its explanation. It keeps the disabled look and returns to full opacity while it shows its focus ring.
- **A disabled link is not a faded link.** Render it as a non-link element with `aria-disabled="true"` in `--muted-foreground`. Disabled text is never `--color-text-muted` (under 3.3:1 in both themes).
- **In flight is not disabled.** A control locked only for its round trip keeps full opacity and takes a `progress` cursor. It shows it is working in place of its label — the shared three-dot loader (label hidden by `visibility: hidden` so width holds), or a progress label ("Saving…"). A region waiting to be replaced may dim to ~55% with a `progress` cursor; it never goes blank.
