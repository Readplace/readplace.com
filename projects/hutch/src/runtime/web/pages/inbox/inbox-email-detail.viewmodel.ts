import { EMAIL_FEATURE, type LocalTime, toAbsoluteDateTime } from "@packages/web-shell";
import type {
	InboxEmailEntry,
	InboxEmailLinkEntry,
	InboxEmailLinksMeta,
} from "@packages/domain/inbox";
import { buildInboxArticlesPollUrl } from "./inbox-articles-poll-url";
import { buildLinkCountLabel } from "./inbox-link-count-label";
import { type InboxLinkCardViewModel, toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import { type MailTab, buildMailTabs } from "./mail-tabs";

/** Initial poll count for a card on first page render: the first htmx tick then
 * requests `?poll=1` and the poll route increments from there. */
const INITIAL_POLL_COUNT = 1;

export interface ArticlesPanelViewModel {
	cards: InboxLinkCardViewModel[];
	isEmpty: boolean;
	/** True while extraction has not yet written its meta barrier (a just-received
	 * email) and the poll budget is unspent: the panel shows a polling "Looking for
	 * links…" state instead of the terminal "No links found", so a non-terminal
	 * state is never shown as terminal. Goes false once `isStalePending` takes over. */
	isExtracting: boolean;
	/** True when the poll budget is spent but extraction never wrote its meta
	 * barrier — a permanent extract-DLQ failure or a pre-feature email that predates
	 * the meta row. The panel gives up on "Looking for links…" and shows a terminal
	 * notice instead of polling forever. Mirrors the queue card's `isStalePending`. */
	isStalePending: boolean;
	/** Present only while `isExtracting` and within the poll budget — drives the
	 * page-level htmx poll that swaps the finished card set in on completion. */
	panelPollUrl: string | undefined;
	/** Present only when the per-email cap truncated the link list. */
	truncatedNotice: string | undefined;
}

export interface InboxEmailDetailViewModel {
	subject: string;
	sender: string;
	received: LocalTime;
	backHref: string;
	tabs: MailTab[];
	/** A `received` email with its body present renders in the iframe; every
	 * other case (rejected, unparsed, or a body not yet readable from S3) shows
	 * the graceful unavailable panel instead of an empty frame. */
	canRenderBody: boolean;
	bodyHtml: string;
	unavailableMessage: string;
	/** "12 links" in the header; omitted before extraction or when there are none. */
	linkCountLabel: string | undefined;
	articles: ArticlesPanelViewModel;
}

export function toInboxEmailDetailViewModel(input: {
	entry: InboxEmailEntry;
	bodyHtml: string | undefined;
	links: InboxEmailLinkEntry[];
	linksMeta: InboxEmailLinksMeta | undefined;
	maxPolls: number;
	/** The page-level poll tick: the full render starts at the initial count; the
	 * `/inbox/:id/articles` fragment route passes the incremented count back. */
	panelPollCount?: number;
}): InboxEmailDetailViewModel {
	const canRenderBody = input.entry.status === "received" && input.bodyHtml !== undefined;
	const cards = input.links.map((link) =>
		toInboxLinkCardViewModel({
			link,
			emailId: input.entry.receivedAtMessageId,
			pollCount: INITIAL_POLL_COUNT,
			maxPolls: input.maxPolls,
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
		tabs: buildMailTabs("view"),
		canRenderBody,
		bodyHtml: input.bodyHtml ?? "",
		unavailableMessage:
			"This message couldn’t be displayed here; the original email is preserved.",
		// Suppressed until extraction writes its barrier so the header never claims a
		// count the panel can't back — this covers both the live spinner and the
		// terminal give-up, neither of which has a trustworthy count.
		linkCountLabel: awaitingMeta
			? undefined
			: buildLinkCountLabel({ count: cards.length, truncated }),
		articles: {
			cards,
			isEmpty: cards.length === 0,
			isExtracting,
			isStalePending,
			panelPollUrl,
			truncatedNotice: truncated
				? `Showing the first ${cards.length} links found in this email.`
				: undefined,
		},
	};
}
