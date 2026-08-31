export const INBOX_PATH = "/inbox";

export const INBOX_ADDRESSES_PATH = `${INBOX_PATH}/addresses`;

export const INBOX_HIGHLIGHT_PARAM = "highlight";

export function buildInboxHighlightUrl(state: { receivedAtMessageId?: string }): string {
	if (state.receivedAtMessageId === undefined) {
		return INBOX_PATH;
	}
	const params = new URLSearchParams();
	params.set(INBOX_HIGHLIGHT_PARAM, state.receivedAtMessageId);
	return `${INBOX_PATH}?${params.toString()}`;
}

export function parseInboxHighlight(query: Record<string, unknown>): string | undefined {
	const value = query[INBOX_HIGHLIGHT_PARAM];
	return typeof value === "string" && value !== "" ? value : undefined;
}
