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
	shown: number;
}): InboxCardAction[] {
	const { link, emailId, displayUrl, shown } = input;
	// Posted back so the redirect can rebuild the same page of cards. Without it
	// a save from an expanded list returns a first page that no longer holds the
	// card just acted on, which reads as the page discarding the reader's place.
	const shownParam = { shown: String(shown) };
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
			hiddenParams: shownParam,
		});
	}
	actions.push({
		key: "feedback-exclude",
		label: "Not an article? (report)",
		ariaLabel: `Not an article? (report) ${displayUrl}`,
		href: buildInboxLinkFeedbackUrl({ emailId, ordinal: link.ordinal }),
		method: "POST",
		hiddenParams: { ...shownParam, verdict: "should-be-excluded" },
	});
	return actions;
}

export function toInboxLinkCardViewModel(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	pollCount: number;
	maxPolls: number;
	/** How many cards the panel this card sits in is showing. Carried through the
	 * card's own poll URL so a re-rendered pending card keeps posting it back. */
	shown: number;
}): InboxLinkCardViewModel {
	const { link, emailId, pollCount, maxPolls, shown } = input;
	const reachedTerminal = link.status !== "pending";
	const cardPollUrl =
		reachedTerminal || pollCount > maxPolls
			? undefined
			: buildInboxLinkPollUrl({ emailId, ordinal: link.ordinal, pollCount, shown });
	const title = link.title ?? "";
	const url = link.resolvedUrl ?? link.url;
	return {
		ordinal: link.ordinal,
		url,
		title,
		hasTitle: link.status === "crawled" && title !== "",
		cardPollUrl,
		actions: buildCardActions({ link, emailId, displayUrl: url, shown }),
	};
}
