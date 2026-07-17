import { EMAIL_FEATURE, type LocalTime, toAbsoluteDateTime } from "@packages/web-shell";
import type {
	EmailLinkSkipReason,
	InboxEmailEntry,
	InboxEmailLinkEntry,
	InboxEmailLinksMeta,
} from "@packages/domain/inbox";
import { ARTICLES_PAGE_SIZE, buildInboxArticlesMoreUrl } from "./inbox-articles-more.url";
import { buildInboxArticlesPollUrl } from "./inbox-articles-poll-url";
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

export interface ExcludedLinkViewModel {
	ordinal: string;
	url: string;
	reasonLabel: string;
	feedbackAction: string;
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

export interface ArticlesPanelViewModel {
	cards: InboxLinkCardViewModel[];
	showMore: ArticleShowMore | undefined;
	excluded: ExcludedLinkViewModel[];
	isEmpty: boolean;
	/** True while extraction has not yet written its meta barrier (a just-received
	 * email) and the poll budget is unspent: the panel shows a polling "Looking for
	 * links…" state instead of the terminal "No links found", so a non-terminal
	 * state is never shown as terminal. Goes false once `isStalePending` takes over. */
	isExtracting: boolean;
	/** True when the poll budget is spent but extraction never wrote its meta
	 * barrier — a permanent extract-DLQ failure or a pre-feature email that predates
	 * the meta row. The panel gives up on "Looking for links…" and shows a terminal
	 * notice instead of polling forever. */
	isStalePending: boolean;
	/** Present only while `isExtracting` and within the poll budget — drives the
	 * page-level htmx poll that swaps the finished card set in on completion. */
	panelPollUrl: string | undefined;
	truncatedNotice: string | undefined;
	feedbackNotice: boolean;
}

export interface InboxEmailDetailViewModel {
	subject: string;
	sender: string;
	received: LocalTime;
	backHref: string;
	activeTab: MailTabKey;
	tabs: MailTab[];
	/** A `received` email with its body present renders in the iframe; every
	 * other case (rejected, unparsed, or a body not yet readable from S3) shows
	 * the graceful unavailable panel instead of an empty frame. */
	canRenderBody: boolean;
	bodyHtml: string;
	unavailableMessage: string;
	linkCountLabel: string | undefined;
	articles: ArticlesPanelViewModel;
}

function buildArticleCardsPage(input: {
	allCards: InboxEmailLinkEntry[];
	emailId: string;
	from: number;
	to: number;
	maxPolls: number;
}): ArticleCardsPage {
	const cards = input.allCards.slice(input.from, input.to).map((link) =>
		toInboxLinkCardViewModel({
			link,
			emailId: input.emailId,
			pollCount: INITIAL_POLL_COUNT,
			maxPolls: input.maxPolls,
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
}): ArticleCardsPage {
	return buildArticleCardsPage({
		allCards: input.links.filter((link) => link.status !== "skipped"),
		emailId: input.emailId,
		from: input.shown - ARTICLES_PAGE_SIZE,
		to: input.shown,
		maxPolls: input.maxPolls,
	});
}

export function toInboxEmailDetailViewModel(input: {
	entry: InboxEmailEntry;
	activeTab: MailTabKey;
	bodyHtml: string | undefined;
	links: InboxEmailLinkEntry[];
	linksMeta: InboxEmailLinksMeta | undefined;
	maxPolls: number;
	shown?: number;
	/** The page-level poll tick: the full render starts at the initial count; the
	 * `/inbox/:id/articles` fragment route passes the incremented count back. */
	panelPollCount?: number;
	feedbackConfirmed?: boolean;
}): InboxEmailDetailViewModel {
	const canRenderBody = input.entry.status === "received" && input.bodyHtml !== undefined;
	const allCards = input.links.filter((link) => link.status !== "skipped");
	const totalCards = allCards.length;
	const cardsPage = buildArticleCardsPage({
		allCards,
		emailId: input.entry.receivedAtMessageId,
		from: 0,
		to: input.shown ?? ARTICLES_PAGE_SIZE,
		maxPolls: input.maxPolls,
	});
	const excluded = input.links
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
					emailId: input.entry.receivedAtMessageId,
					ordinal: link.ordinal,
				}),
			}),
		);
	const truncated = input.linksMeta?.truncated === true;
	// No meta row yet means the async extractor has not finished for this received
	// email — keep polling rather than asserting it has zero links. Non-received
	// emails never run extraction, so they are terminal immediately.
	const awaitingMeta = input.entry.status === "received" && input.linksMeta === undefined;
	const panelPollCount = input.panelPollCount ?? INITIAL_POLL_COUNT;
	const withinPollBudget = panelPollCount <= input.maxPolls;
	// Once the budget is spent without a meta barrier the extractor is never coming
	// back (permanent extract-DLQ failure, or a pre-feature email with no meta row),
	// so we give up on the spinner and show a terminal notice instead of polling on.
	const isStalePending = awaitingMeta && !withinPollBudget;
	const isExtracting = awaitingMeta && withinPollBudget;
	const panelPollUrl = isExtracting
		? buildInboxArticlesPollUrl({
				emailId: input.entry.receivedAtMessageId,
				pollCount: panelPollCount,
			})
		: undefined;
	return {
		subject: input.entry.subject === "" ? "(no subject)" : input.entry.subject,
		sender: input.entry.senderEmail === "" ? "(unknown sender)" : input.entry.senderEmail,
		received: toAbsoluteDateTime({ iso: input.entry.receivedAt }),
		backHref: `/inbox?feature=${EMAIL_FEATURE}`,
		activeTab: input.activeTab,
		tabs: buildMailTabs({ emailId: input.entry.receivedAtMessageId, active: input.activeTab }),
		canRenderBody,
		bodyHtml: input.bodyHtml ?? "",
		unavailableMessage:
			"This message couldn’t be displayed here; the original email is preserved.",
		// Suppressed until extraction writes its barrier so the header never claims a
		// count the panel can't back — this covers both the live spinner and the
		// terminal give-up, neither of which has a trustworthy count.
		linkCountLabel: awaitingMeta
			? undefined
			: buildLinkCountLabel({ count: totalCards, truncated }),
		articles: {
			cards: cardsPage.cards,
			showMore: cardsPage.showMore,
			excluded,
			isEmpty: totalCards === 0 && excluded.length === 0,
			isExtracting,
			isStalePending,
			panelPollUrl,
			truncatedNotice: truncated
				? `Showing the first ${input.links.length} links found in this email.`
				: undefined,
			feedbackNotice: input.feedbackConfirmed === true,
		},
	};
}
