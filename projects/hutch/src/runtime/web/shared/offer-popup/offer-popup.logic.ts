export interface PopupState {
	firstVisitAt?: number;
	shownAt?: number;
	closed?: boolean;
}

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** The countdown is anchored to the moment the popup is first shown so it stays
 * consistent across reloads on the same device rather than resetting to the top
 * on every paint. */
export const OFFER_WINDOW_MS = 10 * 60 * 1000;

export function parseStoredState(raw: string | null): PopupState {
	if (raw === null) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (parsed === null) return {};
	if (typeof parsed !== "object") return {};
	const state: PopupState = {};
	if ("firstVisitAt" in parsed) {
		const value = parsed.firstVisitAt;
		if (typeof value === "number") state.firstVisitAt = value;
	}
	if ("shownAt" in parsed) {
		const value = parsed.shownAt;
		if (typeof value === "number") state.shownAt = value;
	}
	if ("closed" in parsed) {
		const value = parsed.closed;
		if (typeof value === "boolean") state.closed = value;
	}
	return state;
}

export function serializeState(state: PopupState): string {
	return JSON.stringify(state);
}

/** Decides whether the one-time offer should show on this load and returns the
 * state to persist next. The popup never shows on the first visit (that visit
 * only records `firstVisitAt`); it shows exactly once, on a later visit at least
 * a day after the first; and once the reader closes it (`closed`) or it has been
 * shown once (`shownAt`) it never shows again. */
export function decideVisibility(input: {
	state: PopupState;
	now: number;
}): { show: boolean; next: PopupState } {
	const { state, now } = input;
	if (state.closed === true) return { show: false, next: state };
	if (state.firstVisitAt === undefined) {
		return { show: false, next: { ...state, firstVisitAt: now } };
	}
	if (state.shownAt !== undefined) return { show: false, next: state };
	if (now - state.firstVisitAt >= ONE_DAY_MS) {
		return { show: true, next: { ...state, shownAt: now } };
	}
	return { show: false, next: state };
}

export function formatCountdown(remainingMs: number): string {
	const clamped = remainingMs > 0 ? remainingMs : 0;
	const totalSeconds = Math.floor(clamped / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${pad(minutes)}:${pad(seconds)}`;
}

function pad(value: number): string {
	return value < 10 ? `0${value}` : `${value}`;
}
