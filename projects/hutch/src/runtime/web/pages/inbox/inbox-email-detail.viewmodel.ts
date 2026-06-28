import { EMAIL_FEATURE, type LocalTime, toAbsoluteDateTime } from "@packages/web-shell";
import type {
	InboxEmailEntry,
	InboxEmailLinkEntry,
	InboxEmailLinksMeta,
} from "@packages/domain/inbox";
import { buildLinkCountLabel } from "./inbox-link-count-label";
import { type InboxLinkCardViewModel, toInboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import { type MailTab, buildMailTabs } from "./mail-tabs";

/** Initial poll count for a card on first page render: the first htmx tick then
 * requests `?poll=1` and the poll route increments from there. */
const INITIAL_POLL_COUNT = 1;

export interface ArticlesPanelViewModel {
	cards: InboxLinkCardViewModel[];
	isEmpty: boolean;
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
		linkCountLabel: buildLinkCountLabel({ count: cards.length, truncated }),
		articles: {
			cards,
			isEmpty: cards.length === 0,
			truncatedNotice: truncated
				? `Showing the first ${cards.length} links found in this email.`
				: undefined,
		},
	};
}
