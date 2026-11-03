### Shadows & Elevation

> Defined in `base.styles.ts`.

An app screen has a canvas and at most two raised layers — never more.

| Layer | Fill | Edge | Shadow | Examples |
|---|---|---|---|---|
| **Canvas** | `--muted` on signed-in app pages and the readers; `--background` on prose pages; marketing pages keep the band rhythm | — | none | page ground, uncarded navigation rails and tab strips |
| **Resting** | `--card` (`#FFFFFF` / `#222222`) | 1px `var(--border)` | **none** | cards, panels |
| **Floating** | `--card` (a full-height drawer takes `--background`) | 1px `var(--border)` | dropdown and row menus: `--shadow-menu`; other layers: their shadow token; none for a dialog or the filter drawer | dropdown and row menus, popovers, toasts, dialogs, the mobile nav drawer, the filter drawer, the reader's Top button, the public reader's action bar (a 1px `--border` top edge only, `--shadow-bar`) |

| Token | Light | Dark | CSS variable | Role |
|---|---|---|---|---|
| Small | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.3)` | `--shadow-sm` | none |
| Medium | `0 4px 6px rgba(0,0,0,0.07)` | `0 4px 6px rgba(0,0,0,0.4)` | `--shadow-md` | the phone nav drawer |
| Menu | `0 0 8px rgb(0 0 0 / 0.15)` | `0 0 8px rgb(0 0 0 / 0.5)` | `--shadow-menu` | dropdown and row menus |
| Toast | `0 4px 16px rgba(0,0,0,0.12)` | `0 4px 16px rgba(0,0,0,0.5)` | `--shadow-toast` | the toast and the reader's Top button |
| Bar | `0 -2px 12px rgba(0,0,0,0.2)` | `0 -2px 12px rgba(0,0,0,0.5)` | `--shadow-bar` | the public reader's sticky action bar |

The menu value matches the measured design halo; the toast and bar values are estimated from their halos (±30%). Floating menus use `--shadow-menu`, and a dialog floats on its scrim alone.

- **A shadow means it floats.** A resting card is border-only — the fill step from the canvas is barely visible in either theme, so the hairline does the separating. A floating menu takes `--shadow-menu`; other floating layers take their own shadow tokens. That keeps every screen at two planes.
- A **toast** is the one tinted floating layer: the opaque success tint, a 1px `--success` edge and `--shadow-toast`.
- A **modal dialog** is a bordered `--card` over a scrim and blur, with no shadow of its own. The shared values are exported constants from `base.styles.ts`, not tokens, because `var()` does not reach `::backdrop`: `SCRIM_LIGHT` `rgb(0 0 0 / 0.5)` (the design's scrim samples black at 50%), `SCRIM_DARK` `rgb(13 13 13 / 0.72)` (no dark design), and `SCRIM_BLUR` `2px` (estimated) for a backdrop blur that degrades to the plain scrim on e-ink. A dialog interpolates them rather than writing its own literals. The filter drawer floats on the same scrim and blur, shadowless, with a 1px `--border` left edge.
- A focus halo or an inset outline built with `box-shadow` is not elevation.
