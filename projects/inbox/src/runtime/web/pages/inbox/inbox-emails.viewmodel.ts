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

export interface InboxEmailsViewModel {
	isEmpty: boolean;
	rows: InboxEmailRowViewModel[];
	showPagination: boolean;
	paginationLinks: { key: "newer" | "older"; label: string; href: string }[];
}

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

export function toInboxEmailsViewModel(
	result: ListInboxEmailsResult,
	options: { now: Date },
): InboxEmailsViewModel {
	const paginationLinks = buildPaginationLinks(result);
	return {
		isEmpty: result.emails.length === 0,
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
