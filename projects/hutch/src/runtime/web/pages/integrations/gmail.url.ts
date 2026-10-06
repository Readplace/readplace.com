import { z } from "zod";
import { type GmailAccountEmail, type GmailDeliveryMode, GmailDeliveryModeSchema } from "@packages/domain/gmail";

export const GMAIL_PATH = "/newsletters/gmail";
export const GMAIL_STATUS_PATH = "/newsletters/gmail/status";
export const GMAIL_SENDER_ADD_PATH = "/newsletters/gmail/senders/add";
export const GMAIL_SENDER_REMOVE_PATH = "/newsletters/gmail/senders/remove";
export const GMAIL_FILTER_RETRY_PATH = "/newsletters/gmail/filter/retry";
export const GMAIL_DISCOVERY_START_PATH = "/newsletters/gmail/discovery/start";
export const GMAIL_SENDERS_PATH = "/newsletters/gmail/senders";
export const GMAIL_DISCONNECT_PATH = "/newsletters/gmail/disconnect";
export const GMAIL_READLIST_CREATE_PATH = "/newsletters/gmail/readlists/create";
export const GMAIL_IMPORT_START_PATH = "/newsletters/gmail/imports/start";
export const GMAIL_IMPORT_RETRY_PATH = "/newsletters/gmail/imports/retry";
export const GMAIL_IMPORT_CANCEL_PATH = "/newsletters/gmail/imports/cancel";

const GMAIL_MAIL_URL = "https://mail.google.com/mail/u/0/";

export function buildGmailMailboxUrl(accountEmail: GmailAccountEmail | undefined): string {
	if (accountEmail === undefined) return GMAIL_MAIL_URL;
	return `${GMAIL_MAIL_URL}?authuser=${encodeURIComponent(accountEmail)}`;
}

export const GMAIL_CONFIRM_MAX_POLLS = 100;

export const GMAIL_DISCOVERY_MAX_POLLS = 260;
export const GMAIL_DISCOVERY_FAST_POLLS = 20;

export const GMAIL_SENDER_OPTION_LIMIT = 100;

export type GmailPageError =
	| "sender_invalid"
	| "sender_unknown"
	| "metadata_required"
	| "readlist_invalid"
	| "readlist_choice_required"
	| "readlist_name_invalid"
	| "readlist_limit"
	| "import_in_progress"
	| "import_unavailable"
	| "import_reconnect_required"
	| "import_revoked";

export type GmailPageNotice =
	| "connected"
	| "confirmed"
	| "sender_removed"
	| "sender_mapped"
	| "sender_remapped"
	| "readlist_created"
	| "readlist_reused"
	| "import_started"
	| "import_permission_needed"
	| "import_permission_refused"
	| "import_permission_granted"
	| "import_cancelled"
	| "filter_retry_requested";

export interface GmailPickerState {
	search?: string;
	advanced?: "1";
	sender?: string;
	readlist?: string | readonly string[];
	readlist_choice_for?: string;
	readlist_name?: string;
	delivery?: GmailDeliveryMode;
	import?: "1";
	edit?: "1";
	discovery_after?: string;
}

export interface GmailUrlParams extends GmailPickerState {
	error?: GmailPageError;
	notice?: GmailPageNotice;
	discovery?: "started";
}

const GMAIL_URL_PARAM_ORDER = [
	"error",
	"notice",
	"search",
	"advanced",
	"sender",
	"readlist",
	"readlist_choice_for",
	"readlist_name",
	"delivery",
	"import",
	"edit",
	"discovery",
	"discovery_after",
] as const satisfies readonly (keyof GmailUrlParams)[];

export function buildGmailUrl(params: GmailUrlParams = {}): string {
	const query = new URLSearchParams();
	for (const key of GMAIL_URL_PARAM_ORDER) {
		const value = params[key];
		if (value === undefined) continue;
		if (typeof value === "string") query.set(key, value);
		else for (const readlist of new Set(value)) query.append(key, readlist);
	}
	const suffix = query.toString();
	return suffix === "" ? GMAIL_PATH : `${GMAIL_PATH}?${suffix}`;
}

const optionalText = z.string().optional().catch(undefined);

export const GmailPickerStateSchema = z.object({
	search: optionalText,
	advanced: z.literal("1").optional().catch(undefined),
	sender: optionalText,
	readlist: z.union([z.string(), z.array(z.string())]).transform((value) => [...new Set(typeof value === "string" ? [value] : value)]).optional().catch(undefined),
	readlist_choice_for: optionalText,
	readlist_name: optionalText,
	delivery: GmailDeliveryModeSchema.optional().catch(undefined),
	import: z.literal("1").optional().catch(undefined),
	edit: z.literal("1").optional().catch(undefined),
	discovery_after: optionalText,
});

export function gmailSelectedReadlists(state: GmailPickerState): readonly string[] {
	const value = state.readlist;
	return value === undefined ? [] : typeof value === "string" ? [value] : value;
}

export function parseGmailPickerState(source: unknown): GmailPickerState {
	return GmailPickerStateSchema.catch({}).parse(source);
}

export const GMAIL_POLL_STATES = ["awaiting-confirmation", "confirm-failed"] as const;
export const GmailPollStateSchema = z.enum(GMAIL_POLL_STATES);
export type GmailPollState = z.infer<typeof GmailPollStateSchema>;

export function buildGmailStatusUrl(input: { pollCount: number; state: GmailPollState; picker?: GmailPickerState }): string {
	const params = new URL(buildGmailUrl(input.picker), "https://readplace.com").searchParams;
	params.set("poll", String(input.pollCount));
	params.set("state", input.state);
	return `${GMAIL_STATUS_PATH}?${params.toString()}`;
}
