export type InboxPanelStatus = "extracting" | "failed" | "stale" | "terminal";

/** The one place the extraction ladder's precedence is written down, so the two
 * panels cannot drift apart on which state outranks which. `failed` is terminal
 * but distinct from `stale`: the reader sees the same wording, while a test —
 * and the poll attribute — can tell an immediate give-up from a budget that ran
 * out. */
export function panelStatusFor(state: {
	isExtracting: boolean;
	isExtractionFailed: boolean;
	isStalePending: boolean;
}): InboxPanelStatus {
	if (state.isExtracting) return "extracting";
	if (state.isExtractionFailed) return "failed";
	if (state.isStalePending) return "stale";
	return "terminal";
}
