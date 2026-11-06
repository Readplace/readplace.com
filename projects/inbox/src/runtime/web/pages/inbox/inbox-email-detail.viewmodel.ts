import assert from "node:assert";
import type {
	EmailLinkOrdinal,
	InboxEmailEntry,
	InboxEmailLinkCounts,
	InboxEmailLinkEntry,
	InboxEmailLinksMeta,
	InboxLinkSaveState,
	InboxReadlistOutcome,
} from "@packages/domain/inbox";
import { INBOX_PATH, isExcludedLink } from "@packages/domain/inbox";
import {
	DEFAULT_READLIST_LABEL,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import {
	type LocalTime,
	toAbsoluteDateTime,
	withInternalTracking,
} from "@packages/web-shell";
import {
	ARTICLES_PAGE_SIZE,
	buildInboxArticlesMoreUrl,
} from "./inbox-articles-more.url";
import { buildInboxArticlesPollUrl } from "./inbox-articles-poll-url";
import {
	buildInboxEmailDetailUrl,
	type InboxEmailPageState,
	type MailTabKey,
} from "./inbox-email-detail.url";
import {
	type ExcludedLinkViewModel,
	toInboxExcludedLinkViewModel,
} from "./inbox-excluded-link.viewmodel";
import { buildInboxExcludedPollUrl } from "./inbox-excluded-poll-url";
import type { InboxEmailFilter } from "./inbox-email-filter";
import {
	type InboxLinkCardViewModel,
	toInboxLinkCardViewModel,
} from "./inbox-link-card.viewmodel";
import { buildInboxLinkFitUrl } from "./inbox-link-fit-url";
import { type InboxPanelStatus, panelStatusFor } from "./inbox-panel-status";
import {
	cardReadlistFits,
	fitsReadlist,
	type ReadlistFitOverridesByReadlist,
} from "./inbox-readlist-fit";
import { buildMailTabs, type MailTab } from "./mail-tabs";
import { DEFAULT_LOCALE } from "@packages/translations/locale";

/** Initial poll count for a card on first page render: the first htmx tick then
 * requests `?poll=1` and the poll route increments from there. */
const INITIAL_POLL_COUNT = 1;

export interface AlertCopy {
	title: string;
	body: string;
}

export interface PanelAlert extends AlertCopy {
	key: "failed" | "stale";
}

export interface PanelNotice {
	key: "extracting" | "deciding" | "truncated" | "decided" | "skipped-note";
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

function readlistSaveNotices(input: {
	selectedReadlists: NonNullable<InboxEmailLinksMeta["selectedReadlists"]>;
	outcomes: InboxEmailLinksMeta["readlistOutcomes"];
	articles: number;
	savesHeld: boolean;
	withinPollBudget: boolean;
}): PanelNotice[] {
	const notices: PanelNotice[] =
		input.articles > 0 && !input.savesHeld
			? [{ key: "decided", text: "Saved to All.", iconName: undefined }]
			: [];
	for (const { readlist, label } of input.selectedReadlists) {
		if (input.savesHeld) {
			notices.push({
				key: "decided",
				text: `No articles were saved to ${label} because this account is read-only.`,
				iconName: undefined,
			});
			continue;
		}
		const outcome = input.outcomes?.find(
			(entry) => entry.readlist === readlist,
		);
		if (outcome === undefined) {
			notices.push({
				key: "deciding",
				text: input.withinPollBudget
					? `Choosing articles for ${label}…`
					: `Still choosing articles for ${label}. Reload later to see the result.`,
				iconName: input.withinPollBudget ? "loader" : undefined,
			});
		} else if (outcome.decision === "no-purpose") {
			const dropped = outcome.fit.filter(
				({ verdict }) => verdict !== "keep",
			).length;
			const saved = Math.max(0, input.articles - dropped);
			notices.push({
				key: "decided",
				text: `${saved} ${saved === 1 ? "article" : "articles"} saved to ${outcome.readlistLabel}; ${dropped} didn't fit.`,
				iconName: undefined,
			});
		}
	}
	return notices;
}

export interface ReadlistLineFilter {
	show: InboxEmailFilter["show"];
	text: string;
	href: string;
	current: boolean;
}

export interface ReadlistLineViewModel {
	readlist: ReadlistSlug;
	elementId: string;
	text: string;
	filters: ReadlistLineFilter[];
}

interface ReadlistFitContext {
	emailId: string;
	cards: InboxEmailLinkEntry[];
	selectedReadlists: NonNullable<InboxEmailLinksMeta["selectedReadlists"]>;
	outcomes: InboxReadlistOutcome[];
	fitOverrides: ReadlistFitOverridesByReadlist;
}

function readlistFitContext(input: {
	emailId: string;
	cards: InboxEmailLinkEntry[];
	meta: InboxEmailLinksMeta | undefined;
	fitOverrides: ReadlistFitOverridesByReadlist;
}): ReadlistFitContext {
	return {
		emailId: input.emailId,
		cards: input.cards,
		selectedReadlists:
			input.meta?.savesHeld === true
				? []
				: (input.meta?.selectedReadlists ?? []),
		outcomes: input.meta?.readlistOutcomes ?? [],
		fitOverrides: input.fitOverrides,
	};
}

function fittingCards(input: {
	context: ReadlistFitContext;
	readlist: ReadlistSlug;
	outcome: InboxReadlistOutcome;
}): Set<InboxEmailLinkEntry> {
	const overrides = input.context.fitOverrides.get(input.readlist) ?? [];
	return new Set(
		input.context.cards.filter((card) =>
			fitsReadlist({
				outcome: input.outcome,
				overrides,
				emailId: input.context.emailId,
				ordinal: card.ordinal,
			}),
		),
	);
}

function filteredOutcome(input: {
	context: ReadlistFitContext;
	readlist: ReadlistSlug;
}): InboxReadlistOutcome | undefined {
	const routed = input.context.selectedReadlists.some(
		({ readlist }) => readlist === input.readlist,
	);
	const outcome = input.context.outcomes.find(
		(entry) => entry.readlist === input.readlist,
	);
	return routed && outcome?.decision === "filtered" ? outcome : undefined;
}

function applyReadlistFilter(input: {
	context: ReadlistFitContext;
	filter: InboxEmailFilter | undefined;
}): { cards: InboxEmailLinkEntry[]; filter: InboxEmailFilter | undefined } {
	const unfiltered = { cards: input.context.cards, filter: undefined };
	const filter = input.filter;
	if (filter === undefined) return unfiltered;
	const outcome = filteredOutcome({
		context: input.context,
		readlist: filter.readlist,
	});
	if (outcome === undefined) return unfiltered;
	const fitting = fittingCards({
		context: input.context,
		readlist: filter.readlist,
		outcome,
	});
	const cards = input.context.cards.filter(
		(card) => fitting.has(card) === (filter.show === "fit"),
	);
	return cards.length === 0 ? unfiltered : { cards, filter };
}

function readlistFilterLink(input: {
	emailId: string;
	filter: InboxEmailFilter;
	text: string;
	activeFilter: InboxEmailFilter | undefined;
}): ReadlistLineFilter {
	return {
		show: input.filter.show,
		text: input.text,
		href: withInternalTracking(
			buildInboxEmailDetailUrl({
				emailId: input.emailId,
				tab: "articles",
				filter: input.filter,
			}),
			{
				source: "inbox-email-detail",
				content: `readlist-filter-${input.filter.show}`,
			},
		),
		current:
			input.activeFilter?.readlist === input.filter.readlist &&
			input.activeFilter.show === input.filter.show,
	};
}

function readlistLines(input: {
	context: ReadlistFitContext;
	activeFilter: InboxEmailFilter | undefined;
}): ReadlistLineViewModel[] {
	const lines: ReadlistLineViewModel[] = [];
	for (const { readlist, label } of input.context.selectedReadlists) {
		const outcome = input.context.outcomes.find(
			(entry) => entry.readlist === readlist,
		);
		const line = {
			readlist,
			elementId: `inbox-readlist-line-${readlist}`,
		};
		if (outcome?.decision === "failed") {
			lines.push({
				...line,
				text: `Couldn't choose articles for ${label}. Everything stays in All. Use Keep in ${label} on any article you want there.`,
				filters: [],
			});
		} else if (outcome?.decision === "filtered") {
			const total = input.context.cards.length;
			const fit = fittingCards({
				context: input.context,
				readlist,
				outcome,
			}).size;
			if (fit === 0) {
				lines.push({
					...line,
					text: `Nothing in this issue fit ${label}.`,
					filters: [],
				});
			} else if (fit === total) {
				lines.push({
					...line,
					text: `All ${total} also fit ${label}.`,
					filters: [],
				});
			} else {
				lines.push({
					...line,
					text: `${fit} of ${total} also fit ${label}.`,
					filters: [
						readlistFilterLink({
							emailId: input.context.emailId,
							filter: { readlist, show: "fit" },
							text: `Show the ${fit} that fit`,
							activeFilter: input.activeFilter,
						}),
						readlistFilterLink({
							emailId: input.context.emailId,
							filter: { readlist, show: "rest" },
							text: `Show the ${total - fit} that didn't`,
							activeFilter: input.activeFilter,
						}),
					],
				});
			}
		}
	}
	return lines;
}

const ISSUE_DESTINATIONS = new Intl.ListFormat(DEFAULT_LOCALE, { type: "conjunction" });

function issueSaveNotice(
	issueSave: NonNullable<InboxEmailLinksMeta["issueSave"]>,
): PanelNotice {
	return {
		key: "decided",
		text: issueSave.held
			? "This issue wasn't saved because this account is read-only."
			: `Saved this issue to ${ISSUE_DESTINATIONS.format([
					DEFAULT_READLIST_LABEL,
					...issueSave.readlists.map(({ label }) => label),
				])}.`,
		iconName: undefined,
	};
}

const UNAVAILABLE_ALERT: AlertCopy = {
	title: "Couldn't display this email",
	body: "The original email is preserved.",
};

// Present tense on purpose: the save route only publishes SubmitLinkCommand, and
// the queue write happens in a downstream subscriber. Claiming "Saved" would
// promise a row a reader jumping straight to /queue might not find yet.
const SAVED_TOAST_MESSAGE = "Adding to All…";
const FEEDBACK_TOAST_MESSAGE = "Thanks — your report was logged";

export interface InboxStatusToastUndo {
	url: string;
	fields: { name: string; value: string }[];
}

export interface InboxStatusToast {
	message: string;
	undo: InboxStatusToastUndo | undefined;
}

export type InboxFitConfirmation = {
	verdict: "keep" | "drop";
	readlist: ReadlistSlug;
	ordinal: EmailLinkOrdinal;
};

export function fitStatusToast(input: {
	emailId: string;
	pageState: InboxEmailPageState;
	confirmation: InboxFitConfirmation;
	label: string;
}): InboxStatusToast {
	const { confirmation, label } = input;
	return {
		message:
			confirmation.verdict === "keep"
				? `Adding to ${label}…`
				: `Removed from ${label}`,
		undo: {
			url: withInternalTracking(
				buildInboxLinkFitUrl({
					emailId: input.emailId,
					ordinal: confirmation.ordinal,
					pageState: input.pageState,
				}),
				{ source: "inbox-toast", content: "undo-fit" },
			),
			fields: [
				{ name: "readlist", value: confirmation.readlist },
				{ name: "verdict", value: "undo" },
			],
		},
	};
}

function fitConfirmationToast(input: {
	context: ReadlistFitContext;
	confirmation: InboxFitConfirmation | undefined;
	pageState: InboxEmailPageState;
}): InboxStatusToast | undefined {
	const confirmation = input.confirmation;
	if (confirmation === undefined) return undefined;
	const routed = input.context.selectedReadlists.find(
		(entry) => entry.readlist === confirmation.readlist,
	);
	if (routed === undefined) return undefined;
	return fitStatusToast({
		emailId: input.context.emailId,
		pageState: input.pageState,
		confirmation,
		label: routed.label,
	});
}

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
	readlistLines: ReadlistLineViewModel[];
}

export interface ExcludedPanelViewModel extends ExtractionPanelViewModel {
	links: ExcludedLinkViewModel[];
}

export interface InboxEmailDetailViewModel {
	subject: string;
	sender: string;
	recipient: string;
	received: LocalTime;
	backHref: string;
	activeTab: MailTabKey;
	tabs: MailTab[];
	/** One-shot confirmation for a write that just completed, rendered as the
	 * shared toast — a fixed, self-dismissing overlay, so it is seen wherever the
	 * reader was scrolled to. Undefined on a plain page view. */
	statusToast: InboxStatusToast | undefined;
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
	filter: InboxEmailFilter | undefined;
	meta: InboxEmailLinksMeta | undefined;
	fitOverrides: ReadlistFitOverridesByReadlist;
}): ArticleCardsPage {
	const cards = input.allCards.slice(input.from, input.to).map((link) =>
		toInboxLinkCardViewModel({
			link,
			emailId: input.emailId,
			pollCount: INITIAL_POLL_COUNT,
			maxPolls: input.maxPolls,
			shown: input.to,
			filter: input.filter,
			fit: cardReadlistFits({
				meta: input.meta,
				fitOverrides: input.fitOverrides,
				emailId: input.emailId,
				ordinal: link.ordinal,
			}),
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
					filter: input.filter,
				}),
				{ source: "inbox-email-detail", content: "show-more-articles" },
			),
			moreUrl: withInternalTracking(
				buildInboxArticlesMoreUrl({
					emailId: input.emailId,
					shown: next,
					filter: input.filter,
				}),
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
	if (input.status !== "terminal") {
		return {
			alerts: [{ key: input.status, ...STALE_ALERT }],
			notices: [],
			listing: undefined,
		};
	}
	return {
		alerts: input.terminalAlerts,
		notices: input.terminalNotices,
		listing: { countLabel: input.countLabel, emptyStates: input.emptyStates },
	};
}

export function toInboxArticlesMoreViewModel(input: {
	links: InboxEmailLinkEntry[];
	meta: InboxEmailLinksMeta | undefined;
	emailId: string;
	shown: number;
	maxPolls: number;
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	fitOverrides: ReadlistFitOverridesByReadlist;
	filter: InboxEmailFilter | undefined;
}): ArticleCardsPage {
	const filtered = applyReadlistFilter({
		context: readlistFitContext({
			emailId: input.emailId,
			cards: input.links.filter((link) => !isExcludedLink(link)),
			meta: input.meta,
			fitOverrides: input.fitOverrides,
		}),
		filter: input.filter,
	});
	return buildArticleCardsPage({
		allCards: filtered.cards,
		filter: filtered.filter,
		emailId: input.emailId,
		from: input.shown - ARTICLES_PAGE_SIZE,
		to: input.shown,
		maxPolls: input.maxPolls,
		linkSaveStates: input.linkSaveStates,
		meta: input.meta,
		fitOverrides: input.fitOverrides,
	});
}

export function toInboxLinkFitViewModel(input: {
	links: InboxEmailLinkEntry[];
	meta: InboxEmailLinksMeta | undefined;
	link: InboxEmailLinkEntry;
	emailId: string;
	readlist: ReadlistSlug;
	shown: number;
	filter: InboxEmailFilter | undefined;
	maxPolls: number;
	linkSaveStates: ReadonlyMap<string, InboxLinkSaveState>;
	fitOverrides: ReadlistFitOverridesByReadlist;
}): { card: InboxLinkCardViewModel | undefined; line: ReadlistLineViewModel } {
	const context = readlistFitContext({
		emailId: input.emailId,
		cards: input.links.filter((link) => !isExcludedLink(link)),
		meta: input.meta,
		fitOverrides: input.fitOverrides,
	});
	const filtered = applyReadlistFilter({ context, filter: input.filter });
	const line = readlistLines({
		context,
		activeFilter: filtered.filter,
	}).find((entry) => entry.readlist === input.readlist);
	assert(line, "a readlist the reader can change carries a readlist line");
	if (!filtered.cards.includes(input.link)) return { card: undefined, line };
	return {
		card: toInboxLinkCardViewModel({
			link: input.link,
			emailId: input.emailId,
			pollCount: INITIAL_POLL_COUNT,
			maxPolls: input.maxPolls,
			shown: input.shown,
			filter: filtered.filter,
			fit: cardReadlistFits({
				meta: input.meta,
				fitOverrides: input.fitOverrides,
				emailId: input.emailId,
				ordinal: input.link.ordinal,
			}),
			linkSaveStates: input.linkSaveStates,
			savePollContext: { mode: "static" },
		}),
		line,
	};
}

type InboxEmailLinkRows = {
	source: "rows";
	links: InboxEmailLinkEntry[];
	meta: InboxEmailLinksMeta | undefined;
};

/** Where the tab counts come from. Tabs that fetch the link rows derive them
 * from the same single query that carries the meta barrier, so a count is never
 * shown that the rendered panel cannot back; the View tab fetches no rows and
 * reads the tally the extraction barrier stamped onto the email row instead. */
export type InboxEmailLinkData = InboxEmailLinkRows | { source: "entry" };

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
	fitConfirmed?: InboxFitConfirmation;
	fitOverrides: ReadlistFitOverridesByReadlist;
	filter?: InboxEmailFilter;
}): InboxEmailDetailViewModel {
	const emailId = input.entry.receivedAtMessageId;
	const canRenderBody =
		input.entry.status === "received" && input.bodyHtml !== undefined;
	const links = input.linkData.source === "rows" ? input.linkData.links : [];
	const linksMeta =
		input.linkData.source === "rows" ? input.linkData.meta : undefined;
	const allCards = links.filter((link) => !isExcludedLink(link));
	const totalCards = allCards.length;
	const fitContext = readlistFitContext({
		emailId,
		cards: allCards,
		meta: linksMeta,
		fitOverrides: input.fitOverrides,
	});
	const filtered = applyReadlistFilter({
		context: fitContext,
		filter: input.filter,
	});
	const cardsPage = buildArticleCardsPage({
		allCards: filtered.cards,
		filter: filtered.filter,
		emailId,
		from: 0,
		to: input.shown ?? ARTICLES_PAGE_SIZE,
		maxPolls: input.maxPolls,
		linkSaveStates: input.linkSaveStates,
		meta: linksMeta,
		fitOverrides: input.fitOverrides,
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
	const truncated = linksMeta?.truncated === true;
	// No meta row yet means the async extractor has not finished for this received
	// email — keep polling rather than asserting it has zero links. Non-received
	// emails never run extraction, so they are terminal immediately.
	const awaitingMeta =
		input.entry.status === "received" && linksMeta === undefined;
	// A barrier written by the dead-letter handler reports a scan that never
	// completed, so its zero rows are not an answer about the email's contents.
	const isExtractionFailed = linksMeta?.extractionFailed === true;
	const panelPollCount = input.panelPollCount ?? INITIAL_POLL_COUNT;
	const withinPollBudget = panelPollCount <= input.maxPolls;
	let linkCounts: InboxEmailLinkCounts | undefined;
	if (input.linkData.source === "rows") {
		linkCounts =
			awaitingMeta || isExtractionFailed
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
	const fitToast = fitConfirmationToast({
		context: fitContext,
		confirmation: input.fitConfirmed,
		pageState: {
			tab: input.activeTab,
			shown: input.shown,
			filter: input.filter,
		},
	});
	const statusToast: InboxStatusToast | undefined =
		input.savedConfirmed === true
			? { message: SAVED_TOAST_MESSAGE, undo: undefined }
			: (fitToast ??
				(input.feedbackConfirmed === true
					? { message: FEEDBACK_TOAST_MESSAGE, undo: undefined }
					: undefined));
	const panelStatus = panelStatusFor({
		isExtracting,
		isExtractionFailed,
		isStalePending,
	});
	const gmailPending =
		linksMeta?.selectedReadlists?.some(
			({ readlist }) =>
				!linksMeta.readlistOutcomes?.some(
					(outcome) => outcome.readlist === readlist,
				),
		) === true;
	const isPolling =
		isExtracting ||
		(gmailPending && linksMeta?.savesHeld !== true && withinPollBudget);
	const truncatedNotices: PanelNotice[] = truncated
		? [
				{
					key: "truncated",
					text: `Showing the first ${links.length} links found in this email.`,
					iconName: undefined,
				},
			]
		: [];
	const decisionNotices: PanelNotice[] = [];
	if (linksMeta?.issueSave !== undefined) {
		decisionNotices.push(issueSaveNotice(linksMeta.issueSave));
	}
	if (linksMeta?.selectedReadlists !== undefined) {
		decisionNotices.push(
			...readlistSaveNotices({
				selectedReadlists: linksMeta.selectedReadlists,
				outcomes: linksMeta.readlistOutcomes,
				articles: linksMeta.eligibleArticleCount ?? totalCards,
				savesHeld: linksMeta.savesHeld === true,
				withinPollBudget,
			}),
		);
	}
	const skippedNotices = excludedEntries.some(
		(link) => link.status === "skipped",
	)
		? [SKIPPED_NOTE_NOTICE]
		: [];
	const shared = {
		isExtracting,
		isStalePending,
		isExtractionFailed,
	};
	return {
		subject: input.entry.subject === "" ? "(no subject)" : input.entry.subject,
		sender:
			input.entry.senderEmail === ""
				? "(unknown sender)"
				: input.entry.senderEmail,
		recipient: input.entry.recipientAddress,
		received: toAbsoluteDateTime({ iso: input.entry.receivedAt }),
		backHref: withInternalTracking(INBOX_PATH, {
			source: "inbox-email-detail",
			content: "back-to-inbox",
		}),
		activeTab: input.activeTab,
		statusToast,
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
		extractionReported: !awaitingMeta && !isExtractionFailed,
		canRenderBody,
		bodyHtml: input.bodyHtml ?? "",
		imagesCdnBaseUrl: input.imagesCdnBaseUrl,
		unavailableAlert: UNAVAILABLE_ALERT,
		articles: {
			...shared,
			cards: cardsPage.cards,
			showMore: cardsPage.showMore,
			readlistLines: readlistLines({
				context: fitContext,
				activeFilter: filtered.filter,
			}),
			// Every kept link, not the page of them on screen: a first page that is
			// merely unfilled is not an empty panel.
			isEmpty: totalCards === 0,
			...buildPanelRegions({
				status: panelStatus,
				terminalAlerts: [],
				terminalNotices: [...truncatedNotices, ...decisionNotices],
				countLabel: `${totalCards} Extracted ${totalCards === 1 ? "Article" : "Articles"}`,
				emptyStates:
					totalCards > 0
						? []
						: [
								excludedLinks.length === 0
									? NO_LINKS_EMPTY_STATE
									: ALL_SKIPPED_EMPTY_STATE,
							],
			}),
			panelPollUrl: isPolling
				? buildInboxArticlesPollUrl({
						emailId,
						pollCount: panelPollCount,
						filter: filtered.filter,
					})
				: undefined,
		},
		excluded: {
			...shared,
			links: excludedLinks,
			isEmpty: excludedLinks.length === 0,
			...buildPanelRegions({
				status: panelStatus,
				terminalAlerts: [],
				terminalNotices: [...truncatedNotices, ...skippedNotices],
				countLabel: `${excludedLinks.length} Skipped`,
				emptyStates:
					excludedLinks.length > 0
						? []
						: [
								totalCards === 0
									? NO_LINKS_EMPTY_STATE
									: NOTHING_SKIPPED_EMPTY_STATE,
							],
			}),
			panelPollUrl: isPolling
				? buildInboxExcludedPollUrl({ emailId, pollCount: panelPollCount })
				: undefined,
		},
	};
}
