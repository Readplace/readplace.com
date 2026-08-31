import { type LocalTime, toRelativeOrDate } from "@packages/web-shell";
import {
	INBOX_ADDRESSES_PATH,
	type InboxEmailEntry,
	type InboxEmailStatus,
	type ListInboxEmailsResult,
} from "@packages/domain/inbox";
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
	 * render, rather than it silently vanishing. The badge element itself always
	 * renders — carrying the row's status either way — so a test asserts which
	 * status a row is in rather than that a badge is absent. */
	needsBadge: boolean;
	/** "12 links" / "200+ links" once the email's links have been extracted; empty
	 * before extraction runs and for rows that never have links, matching the
	 * detail page's always-present count badge. */
	linkCountLabel: string;
	highlighted: boolean;
}


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

/** One step through the list. The direction glyph is an icon `name` resolved by
 * the template's `{{icon}}`, never markup and never part of `label` — the label
 * is the whole accessible name, so a reader that drops SVG (the markdown
 * representation) still reads "Newer"/"Older". `iconLeading` places the arrow on
 * the side it points to. */
export interface InboxEmailsPaginationLink {
	key: "newer" | "older";
	label: string;
	iconName: "arrow-left" | "arrow-right";
	iconLeading: boolean;
	href: string;
}

export interface InboxEmailsViewModel {
	empty: InboxEmailsEmptyViewModel | undefined;
	rows: InboxEmailRowViewModel[];
	showPagination: boolean;
	paginationLinks: InboxEmailsPaginationLink[];
}

const EMPTY_STATES: Record<InboxEmptyStateKey, InboxEmailsEmptyViewModel> = {
	"no-address": {
		key: "no-address",
		text: "No forwarded emails yet — you don't have an inbox email address to send them to.",
		cta: { href: INBOX_ADDRESSES_PATH, label: "Create my first inbox address" },
		addresses: [],
	},
	"no-mail": {
		key: "no-mail",
		text: "No forwarded emails yet — forward a newsletter to one of your addresses and it'll appear here.",
		cta: undefined,
		addresses: [],
	},
};

const STATUS_LABEL: Record<InboxEmailStatus, string> = {
	received: "Received",
	rejected: "Rejected",
	unparsed: "Couldn't render",
};

/** Empty rather than absent for a row with nothing to count — the element always
 * renders and collapses on `:empty`, so a test asserts the label a row carries
 * instead of probing for a missing element. */
function rowLinkCountLabel(entry: InboxEmailEntry): string {
	if (entry.status !== "received" || entry.linkCounts === undefined) return "";
	return (
		buildLinkCountLabel({
			count: entry.linkCounts.kept,
			truncated: entry.linkCounts.truncated,
		}) ?? ""
	);
}

function buildPaginationLinks(
	result: ListInboxEmailsResult,
): InboxEmailsPaginationLink[] {
	const links: InboxEmailsPaginationLink[] = [];
	if (result.hasNewer) {
		links.push({
			key: "newer",
			label: "Newer",
			iconName: "arrow-left",
			iconLeading: true,
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
			label: "Older",
			iconName: "arrow-right",
			iconLeading: false,
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
	options: {
		now: Date;
		activeAddresses: InboxEmptyAddressViewModel[];
		highlight?: string;
	},
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
			linkCountLabel: rowLinkCountLabel(entry),
			highlighted: entry.receivedAtMessageId === options.highlight,
		})),
	};
}
