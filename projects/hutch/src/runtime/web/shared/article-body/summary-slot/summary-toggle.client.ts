/**
 * Binds a fire-and-forget beacon to the TL;DR `<details>` so opening or closing
 * the summary is reported to the server. The native `<details>` toggles with
 * zero JS; this only layers the beacon on top when the bundle loads. The element
 * carries its tracking URL in `data-summary-toggle-url` — present only on the
 * internal authenticated reader, absent on the public /view and admin readers,
 * where the selector matches nothing and this is a no-op. Re-binds after htmx
 * swaps because a poll response replaces the summary slot with a fresh
 * `<details>`. A `data-*` flag guards against binding the same element twice
 * across swap events.
 */
export interface SummaryToggleBeaconDeps {
	document: Document;
	sendBeacon: (url: string) => void;
	addSwapListener: (listener: () => void) => void;
}

const BOUND_FLAG = "data-summary-toggle-bound";

export function initSummaryToggleBeacon(deps: SummaryToggleBeaconDeps): void {
	function bind(): void {
		const elements = deps.document.querySelectorAll<HTMLDetailsElement>(
			"details[data-summary-toggle-url]",
		);
		for (let i = 0; i < elements.length; i++) {
			const details = elements[i];
			if (details.getAttribute(BOUND_FLAG) === "true") continue;
			details.setAttribute(BOUND_FLAG, "true");
			// dataset.summaryToggleUrl is guaranteed present by the selector above.
			details.addEventListener("toggle", () => {
				deps.sendBeacon(`${details.dataset.summaryToggleUrl}?state=${details.open ? "open" : "closed"}`);
			});
		}
	}

	bind();
	deps.addSwapListener(bind);
}
