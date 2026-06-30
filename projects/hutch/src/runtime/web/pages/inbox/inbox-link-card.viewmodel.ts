import type { EmailLinkStatus, InboxEmailLinkEntry } from "@packages/domain/inbox";
import { buildInboxLinkPollUrl } from "./inbox-link-poll-url";

export interface InboxLinkCardViewModel {
	ordinal: string;
	url: string;
	status: EmailLinkStatus;
	title: string;
	excerpt: string;
	siteName: string;
	imageUrl: string | undefined;
	/** Present only while the card should keep polling. Omitted once the link
	 * reaches a terminal state (`crawled`/`failed`) or the poll budget is spent,
	 * which is what stops the htmx `every 3s` trigger. */
	cardPollUrl: string | undefined;
}

export function toInboxLinkCardViewModel(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	pollCount: number;
	maxPolls: number;
}): InboxLinkCardViewModel {
	const { link, emailId, pollCount, maxPolls } = input;
	const reachedTerminal = link.status !== "pending";
	const cardPollUrl =
		reachedTerminal || pollCount > maxPolls
			? undefined
			: buildInboxLinkPollUrl({ emailId, ordinal: link.ordinal, pollCount });
	return {
		ordinal: link.ordinal,
		url: link.url,
		status: link.status,
		title: link.title ?? "",
		excerpt: link.excerpt ?? "",
		siteName: link.siteName ?? "",
		imageUrl: link.imageUrl,
		cardPollUrl,
	};
}
