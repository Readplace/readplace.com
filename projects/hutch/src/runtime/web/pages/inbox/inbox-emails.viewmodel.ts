import { EMAIL_FEATURE, type LocalTime, toRelativeOrDate } from "@packages/web-shell";
import type { InboxEmailEntry, InboxEmailStatus } from "@packages/domain/inbox";
import { buildLinkCountLabel } from "./inbox-link-count-label";

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
}

const STATUS_LABEL: Record<InboxEmailStatus, string> = {
	received: "Received",
	rejected: "Rejected",
	unparsed: "Couldn’t render",
};

export function toInboxEmailsViewModel(
	entries: InboxEmailEntry[],
	options: { now: Date; linkSummaries: Map<string, InboxEmailLinkSummary> },
): InboxEmailsViewModel {
	return {
		isEmpty: entries.length === 0,
		rows: entries.map((entry) => {
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
