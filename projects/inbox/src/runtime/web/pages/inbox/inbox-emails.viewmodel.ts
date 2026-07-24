import { type LocalTime, toRelativeOrDate } from "@packages/web-shell";
import type { InboxEmailStatus, ListInboxEmailsResult } from "@packages/domain/inbox";
import { buildInboxEmailDetailUrl } from "./inbox-email-detail.url";
import { buildLinkCountLabel } from "./inbox-link-count-label";
import { buildInboxEmailsUrl } from "./inbox-emails.url";

export interface InboxEmailRowViewModel {
	href: string;
	sender: string;
	subject: string;
	received: LocalTime;
	status: InboxEmailStatus;
	statusLabel: string;
	/** `received` mail renders normally; rejected/unparsed rows surface a badge
	 * inline so the user (and operator) sees that something arrived but did not
	 * render, rather than it silently vanishing. */
	needsBadge: boolean;
	/** "12 links" / "200+ links" once the email's links have been extracted;
	 * omitted before extraction runs and for rows that never have links. */
	linkCountLabel: string | undefined;
}

const INBOX_ADDRESSES_PATH = "/inbox/addresses";

export type InboxEmptyStateKey = "no-address" | "no-mail";

export interface InboxEmptyAddressViewModel {
	name: string;
	address: string;
}

export interface InboxEmailsEmptyViewModel {
	key: InboxEmptyStateKey;
	text: string;
	cta: { href: string; label: string } | undefined;
	addresses: InboxEmptyAddressViewModel[];
}

export interface InboxEmailsViewModel {
	empty: InboxEmailsEmptyViewModel | undefined;
	rows: InboxEmailRowViewModel[];
	showPagination: boolean;
	paginationLinks: { key: "newer" | "older"; label: string; href: string }[];
}

const EMPTY_STATES: Record<InboxEmptyStateKey, InboxEmailsEmptyViewModel> = {
	"no-address": {
		key: "no-address",
		text: "No forwarded emails yet — you don’t have an inbox email address to send them to.",
		cta: { href: INBOX_ADDRESSES_PATH, label: "Create my first inbox address" },
		addresses: [],
	},
	"no-mail": {
		key: "no-mail",
		text: "No forwarded emails yet — forward a newsletter to one of your addresses and it’ll appear here.",
		cta: undefined,
		addresses: [],
	},
};

const STATUS_LABEL: Record<InboxEmailStatus, string> = {
	received: "Received",
	rejected: "Rejected",
	unparsed: "Couldn’t render",
};

function buildPaginationLinks(
	result: ListInboxEmailsResult,
): InboxEmailsViewModel["paginationLinks"] {
	const links: InboxEmailsViewModel["paginationLinks"] = [];
	if (result.hasNewer) {
		links.push({
			key: "newer",
			label: "← Newer",
			href: buildInboxEmailsUrl({
				cursor: {
					direction: "newer",
					receivedAtMessageId: result.emails[0].receivedAtMessageId,
				},
			}),
		});
	}
	if (result.hasOlder) {
		links.push({
			key: "older",
			label: "Older →",
			href: buildInboxEmailsUrl({
				cursor: {
					direction: "older",
					receivedAtMessageId: result.emails[result.emails.length - 1].receivedAtMessageId,
				},
			}),
		});
	}
	return links;
}

function buildEmptyState(
	activeAddresses: InboxEmptyAddressViewModel[],
): InboxEmailsEmptyViewModel {
	return activeAddresses.length === 0
		? EMPTY_STATES["no-address"]
		: { ...EMPTY_STATES["no-mail"], addresses: activeAddresses };
}

export function toInboxEmailsViewModel(
	result: ListInboxEmailsResult,
	options: { now: Date; activeAddresses: InboxEmptyAddressViewModel[] },
): InboxEmailsViewModel {
	const paginationLinks = buildPaginationLinks(result);
	return {
		empty:
			result.emails.length === 0 ? buildEmptyState(options.activeAddresses) : undefined,
		showPagination: paginationLinks.length > 0,
		paginationLinks,
		rows: result.emails.map((entry) => ({
			href: buildInboxEmailDetailUrl({ emailId: entry.receivedAtMessageId, tab: "view" }),
			sender: entry.senderEmail === "" ? "(unknown sender)" : entry.senderEmail,
			subject: entry.subject === "" ? "(no subject)" : entry.subject,
			received: toRelativeOrDate({ iso: entry.receivedAt, now: options.now }),
			status: entry.status,
			statusLabel: STATUS_LABEL[entry.status],
			needsBadge: entry.status !== "received",
			// Only `received` mail ever has links; rejected/unparsed rows never
			// surface a count even if a stray row existed.
			linkCountLabel:
				entry.status === "received" && entry.linkCounts !== undefined
					? buildLinkCountLabel({
							count: entry.linkCounts.kept,
							truncated: entry.linkCounts.truncated,
						})
					: undefined,
		})),
	};
}
