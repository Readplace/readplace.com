import { initBoostedPageBundle as boostedPageBundle } from "../../shared/boosted-page-bundle.client";

export const initBoostedPageBundle = boostedPageBundle;

interface SaveErrorCountdownDeps {
	document: Document;
	setIntervalFn: (cb: () => void, ms: number) => unknown;
	clearIntervalFn: (id: unknown) => void;
}

export interface SaveErrorCountdownController {
	stop(): void;
}

const SELECTOR = ".save-error__seconds";
const SECONDS_ATTRIBUTE = "data-countdown-seconds";
const TICK_INTERVAL_MS = 1000;
const NOOP_CONTROLLER: SaveErrorCountdownController = { stop() {} };

export function initSaveErrorCountdown(
	deps: SaveErrorCountdownDeps,
): SaveErrorCountdownController {
	const el = deps.document.querySelector(SELECTOR);
	if (el === null) return NOOP_CONTROLLER;
	const counter = el;

	const startRaw = counter.getAttribute(SECONDS_ATTRIBUTE);
	if (startRaw === null) return NOOP_CONTROLLER;
	const startSeconds = Number.parseInt(startRaw, 10);
	if (!Number.isFinite(startSeconds)) return NOOP_CONTROLLER;

	let seconds = startSeconds;
	let intervalId: unknown;

	function tick(): void {
		seconds--;
		counter.textContent = String(seconds);
		if (seconds <= 0) deps.clearIntervalFn(intervalId);
	}

	intervalId = deps.setIntervalFn(tick, TICK_INTERVAL_MS);
	return {
		stop() {
			deps.clearIntervalFn(intervalId);
		},
	};
}
