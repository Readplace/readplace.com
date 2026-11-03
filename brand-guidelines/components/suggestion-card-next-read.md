### Suggestion card (Next Read)

> **Source of truth:** `next-read.styles.css` in hutch's `shared/next-read`.

The owner's reader suggests one article from the reader's own saves in a card that rests under the article.

- **Placement.** The card takes the reader column's second row, one row gap under the column and at its width. It never floats, and nothing but scrolling reveals it. While there is nothing to suggest, the slot is `display: none` and opens no row.
- **Card.** `--card` on a 1px `--border`, `--radius-lg` corners, 24px padding at every width and no shadow.
- **Heading row.** "Next Read" ("Similar past reads" once every relation is read) at 16px/500 `--foreground`, a step lighter than a panel title, as the design draws it. Beside it sits a dismiss: a 24px `x` in `--foreground` in a 44px box with its glyph on the padding corner, which hovers to `--muted` with `--radius-sm` corners.
- **Title and reason.** The title is plain 18px/600 text, 16px below the heading row. The reason is 14px/1.5 `--muted-foreground`, 8px below the title, and is never clamped.
- **Facts.** 16px below the reason: site · saved time (for a past read, when it was read) · state, at 14px in `--ink-meta`, 16px apart, with 18px fact glyphs 4px from their text and `eye` before the visible "Unread" or "Read". The time stands alone on screen, and "You saved this" ("You saved this on" before a date) / "You read this" is `.sr-only`.
- **Link.** The card's one link is a `primary` M button, "Start reading" (or "Read again"), with a trailing `arrow-right`; its accessible name ends with the title. It sits at the trailing end of the facts row when the card is wider than about 504px, and on its own line at the leading edge otherwise.
