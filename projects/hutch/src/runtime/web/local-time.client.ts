/**
 * Progressive enhancement for every stored instant the server renders as a
 * `<time datetime="…" data-local-time="…">` baseline. The server emits a
 * UTC-labelled value (unambiguous without JavaScript); this enhancer rewrites
 * each one into the browser's resolved timezone, and re-runs on htmx swaps so
 * boosted navigations stay localised. Dependencies are injected so the browser
 * wiring lives in build-client-bundles.js and the module stays unit-testable.
 */
import {
	formatLocalInstant,
	type LocalTimeStyle,
} from "@packages/web-shell/local-time.format";

export interface LocalTimeDeps {
	document: Document;
	timeZone: () => string;
	addSwapListener: (cb: () => void) => void;
}

const SELECTOR = "[data-local-time]";

function isParseableIso(iso: string | null): iso is string {
	return iso !== null && !Number.isNaN(Date.parse(iso));
}

export function initLocalTime(deps: LocalTimeDeps): { attach(): void } {
	function localize(el: Element): void {
		const iso = el.getAttribute("datetime");
		if (!isParseableIso(iso)) return;
		const timeZone = deps.timeZone();
		const mode = el.getAttribute("data-local-time");
		if (mode === "relative") {
			// Relative text ("5m ago") is timezone-neutral, so leave it visible and
			// only surface the localised absolute instant as a hover tooltip.
			el.setAttribute("title", formatLocalInstant({ iso, style: "datetime", timeZone }));
			return;
		}
		const style: LocalTimeStyle = mode === "datetime" ? "datetime" : "date";
		el.textContent = formatLocalInstant({ iso, style, timeZone });
	}

	function scan(): void {
		const elements = deps.document.querySelectorAll(SELECTOR);
		for (let i = 0; i < elements.length; i++) {
			localize(elements[i]);
		}
	}

	function attach(): void {
		scan();
		deps.addSwapListener(scan);
	}

	return { attach };
}
