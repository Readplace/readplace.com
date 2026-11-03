### Pagination

> **Component:** the shared pager in `@packages/web-shell` (`PAGINATION_STYLES`). The values below belong in that module, never in a page stylesheet.

Pagination sits **below** the list card, outside it. The leading edge states the range ("Showing 20 of 21"); the trailing edge holds Previous, the page numbers and Next. Show the first page, the last, and one either side of the current. Pagination is hidden on an empty list, and is never amber and never `.btn` buttons.

- **Text.** All pager text is 16px (`--text-md`) in `--ink-pagination` (`--muted-foreground`) at rest: the range at 500, Previous/Next at 400, the numbers at 500.
- **Ends.** Previous/Next are [quiet](../iconography/buttons.md#quiet-controls) text links carrying `chevron-left`/`chevron-right` at 16px (`1em` of the label) with a 4px gap; an enabled end's chevron is `--foreground`. Both always render: a disabled end is `aria-disabled` text wholly in `--muted-foreground` with no hover, so the numbers never shift.
- **Numbers.** Each is a 36px square target with 8px (`--radius`) corners that hovers to a `--card` fill and `--foreground` ink. The current page is not a link: it carries `aria-current="page"` as a `--card` cell with a 1px `--border` and 600 `--foreground`.
- **Gaps.** A gap is the `ellipsis` glyph with `…` as `.sr-only` text.
- **Layout.** The range and the controls sit 24px apart on one row; at `max-width: 600px` the range takes its own row and the controls wrap.
