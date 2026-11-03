### Alerts and Status

> **Source of truth:** `renderAlert` and `ALERT_STYLES` in `@packages/web-shell`. The design file names this in-page component “Toast”; the product calls it an alert.

An alert stays in its page column until the reader resolves or leaves the state. It fills that column with a 1px border in the variant's mark colour, an opaque variant tint, `--radius` (8px) corners whether standalone or nested, and no shadow. A 1px border plus 15px padding places its content 16px from the outer edge. A 24px icon sits 12px before the text, aligned to its top; a single line of text centres against the icon. The title is Inter 14px/600 and the message is Inter 14px/400, both at 1.6 line height in `--foreground`. A title and message have no gap. The icon is hidden from assistive tech because the text names the state.

| Variant | Border and icon | Fill | Icon | Live region |
|---|---|---|---|---|
| Error | `--color-error` | `--error-bg` | `x-circle` | `role="alert"` |
| Warning | border `--color-warning`; icon `--warning-text` | `--warning-bg` | `alert-triangle` | `role="status"` |
| Success | `--color-success` | `--success-bg` | `check-circle` | `role="status"` |
| Info | `--color-info` | `--info-bg` | `info` | `role="status"` |

An alert may have a title and message, a title alone, or a message alone. Page headings can be `h1` or `h2` inside the alert while keeping the 14px title role. A rich message may contain a link, list, countdown or facts built from escaped server-rendered markup. Links inherit `--foreground`, carry a 1px underline with 3px offset, thicken on hover and use the shared focus ring. Amber link ink falls below 4.5:1 on the light tints. A hidden readlist alert slot has no live-region role. A field error reddens the input's border and sets the message beneath it in `--error-text` (values in [Form Inputs](../spacing-and-layout.md#form-inputs)).

A settings change confirms with a success alert in its own section, not a toast, because the account page also renders in the app's chromeless sheet, which carries no toast.

A **status chip** carries its state's tint fill, a 1px mark border (`--color-error` or `--color-success`) and a `--foreground` label at 12px/600, as a [pill](../iconography/border-radius.md#border-radius): the hue belongs to the frame, the words stay neutral. `--color-error` is the red for strokes, never a fill. The readlist subscription notice and the account page's plan summary ("Active", "Cancelled", "Inactive") share the one 34px `.chip--status` size.
