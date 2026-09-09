import type { GmailAccountEmail } from "@packages/domain/gmail";

export const GMAIL_PATH = "/integrations/gmail";
export const GMAIL_STATUS_PATH = "/integrations/gmail/status";
export const GMAIL_SENDER_ADD_PATH = "/integrations/gmail/senders/add";
export const GMAIL_SENDER_MAP_PATH = "/integrations/gmail/senders/map";
export const GMAIL_SENDER_REMOVE_PATH = "/integrations/gmail/senders/remove";
export const GMAIL_DISCONNECT_PATH = "/integrations/gmail/disconnect";

const GMAIL_MAIL_URL = "https://mail.google.com/mail/u/0/";
const GMAIL_SETTINGS_FRAGMENT = "#settings/fwdandpop";
const GMAIL_SETTINGS_URL = `${GMAIL_MAIL_URL}${GMAIL_SETTINGS_FRAGMENT}`;

export function buildGmailSettingsUrl(accountEmail: GmailAccountEmail | undefined): string {
	if (accountEmail === undefined) return GMAIL_SETTINGS_URL;
	return `${GMAIL_MAIL_URL}?authuser=${encodeURIComponent(accountEmail)}${GMAIL_SETTINGS_FRAGMENT}`;
}

export const GMAIL_CONFIRM_MAX_POLLS = 100;

export type GmailPageError = "sender_invalid" | "sender_duplicate" | "sender_unknown";

export type GmailPageNotice =
	| "connected"
	| "confirmed"
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

export function buildGmailStatusUrl(pollCount: number): string {
	return `${GMAIL_STATUS_PATH}?poll=${pollCount}`;
}
