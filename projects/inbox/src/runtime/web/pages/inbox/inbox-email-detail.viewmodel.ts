import { type LocalTime, toAbsoluteDateTime } from "@packages/web-shell";
import type {
	EmailLinkSkipReason,
	InboxEmailEntry,
	InboxEmailLinkCounts,
	InboxEmailLinkEntry,
	InboxEmailLinksMeta,
	InboxLinkSaveState,
} from "@packages/domain/inbox";
import { ARTICLES_PAGE_SIZE, buildInboxArticlesMoreUrl } from "./inbox-articles-more.url";
import { buildInboxArticlesPollUrl } from "./inbox-articles-poll-url";
import { buildInboxExcludedPollUrl } from "./inbox-excluded-poll-url";
import { type MailTabKey, buildInboxEmailDetailUrl } from "./inbox-email-detail.url";
import { buildInboxLinkFeedbackUrl } from "./inbox-link-feedback-url";
import { buildLinkCountLabel } from "./inbox-link-count-label";
import { type InboxLinkCardViewModel, toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import { type MailTab, buildMailTabs } from "./mail-tabs";

/** Initial poll count for a card on first page render: the first htmx tick then
 * requests `?poll=1` and the poll route increments from there. */
const INITIAL_POLL_COUNT = 1;

const SKIP_REASON_LABELS: Record<EmailLinkSkipReason, string> = {
	"list-unsubscribe": "Unsubscribe link",
	"action-link-pattern": "Unsubscribe or account link",
	"llm-noise": "Not an article",
	"llm-ad": "Advertisement",
	"llm-menu": "Site navigation",
	"llm-subscription": "Subscription management",
};

const GENERIC_EXCLUDED_LABEL = "Not an article";

const NO_LINKS_MESSAGE = "No links found in this email.";
const ALL_SKIPPED_MESSAGE = "Every link in this email was skipped — see the Skipped tab.";
const NOTHING_SKIPPED_MESSAGE = "Nothing was skipped in this email.";

// Both panels report the same extractor run, so they say these in one voice from
// one place — two copies would drift, and each is a claim about the run rather
// than about the panel showing it.
const EXTRACTING_MESSAGE = "Looking for links…";
const STALE_MESSAGE =
	"I couldn’t scan this email for links. The original message is still on the View tab.";

// Present tense on purpose: the save route only publishes SubmitLinkCommand, and
// the queue write happens in a downstream subscriber. Claiming "Saved" would
// promise a row a reader jumping straight to /queue might not find yet.
const SAVED_TOAST_MESSAGE = "Adding to your queue…";
const FEEDBACK_TOAST_MESSAGE = "Thanks — your report was logged.";

export interface ExcludedLinkViewModel {
	ordinal: string;
	url: string;
	reasonLabel: string;
	feedbackAction: string;
	/** Stable id so htmx can hand keyboard focus back to this report button after
	 * the swap replaces the row the reader was keyboarding through. Mirrors the
	 * card action's `inbox-card-{ordinal}-{key}` scheme. */
	buttonId: string;
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
	/** Terminal copy for an empty panel. Each panel picks it from what the *other*
	 * panel holds: "No links found" is a lie for an email whose every link was
	 * skipped, and "Nothing was skipped" is a lie for an email with no links at all. */
	emptyMessage: string;
	extractingMessage: string;
	staleMessage: string;
	/** The per-email extraction cap, so it belongs to every panel and shows even
	 * when this one is empty: an email capped at N links whose every link was
	 * skipped would otherwise disclose the cap on no tab at all. */
	truncatedNotice: string | undefined;
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
	/** Present only while `isExtracting` and within the poll budget — drives the
	 * page-level htmx poll that swaps the finished panel in on completion. Each panel
	 * polls its own fragment route: a shared URL would swap the other panel's markup
	 * in over this one. */
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
	unavailableMessage: string;
	linkCountLabel: string | undefined;
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
		}),
	);
	const shown = Math.min(input.to, input.allCards.length);
	const remaining = input.allCards.length - shown;
	if (remaining <= 0) return { cards, showMore: undefined };
	const next = shown + ARTICLES_PAGE_SIZE;
	return {
		cards,
		showMore: {
			detailHref: buildInboxEmailDetailUrl({
				emailId: input.emailId,
				tab: "articles",
				shown: next,
			}),
			moreUrl: buildInboxArticlesMoreUrl({ emailId: input.emailId, shown: next }),
			count: Math.min(ARTICLES_PAGE_SIZE, remaining),
		},
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
		allCards: input.links.filter((link) => link.status !== "skipped"),
		emailId: input.emailId,
		from: input.shown - ARTICLES_PAGE_SIZE,
		to: input.shown,
		maxPolls: input.maxPolls,
		linkSaveStates: input.linkSaveStates,
	});
}

/** Where the header badge and tab counts come from. Tabs that fetch the link
 * rows derive them from the same single query that carries the meta barrier, so
 * a count is never shown that the rendered panel cannot back; the View tab
 * fetches no rows and reads the tally the extraction barrier stamped onto the
 * email row instead. */
export type InboxEmailLinkData =
	| { source: "rows"; links: InboxEmailLinkEntry[]; meta: InboxEmailLinksMeta | undefined }
	| { source: "entry" };

export function toInboxEmailDetailViewModel(input: {
	entry: InboxEmailEntry;
	activeTab: MailTabKey;
	bodyHtml: string | undefined;
	imagesCdnBaseUrl: string;
	linkData: InboxEmailLinkData;
	/** Save state for the email's links, keyed by stored URL. Empty for the View
	 * tab, which fetches no link rows to look up. */
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
	const allCards = links.filter((link) => link.status !== "skipped");
	const totalCards = allCards.length;
	const cardsPage = buildArticleCardsPage({
		allCards,
		emailId,
		from: 0,
		to: input.shown ?? ARTICLES_PAGE_SIZE,
		maxPolls: input.maxPolls,
		linkSaveStates: input.linkSaveStates,
	});
	const excludedLinks = links
		.filter((link) => link.status === "skipped")
		.map(
			(link): ExcludedLinkViewModel => ({
				ordinal: link.ordinal,
				url: link.url,
				reasonLabel:
					link.skipReason === undefined
						? GENERIC_EXCLUDED_LABEL
						: SKIP_REASON_LABELS[link.skipReason],
				feedbackAction: buildInboxLinkFeedbackUrl({
					emailId,
					ordinal: link.ordinal,
				}),
				buttonId: `inbox-skipped-${link.ordinal}-feedback-include`,
			}),
		);
	const truncated = linksMeta?.truncated === true;
	// No meta row yet means the async extractor has not finished for this received
	// email — keep polling rather than asserting it has zero links. Non-received
	// emails never run extraction, so they are terminal immediately.
	const awaitingMeta = input.entry.status === "received" && linksMeta === undefined;
	// A barrier written by the dead-letter handler reports a scan that never
	// completed, so its zero rows are not an answer about the email's contents.
	const isExtractionFailed = linksMeta?.extractionFailed === true;
	let headerCounts: InboxEmailLinkCounts | undefined;
	if (input.linkData.source === "rows") {
		headerCounts =
			awaitingMeta || isExtractionFailed
				? undefined
				: { kept: allCards.length, skipped: excludedLinks.length, truncated };
	} else if (input.entry.status === "received") {
		headerCounts = input.entry.linkCounts;
	} else {
		headerCounts = { kept: 0, skipped: 0, truncated: false };
	}
	const panelPollCount = input.panelPollCount ?? INITIAL_POLL_COUNT;
	const withinPollBudget = panelPollCount <= input.maxPolls;
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
	const shared = {
		extractingMessage: EXTRACTING_MESSAGE,
		staleMessage: STALE_MESSAGE,
		isExtracting,
		isStalePending,
		isExtractionFailed,
		truncatedNotice: truncated
			? `Showing the first ${links.length} links found in this email.`
			: undefined,
	};
	return {
		subject: input.entry.subject === "" ? "(no subject)" : input.entry.subject,
		sender: input.entry.senderEmail === "" ? "(unknown sender)" : input.entry.senderEmail,
		received: toAbsoluteDateTime({ iso: input.entry.receivedAt }),
		backHref: "/inbox",
		activeTab: input.activeTab,
		statusToastMessage,
		// Counts come from every kept/skipped link, not the page of cards on
		// screen, and are withheld on the same barrier as the header badge — a tab
		// claiming "(0)" mid-extraction would read as "none found" rather than
		// "still looking".
		tabs: buildMailTabs({
			emailId,
			active: input.activeTab,
			counts:
				headerCounts === undefined
					? {}
					: { articles: headerCounts.kept, excluded: headerCounts.skipped },
		}),
		extractionReported: !awaitingMeta && !isExtractionFailed,
		canRenderBody,
		bodyHtml: input.bodyHtml ?? "",
		imagesCdnBaseUrl: input.imagesCdnBaseUrl,
		unavailableMessage:
			"This message couldn’t be displayed here; the original email is preserved.",
		// Suppressed until extraction writes its barrier so the header never claims a
		// count the panel can't back — this covers both the live spinner and the
		// terminal give-up, neither of which has a trustworthy count.
		linkCountLabel:
			headerCounts === undefined
				? undefined
				: buildLinkCountLabel({
						count: headerCounts.kept,
						truncated: headerCounts.truncated,
					}),
		articles: {
			...shared,
			cards: cardsPage.cards,
			showMore: cardsPage.showMore,
			// Every kept link, not the page of them on screen: a first page that is
			// merely unfilled is not an empty panel.
			isEmpty: totalCards === 0,
			emptyMessage: excludedLinks.length === 0 ? NO_LINKS_MESSAGE : ALL_SKIPPED_MESSAGE,
			panelPollUrl: isExtracting
				? buildInboxArticlesPollUrl({ emailId, pollCount: panelPollCount })
				: undefined,
		},
		excluded: {
			...shared,
			links: excludedLinks,
			isEmpty: excludedLinks.length === 0,
			emptyMessage: totalCards === 0 ? NO_LINKS_MESSAGE : NOTHING_SKIPPED_MESSAGE,
			panelPollUrl: isExtracting
				? buildInboxExcludedPollUrl({ emailId, pollCount: panelPollCount })
				: undefined,
		},
	};
}
