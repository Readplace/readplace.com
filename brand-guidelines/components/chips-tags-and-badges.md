### Chips, tags and badges

> **Source of truth:** `CHIP_STYLES` in `@packages/web-shell`, injected into every `<head>`. A page stylesheet adds layout only (a margin, its place in a row), never fill, ink, border, type or radius.

One pill family: a 1px border, `--radius-pill`, a declared 1.25 line box, and 8px between a label and an icon. The tab badge is the one exception: `--radius` top corners over square bottom corners, on a 1.2 line box. Height is a `min-height`, so a one-line chip lands exactly on its size and a long name wraps readably.

| Class | Height | Type | Wraps? | Used for |
|---|---|---|---|---|
| `.chip` | 26px | 12px/500 | yes | a tag in a list row or card, the setup guide's progress chip |
| `.chip--badge` | 22px | 12px/500 | no | a short bounded label ("Current", "Beta", "Primary") |
| `.chip--large` | 34px | 14px/500 | yes | the reader's tags, including the removable readlist tag |
| `.chip--status` | 34px | 12px/600 | no | a [status chip](alerts-and-status.md#alerts-and-status) |
| `.chip--filter` | 50px | 16px/500 | yes | a filter drawer option: a checkbox drawn as a pill, transparent with 16px inline padding, `--muted` on hover, and a `--foreground` border once ticked |
| `.chip--tab` | 25px | 14px/600 | no | a tab badge ("Most popular"): `--primary` fill and border under `--primary-foreground`, 12px inline padding, `--radius` top corners, attached to the top-left of a bordered box whose top-left corner goes square |

| Tone | Class | Fill / border / ink |
|---|---|---|
| Neutral | (default) | `--muted` / `--border` / `--foreground` |
| Accent | `.chip--accent` | `--color-brand-light` / `--color-brand` / `--foreground`; an accent **badge** paints its label `--primary-text-on-tint` |
| Success | `.chip--success` | `--success-bg` / `--color-success` / `--success-text`, with a trailing `check` in the same ink ("Saved offline"); a status chip keeps `--foreground` ink ("Active") |
| Error | `.chip--error` | `--error-bg` / `--color-error` / `--foreground` |

Labels are sentence case ("Current", "Beta"). A name the reader typed wraps inside its pill; a bounded label never wraps. A **removable tag** is a non-interactive `.chip--large` pill holding a POST form whose icon-only `.chip__remove` button draws the 16px × 8px after the label and 12px before the pill edge. The × rests transparent, hovers to a `--card` square, and its focus ring is drawn inset on that `--card` square, because the outset ring on the amber tint falls under 3:1. Its hit area covers the pill's trailing edge and full height (36×36) and stops at the label.
