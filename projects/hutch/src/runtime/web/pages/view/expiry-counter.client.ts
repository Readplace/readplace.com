/**
 * Tick the "Public access will expire in Xd Yh Zm Ws" counter on the public
 * /view page.
 *
 * Reads:
 *   [data-test-view-expiry][data-expiry-state="counting"][data-expires-at]
 *
 * The server renders the counter with the correct initial value so the page
 * is correct on first paint and remains correct without JS. This module
 * refreshes the visible text every second and, when the configured grace
 * period elapses, swaps the state to "expired" so CSS can recolour it.
 *
 * It also rewrites every `[data-expiry-save-link]` anchor's `utm_content` to
 * carry the current `Xd_Yh_left` value at click time, so the analytics row
 * for a save click reflects how much time the visitor had left.
 *
 * Permanent links (state="permanent") and already-expired links
 * (state="expired") need no client logic; the script becomes a no-op.
 */

interface ExpiryAnchor {
	href: string;
}

interface ExpiryCounterElement {
	textContent: string | null;
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
}

interface ExpiryDocument {
	querySelector(selector: string): ExpiryCounterElement | null;
	querySelectorAll(selector: string): ArrayLike<ExpiryAnchor>;
}

interface ExpiryCounterDeps {
	document: ExpiryDocument;
	now: () => number;
	setIntervalFn: (cb: () => void, ms: number) => unknown;
	clearIntervalFn: (id: unknown) => void;
}

export interface TimeLeftClient {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

export function decomposeTimeLeftClient(ms: number): TimeLeftClient {
	if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
	const totalSeconds = Math.floor(ms / 1000);
	return {
		days: Math.floor(totalSeconds / 86400),
		hours: Math.floor((totalSeconds % 86400) / 3600),
		minutes: Math.floor((totalSeconds % 3600) / 60),
		seconds: totalSeconds % 60,
	};
}

export function formatCounterText(left: TimeLeftClient): string {
	return `Public access will expire in ${left.days}d ${left.hours}h ${left.minutes}m ${left.seconds}s`;
}

export function formatSaveUtmContentClient(left: TimeLeftClient): string {
	return `${left.days}d_${left.hours}h_left`;
}

/** Replace `utm_content` in an absolute or relative URL while preserving every other query parameter and the path. The server only ever renders well-formed save hrefs so a parse failure here would mean the DOM was tampered with — the `URL` constructor with a base URL is permissive enough that no realistic input throws. */
export function withSaveUtmContent(
	href: string,
	utmContent: string,
): string {
	const parsed = new URL(href, "http://placeholder.invalid");
	parsed.searchParams.set("utm_content", utmContent);
	if (parsed.origin === "http://placeholder.invalid") {
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	}
	return parsed.toString();
}

interface ExpiryCounterController {
	tick(): void;
	stop(): void;
}

export function initExpiryCounter(
	deps: ExpiryCounterDeps,
): ExpiryCounterController | undefined {
	const el = deps.document.querySelector("[data-test-view-expiry]");
	if (el === null) return undefined;
	if (el.getAttribute("data-expiry-state") !== "counting") return undefined;
	const expiresAtRaw = el.getAttribute("data-expires-at");
	if (expiresAtRaw === null) return undefined;
	const expiresAtMs = Date.parse(expiresAtRaw);
	if (!Number.isFinite(expiresAtMs)) return undefined;

	const saveLinks: ExpiryAnchor[] = Array.from(
		deps.document.querySelectorAll("[data-expiry-save-link]"),
	);
	const originalHrefs = saveLinks.map((link) => link.href);

	let intervalId: unknown;
	let stopped = false;

	function tick(): void {
		if (stopped) return;
		const msLeft = expiresAtMs - deps.now();
		const left = decomposeTimeLeftClient(msLeft);
		el?.setAttribute("data-expiry-state", msLeft <= 0 ? "expired" : "counting");
		if (el !== null) {
			el.textContent =
				msLeft <= 0 ? "Public access has expired." : formatCounterText(left);
		}
		const utmContent = formatSaveUtmContentClient(left);
		for (let i = 0; i < saveLinks.length; i += 1) {
			saveLinks[i].href = withSaveUtmContent(originalHrefs[i], utmContent);
		}
		if (msLeft <= 0) {
			stop();
		}
	}

	function stop(): void {
		if (stopped) return;
		stopped = true;
		if (intervalId !== undefined) {
			deps.clearIntervalFn(intervalId);
			intervalId = undefined;
		}
	}

	tick();
	intervalId = deps.setIntervalFn(tick, 1000);

	return { tick, stop };
}
