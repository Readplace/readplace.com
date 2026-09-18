import { z } from "zod";
import type { GmailAccountEmail } from "@packages/domain/gmail";

export const GMAIL_PATH = "/integrations/gmail";
export const GMAIL_STATUS_PATH = "/integrations/gmail/status";
export const GMAIL_SENDER_ADD_PATH = "/integrations/gmail/senders/add";
export const GMAIL_SENDER_REMOVE_PATH = "/integrations/gmail/senders/remove";
export const GMAIL_FILTER_RETRY_PATH = "/integrations/gmail/filter/retry";
export const GMAIL_DISCOVERY_START_PATH = "/integrations/gmail/discovery/start";
export const GMAIL_SENDERS_PATH = "/integrations/gmail/senders";
export const GMAIL_DISCONNECT_PATH = "/integrations/gmail/disconnect";

const GMAIL_MAIL_URL = "https://mail.google.com/mail/u/0/";

export function buildGmailMailboxUrl(accountEmail: GmailAccountEmail | undefined): string {
	if (accountEmail === undefined) return GMAIL_MAIL_URL;
	return `${GMAIL_MAIL_URL}?authuser=${encodeURIComponent(accountEmail)}`;
}

export const GMAIL_CONFIRM_MAX_POLLS = 100;

export const GMAIL_DISCOVERY_MAX_POLLS = 260;
export const GMAIL_DISCOVERY_FAST_POLLS = 20;

export type GmailPageError =
	| "sender_invalid"
	| "sender_unknown"
	| "metadata_required"
	| "destination_invalid"
	| "inbox_name_invalid"
	| "inbox_name_taken"
	| "inbox_limit";

export type GmailPageNotice =
	| "connected"
	| "confirmed"
	| "sender_removed"
	| "sender_mapped"
	| "inbox_created"
	| "filter_retry_requested";

export function buildGmailUrl(params: {
	error?: GmailPageError;
	notice?: GmailPageNotice;
	search?: string;
	sender?: string;
	destination?: string;
	inbox_name?: string;
	discovery?: "started";
	discovery_after?: string;
} = {}): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) query.set(key, value);
	}
	const suffix = query.toString();
	return suffix === "" ? GMAIL_PATH : `${GMAIL_PATH}?${suffix}`;
}

export const GMAIL_POLL_STATES = ["awaiting-confirmation", "confirm-failed"] as const;
export const GmailPollStateSchema = z.enum(GMAIL_POLL_STATES);
export type GmailPollState = z.infer<typeof GmailPollStateSchema>;

export function buildGmailStatusUrl(input: { pollCount: number; state: GmailPollState }): string {
	const params = new URLSearchParams({ poll: String(input.pollCount), state: input.state });
	return `${GMAIL_STATUS_PATH}?${params.toString()}`;
}
