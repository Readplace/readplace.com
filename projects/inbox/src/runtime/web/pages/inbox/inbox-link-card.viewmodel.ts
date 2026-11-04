import { withInternalTracking } from "@packages/web-shell";
import { type LocalTime, toAbsoluteDate } from "@packages/web-shell/local-time.format";
import { validateSaveableInboxLink } from "../../../domain/inbox/saveable-inbox-link";
import type { InboxEmailLinkEntry, InboxLinkSaveState } from "@packages/domain/inbox";
import {
	type ReadlistFitReaderVerdict,
	type ReadlistSlug,
	readlistFitChoiceLabel,
} from "@packages/domain/readlist";
import { stripUtmParams } from "../../../domain/inbox/strip-utm-params";
import { type InboxEmailFilter, writeInboxEmailFilter } from "./inbox-email-filter";
import { buildInboxLinkFeedbackUrl } from "./inbox-link-feedback-url";
import { buildInboxLinkFitUrl } from "./inbox-link-fit-url";
import { buildInboxLinkPollUrl } from "./inbox-link-poll-url";
import { buildInboxLinkSaveUrl } from "./inbox-link-save-url";
import type { InboxLinkCardReadlistFit } from "./inbox-readlist-fit";
import { type SaveButtonState, toInboxSaveButtonViewModel } from "./inbox-save-button.viewmodel";

const INBOX_LINK_CARD_SOURCE = "inbox-link-card";

type InboxCardActionKey = "save" | "feedback-exclude" | "fit-keep" | "fit-drop";

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
	iconName?: string;
}

export interface InboxCardSaveAction extends InboxCardAction {
	saveState: SaveButtonState;
	inPlaceTargetId: string;
}

export interface InboxCardMenuAction extends InboxCardAction {
	iconName: string;
}

export interface InboxCardFitAction extends InboxCardAction {
	readlist: ReadlistSlug;
	inPlaceTargetId: string;
}

export interface InboxCardFitMarker {
	readlist: ReadlistSlug;
	text: string;
	accent: boolean;
	reason: string | undefined;
	chosenOn: LocalTime | undefined;
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
	actions: InboxCardSaveAction[];
	menuActions: InboxCardMenuAction[];
	fitMarkers: InboxCardFitMarker[];
	fitActions: InboxCardFitAction[];
}

/** `none` still renders, hidden by its modifier, so a test asserts which state a
 * card is in rather than that an element is absent. */
export type CardStatusState = "working" | "stalled" | "failed" | "none";

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
	filter: InboxEmailFilter | undefined;
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
		filter: input.filter,
	});
}

type ReadlistFitView = {
	marker: Omit<InboxCardFitMarker, "readlist"> | undefined;
	offer: ReadlistFitReaderVerdict | undefined;
};

const NO_READLIST_FIT_VIEW: ReadlistFitView = { marker: undefined, offer: undefined };

function readlistFitView(input: {
	fit: InboxLinkCardReadlistFit;
	ordinal: InboxEmailLinkEntry["ordinal"];
}): ReadlistFitView {
	const { outcome, override, label } = input.fit;
	if (outcome.decision === "no-purpose" || outcome.decision === "readlist-missing") {
		return NO_READLIST_FIT_VIEW;
	}
	if (override !== undefined) {
		return {
			marker: {
				text: readlistFitChoiceLabel({ readerVerdict: override.readerVerdict, label }),
				accent: override.readerVerdict === "keep",
				reason: undefined,
				chosenOn: toAbsoluteDate({ iso: override.createdAt.toISOString() }),
			},
			offer: override.readerVerdict === "keep" ? "drop" : "keep",
		};
	}
	if (outcome.decision === "failed") return { marker: undefined, offer: "keep" };
	const entry = outcome.fit.find((candidate) => candidate.ordinal === input.ordinal);
	if (entry === undefined) return NO_READLIST_FIT_VIEW;
	if (entry.verdict === "keep") {
		return {
			marker: { text: `Fits ${label}`, accent: true, reason: entry.reason, chosenOn: undefined },
			offer: "drop",
		};
	}
	return {
		marker: {
			text: `Not for ${label}`,
			accent: false,
			reason: entry.verdict === "drop" ? entry.reason : undefined,
			chosenOn: undefined,
		},
		offer: "keep",
	};
}

function fitActionText(input: { verdict: ReadlistFitReaderVerdict; label: string }): string {
	return input.verdict === "keep" ? `Keep in ${input.label}` : `Doesn't fit ${input.label}`;
}

function buildCardActions(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	displayUrl: string;
	shown: number;
	filter: InboxEmailFilter | undefined;
	fit: readonly InboxLinkCardReadlistFit[];
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	whenNotSaved: "saving" | "unsaved";
}): Pick<InboxLinkCardViewModel, "actions" | "menuActions" | "fitMarkers" | "fitActions"> {
	const { link, emailId, displayUrl, shown, filter, linkSaveStates, whenNotSaved } = input;
	const buttonId = (key: string) => `${cardDomId(link.ordinal)}-${key}`;
	// Posted back so the redirect can rebuild the same page of cards. Without it
	// a save from an expanded list returns a first page that no longer holds the
	// card just acted on, which reads as the page discarding the reader's place.
	const pageParams = new URLSearchParams({ shown: String(shown) });
	writeInboxEmailFilter({ search: pageParams, filter });
	const shownParam = Object.fromEntries(pageParams);
	const actions: InboxCardSaveAction[] = [];
	// Crawl state does not gate saving: the queue save runs its own crawl, so a
	// link whose preview is still pending or failed is still worth saving.
	const saveable = validateSaveableInboxLink(link.url).status === "SUCCESS";
	if (saveable) {
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
	const fitMarkers: InboxCardFitMarker[] = [];
	const fitActions: InboxCardFitAction[] = [];
	for (const fit of input.fit) {
		const view = readlistFitView({ fit, ordinal: link.ordinal });
		if (view.marker !== undefined) fitMarkers.push({ readlist: fit.readlist, ...view.marker });
		if (view.offer === undefined || !saveable) continue;
		const key = view.offer === "keep" ? "fit-keep" : "fit-drop";
		const text = fitActionText({ verdict: view.offer, label: fit.label });
		fitActions.push({
			key,
			readlist: fit.readlist,
			label: text,
			ariaLabel: `${text}: ${displayUrl}`,
			buttonId: buttonId(`${key}-${fit.readlist}`),
			href: withInternalTracking(
				buildInboxLinkFitUrl({
					emailId,
					ordinal: link.ordinal,
					pageState: { tab: "articles", shown, filter },
				}),
				{ source: INBOX_LINK_CARD_SOURCE, content: key },
			),
			method: "POST",
			hiddenParams: { readlist: fit.readlist, verdict: view.offer },
			inPlaceTargetId: cardDomId(link.ordinal),
		});
	}
	return {
		actions,
		fitMarkers,
		fitActions,
		menuActions: [
			{
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
				iconName: "x",
			},
		],
	};
}

export function toInboxLinkCardViewModel(input: {
	link: InboxEmailLinkEntry;
	emailId: string;
	pollCount: number;
	maxPolls: number;
	/** How many cards the panel this card sits in is showing. Carried through the
	 * card's own poll URL so a re-rendered pending card keeps posting it back. */
	shown: number;
	filter: InboxEmailFilter | undefined;
	fit: readonly InboxLinkCardReadlistFit[];
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	savePollContext: LinkCardSavePollContext;
}): InboxLinkCardViewModel {
	const { link, emailId, pollCount, maxPolls, shown, filter, linkSaveStates } = input;
	const reachedTerminal = link.status !== "pending";
	const savePollUrl = saveSettlePollUrl({
		link,
		emailId,
		shown,
		filter,
		saveState: linkSaveStates.get(link.url),
		pollContext: input.savePollContext,
	});
	const cardPollUrl =
		savePollUrl ??
		(reachedTerminal || pollCount > maxPolls
			? undefined
			: buildInboxLinkPollUrl({ emailId, ordinal: link.ordinal, pollCount, shown, filter }));
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
		...buildCardActions({
			link,
			emailId,
			displayUrl: url,
			shown,
			filter,
			fit: input.fit,
			linkSaveStates,
			whenNotSaved: savePollUrl === undefined ? "unsaved" : "saving",
		}),
	};
}
