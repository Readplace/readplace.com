/**
 * Progressive enhancement for every stored instant the server renders as a
 * `<time datetime="…" data-local-time="…">` baseline. The server emits a
 * UTC-labelled value (unambiguous without JavaScript); this enhancer rewrites
 * each one into the browser's resolved timezone, and re-runs on htmx swaps so
 * boosted navigations stay localised. Dependencies are injected so the browser
 * wiring lives in the build step and the module stays unit-testable.
 */
import {
	formatLocalInstant,
	type LocalTimeStyle,
	toRelativeOrDate,
} from "./local-time.format";

export interface LocalTimeDeps {
	document: Document;
	timeZone: () => string;
	addSwapListener: (cb: () => void) => void;
	now: () => Date;
	every: (ms: number, cb: () => void) => void;
	storage: () => { getItem(key: string): string | null };
}

const SELECTOR = "[data-local-time]";
const TICK_SELECTOR = "[data-local-time-tick]";
const TICK_OFF_KEY = "readplace:local-time-tick-off";
const TICK_INTERVAL_MS = 60_000;

function isParseableIso(iso: string | null): iso is string {
	return iso !== null && !Number.isNaN(Date.parse(iso));
}

/** Explicit so a newly-added mode round-trips through the same client/server
 * formatter instead of silently collapsing to the "date" default. */
function absoluteStyleFor(mode: string | null): LocalTimeStyle {
	if (mode === "datetime") return "datetime";
	if (mode === "time") return "time";
	return "date";
}

export function initLocalTime(deps: LocalTimeDeps): { attach(): void } {
	function localize(el: Element, timeZone: string): void {
		const iso = el.getAttribute("datetime");
		if (!isParseableIso(iso)) return;
		const mode = el.getAttribute("data-local-time");
		if (mode === "relative") {
			// Relative text ("5m ago") is timezone-neutral, so leave it visible and
			// only surface the localised absolute instant as a hover tooltip.
			el.setAttribute("title", formatLocalInstant({ iso, style: "datetime", timeZone }));
			return;
		}
		el.textContent = formatLocalInstant({ iso, style: absoluteStyleFor(mode), timeZone });
	}

	function scan(): void {
		// The viewer's zone is constant for the page, so resolve it once per scan
		// rather than per element — a polling queue re-scans every few seconds.
		const timeZone = deps.timeZone();
		const elements = deps.document.querySelectorAll(SELECTOR);
		for (let i = 0; i < elements.length; i++) {
			localize(elements[i], timeZone);
		}
	}

	function tick(): void {
		const timeZone = deps.timeZone();
		const now = deps.now();
		const elements = deps.document.querySelectorAll(TICK_SELECTOR);
		for (let i = 0; i < elements.length; i++) {
			const el = elements[i];
			const iso = el.getAttribute("datetime");
			if (!isParseableIso(iso)) continue;
			const current = toRelativeOrDate({ iso, now });
			el.setAttribute("data-local-time", current.mode);
			el.textContent = current.label;
			localize(el, timeZone);
		}
	}

	function isTickOptedOut(): boolean {
		try {
			return deps.storage().getItem(TICK_OFF_KEY) === "1";
		} catch {
			return false;
		}
	}

	function attach(): void {
		scan();
		deps.addSwapListener(scan);
		if (!isTickOptedOut()) deps.every(TICK_INTERVAL_MS, tick);
	}

	return { attach };
}
