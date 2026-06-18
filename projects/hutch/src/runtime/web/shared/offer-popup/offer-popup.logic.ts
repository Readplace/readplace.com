export interface PopupState {
	closed?: boolean;
}

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
