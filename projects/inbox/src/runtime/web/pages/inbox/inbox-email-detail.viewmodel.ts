import { INBOX_PATH, isExcludedLink } from "@packages/domain/inbox";
import { type LocalTime, toAbsoluteDateTime, withInternalTracking } from "@packages/web-shell";
import type {
	InboxEmailEntry,
	InboxEmailLinkCounts,
	InboxEmailLinkDrop,
	InboxEmailLinkEntry,
	InboxEmailLinksMeta,
	InboxLinkSaveState,
	InboxReadlistDecision,
} from "@packages/domain/inbox";
import { ARTICLES_PAGE_SIZE, buildInboxArticlesMoreUrl } from "./inbox-articles-more.url";
import { buildInboxArticlesPollUrl } from "./inbox-articles-poll-url";
import {
	type ExcludedLinkViewModel,
	toInboxExcludedLinkViewModel,
} from "./inbox-excluded-link.viewmodel";
import { buildInboxExcludedPollUrl } from "./inbox-excluded-poll-url";
import { type MailTabKey, buildInboxEmailDetailUrl } from "./inbox-email-detail.url";
import { type InboxLinkCardViewModel, toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import { type InboxPanelStatus, panelStatusFor } from "./inbox-panel-status";
import { type MailTab, buildMailTabs } from "./mail-tabs";

/** Initial poll count for a card on first page render: the first htmx tick then
 * requests `?poll=1` and the poll route increments from there. */
const INITIAL_POLL_COUNT = 1;

export interface AlertCopy {
	title: string;
	body: string;
}

export interface PanelAlert extends AlertCopy {
	key: "failed" | "stale" | "decision-failed" | "decision-stale";
}

export interface PanelNotice {
	key: "extracting" | "deciding" | "truncated" | "decided" | "skipped-note" | "dropped-note";
	text: string;
	iconName: "loader" | undefined;
}

export interface PanelEmptyState {
	title: string;
	body: string | undefined;
}

export interface PanelListing {
	countLabel: string;
	emptyStates: PanelEmptyState[];
}

const NO_LINKS_EMPTY_STATE: PanelEmptyState = {
	title: "No links found in this email",
	body: undefined,
};
const ALL_SKIPPED_EMPTY_STATE: PanelEmptyState = {
	title: "Every link in this email was skipped",
	body: "See the Skipped tab.",
};
const NOTHING_SKIPPED_EMPTY_STATE: PanelEmptyState = {
	title: "Nothing was skipped in this email",
	body: undefined,
};

// Both panels report the same extractor run, so they say these in one voice from
// one place — two copies would drift, and each is a claim about the run rather
// than about the panel showing it.
const EXTRACTING_NOTICE: PanelNotice = {
	key: "extracting",
	text: "Looking for links…",
	iconName: "loader",
};
const STALE_ALERT: AlertCopy = {
	title: "Couldn't scan this email for links",
	body: "The original message is still on the View tab.",
};

const SKIPPED_NOTE_NOTICE: PanelNotice = {
	key: "skipped-note",
	text: "These looked like unsubscribe, ad, or menu links — not articles — so they weren't fetched or added.",
	iconName: undefined,
};

const DECIDING_NOTICE: PanelNotice = {
	key: "deciding",
	text: "Choosing which links fit this inbox's readlist…",
	iconName: "loader",
};
const DECISION_FAILED_ALERT: PanelAlert = {
	key: "decision-failed",
	title: "Couldn't choose which links to save",
	body: "Nothing from this email was saved. Use Save on any link you want to keep.",
};
const DECISION_STALE_ALERT: PanelAlert = {
	key: "decision-stale",
	title: "Still choosing which links to save",
	body: "This is taking longer than usual. Reload later to see what was saved.",
};

function decidedNoticeText(input: {
	readlistLabel: string;
	anyDropped: boolean;
	anyKept: boolean;
}): string {
	if (!input.anyDropped) return `Saved to ${input.readlistLabel}.`;
	if (!input.anyKept) return `Nothing in this email fit ${input.readlistLabel}, so nothing was saved.`;
	return `Saved to ${input.readlistLabel}. Links that didn't fit are on the Skipped tab.`;
}

function droppedNote(drop: InboxEmailLinkDrop): PanelNotice {
	return {
		key: "dropped-note",
		text: `Links that didn't fit ${drop.readlistLabel} weren't saved. Save any you still want.`,
		iconName: undefined,
	};
}

function decisionTerminalRegions(input: {
	decision: InboxReadlistDecision | undefined;
	withinPollBudget: boolean;
	anyDropped: boolean;
	anyKept: boolean;
}): { alerts: PanelAlert[]; notices: PanelNotice[] } {
	const { decision } = input;
	if (decision === undefined) return { alerts: [], notices: [] };
	if (decision.state === "failed") return { alerts: [DECISION_FAILED_ALERT], notices: [] };
	if (decision.state === "deciding") {
		return { alerts: input.withinPollBudget ? [] : [DECISION_STALE_ALERT], notices: [] };
	}
	return {
		alerts: [],
		notices: [
			{
				key: "decided",
				text: decidedNoticeText({
					readlistLabel: decision.readlistLabel,
					anyDropped: input.anyDropped,
					anyKept: input.anyKept,
				}),
				iconName: undefined,
			},
		],
	};
}

const UNAVAILABLE_ALERT: AlertCopy = {
	title: "Couldn't display this email",
	body: "The original email is preserved.",
};

// Present tense on purpose: the save route only publishes SubmitLinkCommand, and
// the queue write happens in a downstream subscriber. Claiming "Saved" would
// promise a row a reader jumping straight to /queue might not find yet.
const SAVED_TOAST_MESSAGE = "Adding to your queue…";
const FEEDBACK_TOAST_MESSAGE = "Thanks — your report was logged.";

export interface ArticleShowMore {
	detailHref: string;
	moreUrl: string;
	count: number;
}

export interface ArticleCardsPage {
	cards: InboxLinkCardViewModel[];
	showMore: ArticleShowMore | undefined;
}

/** The extraction-driven state every tab panel shares: both panels describe the
 * same one extractor run, so neither may claim a terminal answer before it has
 * written its meta barrier. */
interface ExtractionPanelViewModel {
	isEmpty: boolean;
	alerts: PanelAlert[];
	notices: PanelNotice[];
	listing: PanelListing | undefined;
	/** True while extraction has not yet written its meta barrier (a just-received
	 * email) and the poll budget is unspent: the panel shows a polling "Looking for
	 * links…" state instead of a terminal answer, so a non-terminal state is never
	 * shown as terminal. Goes false once `isStalePending` takes over. */
	isExtracting: boolean;
	isDeciding: boolean;
	/** True when the poll budget is spent but extraction never wrote its meta
	 * barrier — a pre-feature email that predates the meta row, or an extractor
	 * that died without reaching its dead-letter queue. The panel gives up on
	 * "Looking for links…" and shows a terminal notice instead of polling forever. */
	isStalePending: boolean;
	/** True when the dead-letter handler recorded that extraction gave up. Terminal
	 * like any other barrier — the panel stops polling immediately rather than
	 * burning the whole budget first — and carries the same wording as
	 * `isStalePending`, since the reader's situation is identical. */
	isExtractionFailed: boolean;
	/** Drives the page-level htmx poll that swaps the finished panel in on
	 * completion. Each panel polls its own fragment route: a shared URL would swap
	 * the other panel's markup in over this one. */
	panelPollUrl: string | undefined;
}

export interface ArticlesPanelViewModel extends ExtractionPanelViewModel {
	/** Only the cards shown so far — the panel reveals them a page at a time, so
	 * this is a slice of the email's kept links, not all of them. */
	cards: InboxLinkCardViewModel[];
	showMore: ArticleShowMore | undefined;
}

export interface ExcludedPanelViewModel extends ExtractionPanelViewModel {
	links: ExcludedLinkViewModel[];
}

export interface InboxEmailDetailViewModel {
	subject: string;
	sender: string;
	received: LocalTime;
	backHref: string;
	activeTab: MailTabKey;
	tabs: MailTab[];
	/** One-shot confirmation for a write that just completed, rendered as the
	 * shared toast — a fixed, self-dismissing overlay, so it is seen wherever the
	 * reader was scrolled to. Undefined on a plain page view. */
	statusToastMessage: string | undefined;
	/** True once extraction has finished and its counts are trustworthy. The poll
	 * route emits its out-of-band tab strip only then: while this is false the strip
	 * it would send is byte-identical to the one on screen, and re-sending it every
	 * tick would tear down and rebuild the tab links — taking keyboard focus with
	 * them every few seconds. An extraction that gave up has no counts to report, so
	 * it never ships a strip either. */
	extractionReported: boolean;
	/** A `received` email with its body present renders in the iframe; every
	 * other case (rejected, unparsed, or a body not yet readable from S3) shows
	 * the graceful unavailable panel instead of an empty frame. */
	canRenderBody: boolean;
	bodyHtml: string;
	/** The CDN origin rehosted email images are served from — pinned into the
	 * iframe's per-document CSP so only our copies (never a sender host) load. */
	imagesCdnBaseUrl: string;
	unavailableAlert: AlertCopy;
	articles: ArticlesPanelViewModel;
	excluded: ExcludedPanelViewModel;
}

function buildArticleCardsPage(input: {
	allCards: InboxEmailLinkEntry[];
	emailId: string;
	from: number;
	to: number;
	maxPolls: number;
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
}): ArticleCardsPage {
	const cards = input.allCards.slice(input.from, input.to).map((link) =>
		toInboxLinkCardViewModel({
			link,
			emailId: input.emailId,
			pollCount: INITIAL_POLL_COUNT,
			maxPolls: input.maxPolls,
			shown: input.to,
			linkSaveStates: input.linkSaveStates,
			savePollContext: { mode: "static" },
		}),
	);
	const shown = Math.min(input.to, input.allCards.length);
	const remaining = input.allCards.length - shown;
	if (remaining <= 0) return { cards, showMore: undefined };
	const next = shown + ARTICLES_PAGE_SIZE;
	return {
		cards,
		showMore: {
			detailHref: withInternalTracking(
				buildInboxEmailDetailUrl({
					emailId: input.emailId,
					tab: "articles",
					shown: next,
				}),
				{ source: "inbox-email-detail", content: "show-more-articles" },
			),
			moreUrl: withInternalTracking(
				buildInboxArticlesMoreUrl({ emailId: input.emailId, shown: next }),
				{ source: "inbox-email-detail", content: "show-more-articles" },
			),
			count: Math.min(ARTICLES_PAGE_SIZE, remaining),
		},
	};
}

function buildPanelRegions(input: {
	status: InboxPanelStatus;
	terminalAlerts: PanelAlert[];
	terminalNotices: PanelNotice[];
	countLabel: string;
	emptyStates: PanelEmptyState[];
}): Pick<ExtractionPanelViewModel, "alerts" | "notices" | "listing"> {
	if (input.status === "extracting") {
		return { alerts: [], notices: [EXTRACTING_NOTICE], listing: undefined };
	}
	if (input.status === "deciding") {
		return { alerts: [], notices: [DECIDING_NOTICE], listing: undefined };
	}
	if (input.status !== "terminal") {
		return { alerts: [{ key: input.status, ...STALE_ALERT }], notices: [], listing: undefined };
	}
	return {
		alerts: input.terminalAlerts,
		notices: input.terminalNotices,
		listing: { countLabel: input.countLabel, emptyStates: input.emptyStates },
	};
}

export function toInboxArticlesMoreViewModel(input: {
	links: InboxEmailLinkEntry[];
	emailId: string;
	shown: number;
	maxPolls: number;
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
}): ArticleCardsPage {
	return buildArticleCardsPage({
		allCards: input.links.filter((link) => !isExcludedLink(link)),
		emailId: input.emailId,
		from: input.shown - ARTICLES_PAGE_SIZE,
		to: input.shown,
		maxPolls: input.maxPolls,
		linkSaveStates: input.linkSaveStates,
	});
}

/** Where the tab counts come from. Tabs that fetch the link rows derive them
 * from the same single query that carries the meta barrier, so a count is never
 * shown that the rendered panel cannot back; the View tab fetches no rows and
 * reads the tally the extraction barrier stamped onto the email row instead. */
export type InboxEmailLinkData =
	| { source: "rows"; links: InboxEmailLinkEntry[]; meta: InboxEmailLinksMeta | undefined }
	| { source: "entry" };

export function toInboxEmailDetailViewModel(input: {
	entry: InboxEmailEntry;
	activeTab: MailTabKey;
	bodyHtml: string | undefined;
	imagesCdnBaseUrl: string;
	linkData: InboxEmailLinkData;
	/** Empty for the View tab, which fetches no link rows to look up. */
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	maxPolls: number;
	shown?: number;
	/** The page-level poll tick: the full render starts at the initial count; the
	 * panel fragment routes pass the incremented count back. */
	panelPollCount?: number;
	feedbackConfirmed?: boolean;
	savedConfirmed?: boolean;
}): InboxEmailDetailViewModel {
	const emailId = input.entry.receivedAtMessageId;
	const canRenderBody = input.entry.status === "received" && input.bodyHtml !== undefined;
	const links = input.linkData.source === "rows" ? input.linkData.links : [];
	const linksMeta = input.linkData.source === "rows" ? input.linkData.meta : undefined;
	const allCards = links.filter((link) => !isExcludedLink(link));
	const totalCards = allCards.length;
	const cardsPage = buildArticleCardsPage({
		allCards,
		emailId,
		from: 0,
		to: input.shown ?? ARTICLES_PAGE_SIZE,
		maxPolls: input.maxPolls,
		linkSaveStates: input.linkSaveStates,
	});
	const excludedEntries = links.filter(isExcludedLink);
	const excludedLinks = excludedEntries.map((link) =>
		toInboxExcludedLinkViewModel({
			link,
			emailId,
			linkSaveStates: input.linkSaveStates,
			pollContext: { mode: "static" },
		}),
	);
	const firstDrop = excludedEntries.find((link) => link.droppedFor !== undefined)?.droppedFor;
	const truncated = linksMeta?.truncated === true;
	// No meta row yet means the async extractor has not finished for this received
	// email — keep polling rather than asserting it has zero links. Non-received
	// emails never run extraction, so they are terminal immediately.
	const awaitingMeta = input.entry.status === "received" && linksMeta === undefined;
	// A barrier written by the dead-letter handler reports a scan that never
	// completed, so its zero rows are not an answer about the email's contents.
	const isExtractionFailed = linksMeta?.extractionFailed === true;
	const decision = linksMeta?.readlistDecision;
	const panelPollCount = input.panelPollCount ?? INITIAL_POLL_COUNT;
	const withinPollBudget = panelPollCount <= input.maxPolls;
	const isDeciding = decision?.state === "deciding" && withinPollBudget;
	let linkCounts: InboxEmailLinkCounts | undefined;
	if (input.linkData.source === "rows") {
		linkCounts =
			awaitingMeta || isExtractionFailed || isDeciding
				? undefined
				: { kept: allCards.length, skipped: excludedLinks.length, truncated };
	} else if (input.entry.status === "received") {
		linkCounts = input.entry.linkCounts;
	} else {
		linkCounts = { kept: 0, skipped: 0, truncated: false };
	}
	// Once the budget is spent without a meta barrier the extractor is never coming
	// back (permanent extract-DLQ failure, or a pre-feature email with no meta row),
	// so we give up on the spinner and show a terminal notice instead of polling on.
	const isStalePending = awaitingMeta && !withinPollBudget;
	const isExtracting = awaitingMeta && withinPollBudget;
	// Save wins a tie: the two flags only ever arrive together on a hand-typed
	// URL, and a save is the more consequential of the two to confirm.
	const statusToastMessage =
		input.savedConfirmed === true
			? SAVED_TOAST_MESSAGE
			: input.feedbackConfirmed === true
				? FEEDBACK_TOAST_MESSAGE
				: undefined;
	const panelStatus = panelStatusFor({
		isExtracting,
		isDeciding,
		isExtractionFailed,
		isStalePending,
	});
	const isPolling = isExtracting || isDeciding;
	const truncatedNotices: PanelNotice[] = truncated
		? [
				{
					key: "truncated",
					text: `Showing the first ${links.length} links found in this email.`,
					iconName: undefined,
				},
			]
		: [];
	const decisionRegions = decisionTerminalRegions({
		decision,
		withinPollBudget,
		anyDropped: firstDrop !== undefined,
		anyKept: totalCards > 0,
	});
	const skippedNotices = excludedEntries.some((link) => link.status === "skipped")
		? [SKIPPED_NOTE_NOTICE]
		: [];
	const droppedNotices = firstDrop === undefined ? [] : [droppedNote(firstDrop)];
	const shared = {
		isExtracting,
		isDeciding,
		isStalePending,
		isExtractionFailed,
	};
	return {
		subject: input.entry.subject === "" ? "(no subject)" : input.entry.subject,
		sender: input.entry.senderEmail === "" ? "(unknown sender)" : input.entry.senderEmail,
		received: toAbsoluteDateTime({ iso: input.entry.receivedAt }),
		backHref: withInternalTracking(INBOX_PATH, {
			source: "inbox-email-detail",
			content: "back-to-inbox",
		}),
		activeTab: input.activeTab,
		statusToastMessage,
		// Counts come from every kept/skipped link, not the page of cards on
		// screen, and are withheld until extraction writes its barrier — a tab
		// claiming "(0)" mid-extraction would read as "none found" rather than
		// "still looking".
		tabs: buildMailTabs({
			emailId,
			active: input.activeTab,
			counts:
				linkCounts === undefined
					? {}
					: { articles: linkCounts.kept, excluded: linkCounts.skipped },
		}),
		extractionReported: !awaitingMeta && !isExtractionFailed && !isDeciding,
		canRenderBody,
		bodyHtml: input.bodyHtml ?? "",
		imagesCdnBaseUrl: input.imagesCdnBaseUrl,
		unavailableAlert: UNAVAILABLE_ALERT,
		articles: {
			...shared,
			cards: cardsPage.cards,
			showMore: cardsPage.showMore,
			// Every kept link, not the page of them on screen: a first page that is
			// merely unfilled is not an empty panel.
			isEmpty: totalCards === 0,
			...buildPanelRegions({
				status: panelStatus,
				terminalAlerts: decisionRegions.alerts,
				terminalNotices: [...truncatedNotices, ...decisionRegions.notices],
				countLabel: `${totalCards} Extracted ${totalCards === 1 ? "Article" : "Articles"}`,
				emptyStates:
					totalCards > 0
						? []
						: [excludedLinks.length === 0 ? NO_LINKS_EMPTY_STATE : ALL_SKIPPED_EMPTY_STATE],
			}),
			panelPollUrl: isPolling
				? buildInboxArticlesPollUrl({ emailId, pollCount: panelPollCount })
				: undefined,
		},
		excluded: {
			...shared,
			links: excludedLinks,
			isEmpty: excludedLinks.length === 0,
			...buildPanelRegions({
				status: panelStatus,
				terminalAlerts: [],
				terminalNotices: [...truncatedNotices, ...skippedNotices, ...droppedNotices],
				countLabel: `${excludedLinks.length} Skipped`,
				emptyStates:
					excludedLinks.length > 0
						? []
						: [totalCards === 0 ? NO_LINKS_EMPTY_STATE : NOTHING_SKIPPED_EMPTY_STATE],
			}),
			panelPollUrl: isPolling
				? buildInboxExcludedPollUrl({ emailId, pollCount: panelPollCount })
				: undefined,
		},
	};
}
