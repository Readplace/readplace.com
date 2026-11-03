### Toasts

> **Source of truth:** the toast in `@packages/web-shell` (`renderToast`).

A toast confirms a change the reader just made ("Marked as read"). It floats at the bottom right, inset by `--header-inset` to line up with the header (48px on wide screens), and spans the `--page-gutter`s on a phone. It shares the [success alert's](alerts-and-status.md#alerts-and-status) opaque `--success-bg` tint, 1px `--success` border and 24px `check-circle` mark, with `--radius` corners and `--shadow-toast`. Its message is 14px/600 in `--foreground`, with no full stop.

A toast holds at most one action, **Undo**, as a `neutral` M button inside the same 58px box. Each surface renders one toast into a stable mount; a new toast replaces the old. It dismisses after `data-dismiss`, and the shell's `#toast-live-region` announces only its message. The toast itself has no live-region role. **Errors are never toasts** — an error stays on screen as an [alert](alerts-and-status.md#alerts-and-status) or an inline field message until it is resolved.
