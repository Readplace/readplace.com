import { EMAIL_FEATURE } from "@packages/web-shell";
import type { InboxEmailEntry, InboxEmailStatus } from "@packages/domain/inbox";

export interface InboxEmailRowViewModel {
	href: string;
	sender: string;
	subject: string;
	receivedAgo: string;
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

function formatReceivedAgo(receivedAt: string, now: Date): string {
	const diffMs = now.getTime() - new Date(receivedAt).getTime();
	const diffMinutes = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMinutes < 1) return "just now";
	if (diffMinutes < 60) return `${diffMinutes}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 30) return `${diffDays}d ago`;
	return new Date(receivedAt).toLocaleDateString("en-AU", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

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
			receivedAgo: formatReceivedAgo(entry.receivedAt, options.now),
			status: entry.status,
			statusLabel: STATUS_LABEL[entry.status],
			needsBadge: entry.status !== "received",
		})),
	};
}
