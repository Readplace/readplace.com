import { EMAIL_FEATURE, type LocalTime, toRelativeOrDate } from "@packages/web-shell";
import type { InboxEmailStatus, ListInboxEmailsResult } from "@packages/domain/inbox";
import { buildLinkCountLabel } from "./inbox-link-count-label";
import { buildInboxEmailsUrl } from "./inbox-emails.url";

/** Per-email link tally, derived by the route from a single per-email Query
 * (no parent-row denormalisation). */
export interface InboxEmailLinkSummary {
	count: number;
	truncated: boolean;
}

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
	currentPage: number;
	totalPages: number;
	showPagination: boolean;
	hasPrev: boolean;
	hasNext: boolean;
	prevUrl: string | undefined;
	nextUrl: string | undefined;
}

const STATUS_LABEL: Record<InboxEmailStatus, string> = {
	received: "Received",
	rejected: "Rejected",
	unparsed: "Couldn’t render",
};

export function toInboxEmailsViewModel(
	result: ListInboxEmailsResult,
	options: { now: Date; linkSummaries: Map<string, InboxEmailLinkSummary> },
): InboxEmailsViewModel {
	const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
	return {
		isEmpty: result.total === 0,
		currentPage: result.page,
		totalPages,
		showPagination: totalPages > 1,
		hasPrev: result.page > 1,
		hasNext: result.page < totalPages,
		prevUrl:
			result.page > 1 ? buildInboxEmailsUrl({ page: result.page - 1 }) : undefined,
		nextUrl:
			result.page < totalPages
				? buildInboxEmailsUrl({ page: result.page + 1 })
				: undefined,
		rows: result.emails.map((entry) => {
			const summary = options.linkSummaries.get(entry.receivedAtMessageId);
			return {
				href: `/inbox/${encodeURIComponent(entry.receivedAtMessageId)}?feature=${EMAIL_FEATURE}`,
				sender: entry.senderEmail === "" ? "(unknown sender)" : entry.senderEmail,
				subject: entry.subject === "" ? "(no subject)" : entry.subject,
				received: toRelativeOrDate({ iso: entry.receivedAt, now: options.now }),
				status: entry.status,
				statusLabel: STATUS_LABEL[entry.status],
				needsBadge: entry.status !== "received",
				// Only `received` mail ever has links; rejected/unparsed rows never
				// surface a count even if a stray row existed.
				linkCountLabel:
					entry.status === "received" && summary !== undefined
						? buildLinkCountLabel(summary)
						: undefined,
			};
		}),
	};
}
