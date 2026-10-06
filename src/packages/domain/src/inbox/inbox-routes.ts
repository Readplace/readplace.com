export const INBOX_PATH = "/inbox";

export function inboxEmailPath(receivedAtMessageId: string): string {
	return `${INBOX_PATH}/${encodeURIComponent(receivedAtMessageId)}`;
}

export const CUSTOM_EMAILS_PATH = "/newsletters/custom-emails";

export const NEWSLETTERS_PATH = "/newsletters";

export const CUSTOM_EMAILS_ORIGIN_PARAM = "from";

export type CustomEmailsOrigin = "inbox" | "newsletters";

export function parseCustomEmailsOrigin(query: Record<string, unknown>): CustomEmailsOrigin {
	return query[CUSTOM_EMAILS_ORIGIN_PARAM] === "newsletters" ? "newsletters" : "inbox";
}

const ORIGIN_PARAMS: Record<CustomEmailsOrigin, Record<string, string>> = {
	inbox: {},
	newsletters: { [CUSTOM_EMAILS_ORIGIN_PARAM]: "newsletters" },
};

export function buildCustomEmailsUrl(input: {
	origin: CustomEmailsOrigin;
	subpath: string;
	params: Record<string, string>;
}): string {
	const query = new URLSearchParams({ ...input.params, ...ORIGIN_PARAMS[input.origin] }).toString();
	const path = `${CUSTOM_EMAILS_PATH}${input.subpath}`;
	return query === "" ? path : `${path}?${query}`;
}

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
