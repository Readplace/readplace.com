export interface PopupState {
	closed?: boolean;
}

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
	if ("closed" in parsed) {
		const value = parsed.closed;
		if (typeof value === "boolean") state.closed = value;
	}
	return state;
}

export function serializeState(state: PopupState): string {
	return JSON.stringify(state);
}

/** Whether the reader has permanently dismissed the popup on this device. The
 * server decides *eligibility* (an active trial past its grace period, or a
 * locked-out account); the client only suppresses a popup the reader has already
 * closed here, so it stays hidden on this device but can reappear on another. */
export function isDismissed(state: PopupState): boolean {
	return state.closed === true;
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
