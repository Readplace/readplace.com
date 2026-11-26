interface SaveErrorCountdownDeps {
	document: Document;
	setIntervalFn: (cb: () => void, ms: number) => unknown;
	clearIntervalFn: (id: unknown) => void;
}

const SELECTOR = ".save-error__seconds";
const SECONDS_ATTRIBUTE = "data-countdown-seconds";
const TICK_INTERVAL_MS = 1000;

export function initSaveErrorCountdown(
	deps: SaveErrorCountdownDeps,
): void {
	const el = deps.document.querySelector(SELECTOR);
	if (el === null) return;
	const counter = el;

	const startRaw = counter.getAttribute(SECONDS_ATTRIBUTE);
	if (startRaw === null) return;
	const startSeconds = Number.parseInt(startRaw, 10);
	if (!Number.isFinite(startSeconds)) return;

	let seconds = startSeconds;
	let intervalId: unknown;

	function tick(): void {
		seconds--;
		counter.textContent = String(seconds);
		if (seconds <= 0) deps.clearIntervalFn(intervalId);
	}

	intervalId = deps.setIntervalFn(tick, TICK_INTERVAL_MS);
}
