import { withInternalTracking } from "@packages/web-shell";
import { validateSaveableUrl } from "@packages/domain/article";
import type { InboxEmailLinkEntry, InboxLinkSaveState } from "@packages/domain/inbox";
import { stripUtmParams } from "../../../domain/inbox/strip-utm-params";
import { buildInboxLinkFeedbackUrl } from "./inbox-link-feedback-url";
import { buildInboxLinkPollUrl } from "./inbox-link-poll-url";
import { buildInboxLinkSaveUrl } from "./inbox-link-save-url";
import { type SaveButtonState, toInboxSaveButtonViewModel } from "./inbox-save-button.viewmodel";

const INBOX_LINK_CARD_SOURCE = "inbox-link-card";

type InboxCardActionKey = "save" | "feedback-exclude";

export interface InboxCardAction {
	key: InboxCardActionKey;
	label: string;
	ariaLabel: string;
	/** Stable across a poll swap so htmx can restore focus to this button after it
	 * replaces the card the reader was keyboarding through. */
	buttonId: string;
	href: string;
	method: "POST";
	hiddenParams?: Record<string, string>;
	/** Set on the save action only. */
	saveState?: SaveButtonState;
	iconName?: string;
	inPlaceTargetId?: string;
}

export interface InboxLinkCardViewModel {
	ordinal: string;
	url: string;
	title: string;
	hasTitle: boolean;
	cardPollUrl: string | undefined;
	/** Stable across a poll swap, so htmx has something to match the replaced card
	 * against when restoring focus. */
	domId: string;
	statusState: CardStatusState;
	/** Empty for `crawled`, where the title the crawl produced is the signal. */
	statusLabel: string;
	actions: InboxCardAction[];
}

/** `none` still renders, hidden by its modifier, so a test asserts which state a
 * card is in rather than that an element is absent. */
type CardStatusState = "working" | "stalled" | "failed" | "none";

const CARD_STATUS_LABELS: Record<CardStatusState, string> = {
	working: "Fetching preview…",
	stalled: "Preview didn't arrive",
	failed: "No preview available",
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

export type LinkCardSavePollContext =
	| { mode: "static" }
	| { mode: "save-poll"; pollCount: number; maxPolls: number };

function saveSettlePollUrl(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	shown: number;
	saveState: InboxLinkSaveState | undefined;
	pollContext: LinkCardSavePollContext;
}): string | undefined {
	const { pollContext } = input;
	if (pollContext.mode === "static") return undefined;
	if (input.saveState !== undefined) return undefined;
	if (pollContext.pollCount > pollContext.maxPolls) return undefined;
	return buildInboxLinkPollUrl({
		emailId: input.emailId,
		ordinal: input.link.ordinal,
		pollCount: pollContext.pollCount,
		shown: input.shown,
		awaitSave: true,
	});
}

function buildCardActions(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	displayUrl: string;
	shown: number;
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	whenNotSaved: "saving" | "unsaved";
}): InboxCardAction[] {
	const { link, emailId, displayUrl, shown, linkSaveStates, whenNotSaved } = input;
	const buttonId = (key: string) => `${cardDomId(link.ordinal)}-${key}`;
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
			...toInboxSaveButtonViewModel({
				linkSaveStates,
				url: link.url,
				displayUrl,
				whenNotSaved,
			}),
			buttonId: buttonId("save"),
			href: withInternalTracking(buildInboxLinkSaveUrl({ emailId, ordinal: link.ordinal }), {
				source: INBOX_LINK_CARD_SOURCE,
				content: "save-link",
			}),
			method: "POST",
			hiddenParams: shownParam,
			inPlaceTargetId: cardDomId(link.ordinal),
		});
	}
	actions.push({
		key: "feedback-exclude",
		label: "Not an article (report)",
		ariaLabel: `Not an article (report): ${displayUrl}`,
		buttonId: buttonId("feedback-exclude"),
		href: withInternalTracking(buildInboxLinkFeedbackUrl({ emailId, ordinal: link.ordinal }), {
			source: INBOX_LINK_CARD_SOURCE,
			content: "feedback-exclude",
		}),
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
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	savePollContext: LinkCardSavePollContext;
}): InboxLinkCardViewModel {
	const { link, emailId, pollCount, maxPolls, shown, linkSaveStates } = input;
	const reachedTerminal = link.status !== "pending";
	const savePollUrl = saveSettlePollUrl({
		link,
		emailId,
		shown,
		saveState: linkSaveStates.get(link.url),
		pollContext: input.savePollContext,
	});
	const cardPollUrl =
		savePollUrl ??
		(reachedTerminal || pollCount > maxPolls
			? undefined
			: buildInboxLinkPollUrl({ emailId, ordinal: link.ordinal, pollCount, shown }));
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
	return {
		ordinal: link.ordinal,
		url,
		title,
		hasTitle: link.status === "crawled" && title !== "",
		cardPollUrl,
		domId: cardDomId(link.ordinal),
		statusState,
		statusLabel: CARD_STATUS_LABELS[statusState],
		actions: buildCardActions({
			link,
			emailId,
			displayUrl: url,
			shown,
			linkSaveStates,
			whenNotSaved: savePollUrl === undefined ? "unsaved" : "saving",
		}),
	};
}
