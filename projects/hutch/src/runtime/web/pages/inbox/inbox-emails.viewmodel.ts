import { EMAIL_FEATURE, type LocalTime, toRelativeOrDate } from "@packages/web-shell";
import type { InboxEmailEntry, InboxEmailStatus } from "@packages/domain/inbox";

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
	options: { now: Date },
): InboxEmailsViewModel {
	return {
		isEmpty: entries.length === 0,
		rows: entries.map((entry) => ({
			href: `/inbox/${encodeURIComponent(entry.receivedAtMessageId)}?feature=${EMAIL_FEATURE}`,
			sender: entry.senderEmail === "" ? "(unknown sender)" : entry.senderEmail,
			subject: entry.subject === "" ? "(no subject)" : entry.subject,
			received: toRelativeOrDate({ iso: entry.receivedAt, now: options.now }),
			status: entry.status,
			statusLabel: STATUS_LABEL[entry.status],
			needsBadge: entry.status !== "received",
		})),
	};
}
