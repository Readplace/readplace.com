### Border Radius

> Defined in `base.styles.ts` as CSS custom properties.

| Token | Value | CSS variable | Usage |
|---|---|---|---|
| Small | `6px` | `--radius-sm` | S buttons, icon-only buttons, images inside a card (the reader's article images take `--radius`), skeleton bars, thumbnails |
| Default | `8px` | `--radius` | L and M buttons, inputs, rail rows and the other readlist-row consumers (the design's selected-row corner fits 8–8.5px, not 12), alerts and callouts (standalone or nested), toasts, pagination targets and the current-page cell, a header destination's hover; and boxes nested inside a card or dialog (tiles, bordered lists) |
| Medium | `12px` | `--radius-md` | Dropdown and row menus, plan-choice rows, the reader's Top button, and XL buttons |
| Large | `16px` | `--radius-lg` | Cards and panels everywhere, and dialogs |
| Pill | `999px` | `--radius-pill` | Chips (the filter drawer's checkbox chips included) and progress bars |

**Corners step down one size per level of nesting** (card or dialog 16 → nested box, text field or control 8 → S control 6), so an inner corner is never rounder than its container. Two exceptions keep their designed corners: plan-choice rows keep 12px (`--radius-md`) inside the 16px dialog, and a reader's article table keeps 16px (`--radius-lg`) inside the 16px article card. A tile set into a card (a stat or countdown box) is enclosed by 1px `var(--border)` and fills with `--muted`, reading as recessed. An image in a card takes `--radius-sm` and `object-fit: cover`, no border; the reader's article images take `--radius`. Pick the token by what the element *is*, not by how prominent it should look.

Every card follows `--radius-lg` to 16px. Menus move onto the values above in their own pass, and until then their sections below quote the token they read today.

**Pills are for chips and progress bars only.** A chip (status chips, tags and badges, all non-interactive labels) and a progress bar are pills (`--radius-pill`). A [tab badge](../components/chips-tags-and-badges.md#chips-tags-and-badges) is attached to a box, so it is the one non-pill badge. A tag that can be removed stays a non-interactive pill; its remove × is a separate icon-only button inside it (`--radius-sm` hover square, ≥36px square target, sr-only "Remove from {name}"), and the pill itself is never the click target. The one operable pill is a **filter chip**: a checkbox drawn as a pill, and only inside the filter drawer. Anything else you *operate* or that *frames content* — buttons, inputs, tabs, menus and cards — stays on the radius tokens. This isn't a social app. Circles (`border-radius: 50%`) are shapes, not pills, and are reserved for avatars, status/unread dots, step markers, radio rings, the dropzone's icon disc and a settings row's icon well. A checkbox's 5px corner is glyph geometry, not a radius token.

A card laid out in a grid is a fully-enclosed box — `1px solid var(--border)` plus a `--radius*` corner. A vertical divided list lives *inside* one enclosed card (see [Lists](../components/lists.md#lists)); its hairlines never run bare on the page ground. Reserve a bottom-border-only separator for a divided list, never a grid tile, which reads as half-drawn beside its neighbours.
