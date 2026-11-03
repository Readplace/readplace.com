### Tabs

> **Component:** the shared tab strip in `@packages/web-shell` (`UNDERLINE_TABS_STYLES`). The values below belong in that module, never in a page stylesheet.

Tabs that switch between views of the same content are **underline tabs** — never pills, boxed segments or filled chips. The strip is a row of links on a 1px `--border` baseline spanning the content column, above the card it controls, never inside it.

- **Box.** A tab is 40px tall: a 16px label on a 22px line at the top, 16px below it, then a 2px underline slot sitting on the baseline. A transparent `::before` stretches its hit area to 44px, as the M button's does. Side padding is 24px.
- **States.** An inactive tab is 400 in `--ink-tab-inactive`; hover previews the underline in `--muted-foreground`. The open tab carries `aria-current="page"`, and that attribute styles it: 600 `--foreground` with a 2px `--foreground` underline. **The underline is neutral ink, never amber** — amber marks the selected row of a navigation rail, not a selected filter.
- **Dense.** `underline-tabs--dense` narrows the side padding to 12px. Only `/install` uses it, so its two labelled groups of icon tabs share one row at desktop.
- **Phone.** At `max-width: 600px` the tabs split the strip's width equally with 12px side padding. The strip wraps onto another row rather than truncating a label or scrolling sideways.

A tab may carry a count as `Label (N)` (`formatTabCountLabel`), capped at `99+`, `(0)` when there are none, the bare label while the count is unknown. Show a count only where it helps the reader choose the tab, and reserve the width of its widest form so a late count doesn't move the row.
