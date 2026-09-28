import type {
	GmailFilterRewriteFailedDetail,
	GmailForwardingConfirmFailedDetail,
} from "./events";

export const GMAIL_FILTER_REWRITE_FAILED_EVENT = "gmail_filter_rewrite_failed";
export const GMAIL_FORWARDING_CONFIRM_FAILED_EVENT = "gmail_forwarding_confirm_failed";

export const GMAIL_METRIC_NAMESPACE = "Readplace/Gmail";
export const GMAIL_FILTER_REWRITE_FAILED_METRIC = "GmailFilterRewriteFailed";
export const GMAIL_FORWARDING_CONFIRM_FAILED_METRIC = "GmailForwardingConfirmFailed";

export const METERED_GMAIL_FILTER_REWRITE_REASONS = [
	"query-too-long",
	"rejected",
] as const satisfies readonly GmailFilterRewriteFailedDetail["reason"][];

export const METERED_GMAIL_FORWARDING_CONFIRM_REASONS = [
	"not-confirmed",
	"invalid-url",
] as const satisfies readonly GmailForwardingConfirmFailedDetail["reason"][];

export interface GmailFilterRewriteFailedLine {
	level: "ERROR";
	message: string;
	event: typeof GMAIL_FILTER_REWRITE_FAILED_EVENT;
	reason: (typeof METERED_GMAIL_FILTER_REWRITE_REASONS)[number];
	userId: string;
}

export interface GmailForwardingConfirmFailedLine {
	level: "ERROR";
	message: string;
	event: typeof GMAIL_FORWARDING_CONFIRM_FAILED_EVENT;
	reason: (typeof METERED_GMAIL_FORWARDING_CONFIRM_REASONS)[number];
	userId: string;
}
