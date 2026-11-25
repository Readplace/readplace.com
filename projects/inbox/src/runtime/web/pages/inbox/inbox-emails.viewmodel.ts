import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { inbox } from "@packages/translations/inbox";
import { type LocalTime, toRelativeOrDate, withInternalTracking } from "@packages/web-shell";
import {
	CUSTOM_EMAILS_PATH,
	type InboxEmailEntry,
	type InboxEmailStatus,
	type InboxEmailsCursor,
	type ListInboxEmailsResult,
} from "@packages/domain/inbox";
import { buildInboxEmailDetailUrl } from "./inbox-email-detail.url";
import { buildLinkCountLabel } from "./inbox-link-count-label";
import { buildInboxEmailsUrl } from "./inbox-emails.url";

const INBOX_EMAILS_SOURCE = "inbox-emails";
const INBOX_EMPTY_SOURCE = "inbox-empty";
const INBOX_PAGINATION_SOURCE = "inbox-pagination";
const PLANS_PATH = "/account/plans";

const { t } = translator(inbox, DEFAULT_LOCALE);

export interface InboxEmailRowViewModel {
	href: string;
	sender: string;
	recipient: string;
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


export type InboxEmptyStateKey = "no-address" | "no-mail" | "paid-plan";

export interface InboxEmptyAddressViewModel {
	name: string;
	address: string;
}

export interface InboxEmailsEmptyViewModel {
	key: InboxEmptyStateKey;
	title: string;
	body: string;
	actions: { key: "create-first-address" | "see-plans"; href: string; label: string }[];
	addresses: InboxEmptyAddressViewModel[];
}

/** One step through the list. The direction glyph is an icon `name` resolved by
 * the template's `{{icon}}`, never markup and never part of `label` — the label
 * is the whole accessible name, so a reader that drops SVG (the markdown
 * representation) still reads "Newer"/"Older". */
export interface InboxEmailsPaginationLink {
	key: InboxEmailsCursor["direction"];
	label: string;
	iconName: "chevron-left" | "chevron-right";
	href: string | undefined;
}

export interface InboxEmailsViewModel {
	senderFilter: {
		currentLabel: string;
		allSelected: boolean;
		options: { address: string; selected: boolean }[];
		label: string;
		all: string;
		action: string;
	} | undefined;
	countLabel: string;
	empty: InboxEmailsEmptyViewModel | undefined;
	rows: InboxEmailRowViewModel[];
	showPagination: boolean;
	paginationLinks: InboxEmailsPaginationLink[];
}

const EMPTY_STATES: Record<InboxEmptyStateKey, InboxEmailsEmptyViewModel> = {
	"no-address": {
		key: "no-address",
		title: "No emails yet",
		body: "Create a custom email and subscribe to a newsletter with it. Each issue appears here, and Readplace saves the articles it links to into All.",
		actions: [
			{
				key: "create-first-address",
				href: withInternalTracking(CUSTOM_EMAILS_PATH, {
					source: INBOX_EMPTY_SOURCE,
					content: "create-first-address",
				}),
				label: "Create my first custom email",
			},
		],
		addresses: [],
	},
	"no-mail": {
		key: "no-mail",
		title: "No emails yet",
		body: "Subscribe to a newsletter with one of these custom emails, or forward an issue to it. Each issue appears here, and Readplace saves the articles it links to into All.",
		actions: [],
		addresses: [],
	},
	"paid-plan": {
		key: "paid-plan",
		title: t("customEmails.paidPlanLocked.title"),
		body: t("customEmails.paidPlanLocked.body"),
		actions: [
			{
				key: "see-plans",
				href: withInternalTracking(PLANS_PATH, { source: INBOX_EMPTY_SOURCE, content: "see-plans" }),
				label: t("customEmails.paidPlanLocked.link"),
			},
		],
		addresses: [],
	},
};

const STATUS_LABEL: Record<InboxEmailStatus, string> = {
	received: "Received",
	rejected: "Rejected",
	unparsed: "Couldn't render",
};

/** Empty rather than absent for a row with nothing to count — the element always
 * renders, so a test asserts the label a row carries instead of probing for a
 * missing element. */
function rowLinkCountLabel(entry: InboxEmailEntry): string {
	if (entry.status !== "received" || entry.linkCounts === undefined) return "";
	return (
		buildLinkCountLabel({
			count: entry.linkCounts.kept,
			truncated: entry.linkCounts.truncated,
		}) ?? ""
	);
}

function paginationHref(cursor: InboxEmailsCursor, sender: string | undefined): string {
	return withInternalTracking(buildInboxEmailsUrl({ cursor, sender }), {
		source: INBOX_PAGINATION_SOURCE,
		content: cursor.direction,
	});
}

function buildPaginationLinks(
	result: ListInboxEmailsResult,
	sender?: string,
): InboxEmailsPaginationLink[] {
	return [
		{
			key: "newer",
			label: "Newer",
			iconName: "chevron-left",
			href: result.hasNewer
				? paginationHref({
						direction: "newer",
						receivedAtMessageId: result.emails[0].receivedAtMessageId,
					}, sender)
				: undefined,
		},
		{
			key: "older",
			label: "Older",
			iconName: "chevron-right",
			href: result.hasOlder
				? paginationHref({
						direction: "older",
						receivedAtMessageId: result.emails[result.emails.length - 1].receivedAtMessageId,
					}, sender)
				: undefined,
		},
	];
}

function buildCountLabel(result: ListInboxEmailsResult): string {
	if (result.hasNewer || result.hasOlder) return "Emails";
	const count = result.emails.length;
	return `${count} ${count === 1 ? "Email" : "Emails"}`;
}

function buildEmptyState({
	activeAddresses,
	paidFeaturesLocked,
}: {
	activeAddresses: InboxEmptyAddressViewModel[];
	paidFeaturesLocked: boolean;
}): InboxEmailsEmptyViewModel {
	if (paidFeaturesLocked) return EMPTY_STATES["paid-plan"];
	return activeAddresses.length === 0
		? EMPTY_STATES["no-address"]
		: { ...EMPTY_STATES["no-mail"], addresses: activeAddresses };
}

export function toInboxEmailsViewModel(
	result: ListInboxEmailsResult,
	options: {
		now: Date;
		activeAddresses: InboxEmptyAddressViewModel[];
		paidFeaturesLocked: boolean;
		highlight?: string;
		sender?: string;
		senders?: string[];
	},
): InboxEmailsViewModel {
	return {
		senderFilter: options.senders?.length || options.sender ? {
			currentLabel: options.sender ? (options.senders?.includes(options.sender) ? options.sender : t("senderFilter.unavailable")) : t("senderFilter.all"),
			allSelected: !options.sender,
			options: (options.senders ?? []).map(address => ({ address, selected: address === options.sender })),
			label: t("senderFilter.label"),
			all: t("senderFilter.all"),
			action: buildInboxEmailsUrl({}),
		} : undefined,
		countLabel: buildCountLabel(result),
		empty:
			result.emails.length === 0 && options.sender === undefined ? buildEmptyState(options) : undefined,
		showPagination: result.hasNewer || result.hasOlder,
		paginationLinks: buildPaginationLinks(result, options.sender),
		rows: result.emails.map((entry) => ({
			href: withInternalTracking(
				buildInboxEmailDetailUrl({ emailId: entry.receivedAtMessageId, tab: "view" }),
				{ source: INBOX_EMAILS_SOURCE, content: "open-email" },
			),
			sender: entry.senderEmail === "" ? "(unknown sender)" : entry.senderEmail,
			recipient: entry.recipientAddress,
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
