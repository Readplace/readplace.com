import { validateSaveableUrl } from "@packages/domain/article";
import type { InboxEmailLinkEntry } from "@packages/domain/inbox";
import { buildInboxLinkFeedbackUrl } from "./inbox-link-feedback-url";
import { buildInboxLinkPollUrl } from "./inbox-link-poll-url";
import { buildInboxLinkSaveUrl } from "./inbox-link-save-url";

export interface InboxCardAction {
	key: string;
	label: string;
	ariaLabel: string;
	href: string;
	method: "POST";
	hiddenParams?: Record<string, string>;
}

export interface InboxLinkCardViewModel {
	ordinal: string;
	url: string;
	title: string;
	hasTitle: boolean;
	/** Present only while the card should keep polling. Omitted once the link
	 * reaches a terminal state (`crawled`/`failed`) or the poll budget is spent,
	 * which is what stops the htmx `every 3s` trigger. */
	cardPollUrl: string | undefined;
	actions: InboxCardAction[];
}

function buildCardActions(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	displayUrl: string;
}): InboxCardAction[] {
	const { link, emailId, displayUrl } = input;
	const actions: InboxCardAction[] = [];
	// Crawl state does not gate saving: the queue save runs its own crawl, so a
	// link whose preview is still pending or failed is still worth saving.
	if (validateSaveableUrl(link.url).status === "SUCCESS") {
		actions.push({
			key: "save",
			label: "Save to queue",
			ariaLabel: `Save to queue: ${displayUrl}`,
			href: buildInboxLinkSaveUrl({ emailId, ordinal: link.ordinal }),
			method: "POST",
		});
	}
	actions.push({
		key: "feedback-exclude",
		label: "Not an article?",
		ariaLabel: `Not an article? ${displayUrl}`,
		href: buildInboxLinkFeedbackUrl({ emailId, ordinal: link.ordinal }),
		method: "POST",
		hiddenParams: { verdict: "should-be-excluded" },
	});
	return actions;
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
	const url = link.resolvedUrl ?? link.url;
	return {
		ordinal: link.ordinal,
		url,
		title,
		hasTitle: link.status === "crawled" && title !== "",
		cardPollUrl,
		actions: buildCardActions({ link, emailId, displayUrl: url }),
	};
}
