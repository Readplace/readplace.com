/** Counts above this render as `99+`. A tab label is a glance target, not a
 * readout: past two digits the exact number stops informing the choice of tab
 * and starts widening it. */
const MAX_DISPLAYED_COUNT = 99;

/**
 * Compose a tab label carrying how many items the tab holds — `To Read (2)`,
 * `Skipped (99+)`. Shared so every tabbed surface counts the same way; a
 * surface with nothing to claim yet (a count still being derived) omits the
 * count by passing the bare label instead of calling this.
 *
 * Zero is shown, not hidden: `(0)` is the answer "none", which is what a reader
 * deciding whether to open the tab needs. Absence of a count means "not known
 * yet", so the two must not collapse into the same rendering.
 */
export function formatTabCountLabel(input: { label: string; count: number }): string {
	const count =
		input.count > MAX_DISPLAYED_COUNT ? `${MAX_DISPLAYED_COUNT}+` : String(input.count);
	return `${input.label} (${count})`;
}
