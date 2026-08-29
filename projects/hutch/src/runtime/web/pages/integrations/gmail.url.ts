export const GMAIL_PATH = "/integrations/gmail";
export const GMAIL_VERIFY_PATH = "/integrations/gmail/verify";
export const GMAIL_SENDER_ADD_PATH = "/integrations/gmail/senders/add";
export const GMAIL_SENDER_MAP_PATH = "/integrations/gmail/senders/map";
export const GMAIL_SENDER_REMOVE_PATH = "/integrations/gmail/senders/remove";
export const GMAIL_DISCONNECT_PATH = "/integrations/gmail/disconnect";

export const GMAIL_SETTINGS_URL = "https://mail.google.com/mail/u/0/#settings/fwdandpop";

export type GmailPageError = "sender_invalid" | "sender_duplicate" | "sender_unknown";

export type GmailPageNotice =
	| "connected"
	| "verifying"
	| "sender_added"
	| "sender_removed"
	| "sender_mapped";

export function buildGmailUrl(
	params: { error: GmailPageError } | { notice: GmailPageNotice },
): string {
	const query = new URLSearchParams(
		"error" in params ? { error: params.error } : { notice: params.notice },
	);
	return `${GMAIL_PATH}?${query.toString()}`;
}
