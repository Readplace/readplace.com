import { validateSaveableUrl } from "@packages/domain/article";
import type { InboxEmailLinkEntry } from "@packages/domain/inbox";
import { stripUtmParams } from "../../../domain/inbox/strip-utm-params";
import { buildInboxLinkFeedbackUrl } from "./inbox-link-feedback-url";
import { buildInboxLinkPollUrl } from "./inbox-link-poll-url";
import { buildInboxLinkSaveUrl } from "./inbox-link-save-url";

export interface InboxCardAction {
	key: string;
	label: string;
	ariaLabel: string;
	/** Stable across a poll swap so htmx can restore focus to this button after it
	 * replaces the card the reader was keyboarding through. */
	buttonId: string;
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
	/** Stable across a poll swap, so htmx has something to match the replaced card
	 * against when restoring focus. */
	domId: string;
	statusState: CardStatusState;
	/** Empty for `crawled`, where the title the crawl produced is the signal. */
	statusLabel: string;
	/** `sent` once the link has been submitted to the queue, otherwise `none`.
	 * Renders the durable "Sent to your queue" marker so a saved card stays visibly
	 * distinct from an unsaved one after the toast fades, a reload, or a poll swap. */
	savedState: CardSavedState;
	/** Empty for `none`; the marker copy for `sent`. */
	savedLabel: string;
	actions: InboxCardAction[];
}

/** `none` still renders, hidden by its modifier, so a test asserts which state a
 * card is in rather than that an element is absent. */
type CardStatusState = "working" | "stalled" | "failed" | "none";

const CARD_STATUS_LABELS: Record<CardStatusState, string> = {
	working: "Fetching preview…",
	stalled: "Preview didn’t arrive",
	failed: "No preview available",
	none: "",
};

/** Mirrors {@link CardStatusState}: `none` still renders, hidden by its modifier,
 * so a test asserts the state rather than an element's absence. */
type CardSavedState = "sent" | "none";

// Past tense, and "Sent" not "In": the save route only publishes SubmitLinkCommand
// — the queue row lands in a downstream subscriber — so claiming "In your queue"
// would over-promise a row a reader jumping to /queue might not find yet. Kept in
// step with the transient toast ("Adding to your queue…"): present and past tense
// of the same publish.
const CARD_SAVED_LABELS: Record<CardSavedState, string> = {
	sent: "Sent to your queue",
	none: "",
};

/** Derived from the link's own status rather than from whether the card is still
 * polling: a pending link that spent its poll budget stops polling without ever
 * reaching a terminal state, and reads as stalled, not as finished. */
function cardStatusState(input: {
	status: InboxEmailLinkEntry["status"];
	isPolling: boolean;
}): CardStatusState {
	if (input.status === "failed") return "failed";
	if (input.status !== "pending") return "none";
	return input.isPolling ? "working" : "stalled";
}

function cardDomId(ordinal: string): string {
	return `inbox-card-${ordinal}`;
}

function buildCardActions(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	displayUrl: string;
	shown: number;
}): InboxCardAction[] {
	const { link, emailId, displayUrl, shown } = input;
	const buttonId = (key: string) => `${cardDomId(link.ordinal)}-${key}`;
	// Posted back so the redirect can rebuild the same page of cards. Without it
	// a save from an expanded list returns a first page that no longer holds the
	// card just acted on, which reads as the page discarding the reader's place.
	const shownParam = { shown: String(shown) };
	const actions: InboxCardAction[] = [];
	// Crawl state does not gate saving: the queue save runs its own crawl, so a
	// link whose preview is still pending or failed is still worth saving. An
	// already-submitted link drops Save entirely: re-submitting is harmless as
	// dedupe but resurrects a finished article (markUnreadIfRead), and a live Save
	// next to "Sent to your queue" reads as a contradiction.
	if (link.submittedAt === undefined && validateSaveableUrl(link.url).status === "SUCCESS") {
		actions.push({
			key: "save",
			label: "Save to queue",
			ariaLabel: `Save to queue: ${displayUrl}`,
			buttonId: buttonId("save"),
			href: buildInboxLinkSaveUrl({ emailId, ordinal: link.ordinal }),
			method: "POST",
			hiddenParams: shownParam,
		});
	}
	actions.push({
		key: "feedback-exclude",
		label: "Not an article? (report)",
		ariaLabel: `Not an article? (report) ${displayUrl}`,
		buttonId: buttonId("feedback-exclude"),
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
	// A pending link is often an opaque ESP wrapper whose destination lives in a
	// path token and which may sign its own query, so it is shown byte-exact;
	// once the crawl is done the URL is a real destination and safe to clean.
	const destination = link.resolvedUrl ?? link.url;
	const url = reachedTerminal ? stripUtmParams(destination) : destination;
	const statusState = cardStatusState({
		status: link.status,
		isPolling: cardPollUrl !== undefined,
	});
	const savedState: CardSavedState = link.submittedAt !== undefined ? "sent" : "none";
	return {
		ordinal: link.ordinal,
		url,
		title,
		hasTitle: link.status === "crawled" && title !== "",
		cardPollUrl,
		domId: cardDomId(link.ordinal),
		statusState,
		statusLabel: CARD_STATUS_LABELS[statusState],
		savedState,
		savedLabel: CARD_SAVED_LABELS[savedState],
		actions: buildCardActions({ link, emailId, displayUrl: url, shown }),
	};
}
