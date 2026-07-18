import type { InboxEmailLinkEntry } from "@packages/domain/inbox";
import { buildInboxLinkFeedbackUrl } from "./inbox-link-feedback-url";
import { buildInboxLinkPollUrl } from "./inbox-link-poll-url";

export interface InboxLinkCardViewModel {
	ordinal: string;
	url: string;
	title: string;
	hasTitle: boolean;
	/** Present only while the card should keep polling. Omitted once the link
	 * reaches a terminal state (`crawled`/`failed`) or the poll budget is spent,
	 * which is what stops the htmx `every 3s` trigger. */
	cardPollUrl: string | undefined;
	feedbackAction: string;
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
	const title = link.title ?? "";
	return {
		ordinal: link.ordinal,
		url: link.resolvedUrl ?? link.url,
		title,
		hasTitle: link.status === "crawled" && title !== "",
		cardPollUrl,
		feedbackAction: buildInboxLinkFeedbackUrl({ emailId, ordinal: link.ordinal }),
	};
}
