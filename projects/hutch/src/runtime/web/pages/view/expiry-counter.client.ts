interface ExpiryCounterDeps {
	document: Document;
	now: () => number;
	setIntervalFn: (cb: () => void, ms: number) => unknown;
	clearIntervalFn: (id: unknown) => void;
}

export interface ExpiryCounterController {
	stop(): void;
}

export interface TimeLeft {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

/** Duplicate of `@packages/time-left`'s decomposeTimeLeft. The client IIFE
 * can't transitively pull view-expiry.ts (which imports zod) into the browser
 * bundle, so the formatters live here. A drift test in
 * expiry-counter.client.test.ts pins this output to the server's. */
export function decomposeTimeLeft(ms: number): TimeLeft {
	if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
	const totalSeconds = Math.floor(ms / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const totalHours = Math.floor(totalMinutes / 60);
	const hours = totalHours % 24;
	const days = Math.floor(totalHours / 24);
	return { days, hours, minutes, seconds };
}

/** Mirror of `@packages/time-left`'s formatCounter. */
export function formatCounter(timeLeft: TimeLeft): string {
	const parts: string[] = [];
	if (timeLeft.days > 0) parts.push(`${timeLeft.days}d`);
	if (timeLeft.days > 0 || timeLeft.hours > 0) parts.push(`${timeLeft.hours}h`);
	if (timeLeft.days > 0 || timeLeft.hours > 0 || timeLeft.minutes > 0) parts.push(`${timeLeft.minutes}m`);
	parts.push(`${timeLeft.seconds}s`);
	return parts.join(" ");
}

/** Mirror of view-expiry.ts's formatSaveUtmContent. */
export function formatSaveUtmContent(timeLeft: TimeLeft): string {
	return `${timeLeft.days}d_${timeLeft.hours}h_left`;
}

export function formatCountingMessage(msLeft: number): string {
	return `Public access will expire in ${formatCounter(decomposeTimeLeft(msLeft))}`;
}

export function withSaveUtmContent(href: string, stamp: string): string {
	const url = new URL(href, "https://placeholder.invalid");
	url.searchParams.set("utm_content", stamp);
	if (href.startsWith("/")) return `${url.pathname}${url.search}${url.hash}`;
	return url.toString();
}

const NOOP_CONTROLLER: ExpiryCounterController = { stop() {} };

export function initExpiryCounter(deps: ExpiryCounterDeps): ExpiryCounterController {
	const match = deps.document.querySelector('[data-expiry-state="counting"]');
	if (match === null) return NOOP_CONTROLLER;
	const expiresAtRaw = match.getAttribute("data-expires-at");
	if (expiresAtRaw === null) return NOOP_CONTROLLER;
	const expiresAtMs = Date.parse(expiresAtRaw);
	if (!Number.isFinite(expiresAtMs)) return NOOP_CONTROLLER;
	const counter = match; // TS doesn't propagate narrowing into function-declaration closures

	let stopped = false;
	let intervalId: unknown;

	function rewriteSaveLinks(stamp: string): void {
		const links = deps.document.querySelectorAll<Element>("[data-expiry-save-link]");
		/* c8 ignore next -- V8 block coverage phantom: for...of iterator protocol (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
		for (const link of Array.from(links)) {
			const href = link.getAttribute("href");
			if (href === null) continue;
			link.setAttribute("href", withSaveUtmContent(href, stamp));
		}
	}

	function stop(): void {
		if (stopped) return;
		stopped = true;
		deps.clearIntervalFn(intervalId);
	}

	function tick(): void {
		if (stopped) return;
		const msLeft = expiresAtMs - deps.now();
		/* c8 ignore next -- V8 block coverage phantom: conditional branch already exercised by expired test (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
		if (msLeft <= 0) {
			counter.textContent = "Public access has expired.";
			counter.setAttribute("data-expiry-state", "expired");
			counter.classList.remove("view__expiry--counting");
			counter.classList.add("view__expiry--expired");
			stop();
			return;
		}
		const timeLeft = decomposeTimeLeft(msLeft);
		counter.textContent = formatCountingMessage(msLeft);
		rewriteSaveLinks(formatSaveUtmContent(timeLeft));
	}

	intervalId = deps.setIntervalFn(tick, 1000);
	tick();
	return { stop };
}
