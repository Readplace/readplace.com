import type { ReaderArticleHashId } from "../article/reader-article-hash-id";
import type { UserId } from "../user/user.types";
import type {
	NewsletterInboxToken,
	NewsletterMessageId,
} from "./newsletter.schema";

/** A user's inbound newsletter mailbox. The address is
 * `${token}@${NEWSLETTER_INBOX_DOMAIN}`. */
export interface NewsletterInbox {
	readonly userId: UserId;
	readonly token: NewsletterInboxToken;
}

/** One link harvested from a message and stub-saved into the reading queue.
 * `articleId` is captured at save time so the message detail view can deep-link
 * straight to the reader. */
export interface NewsletterMessageLink {
	readonly url: string;
	readonly articleId: ReaderArticleHashId;
}

export interface NewsletterMessage {
	readonly id: NewsletterMessageId;
	readonly userId: UserId;
	readonly subject: string;
	readonly fromAddress: string;
	/** ISO-8601 instant the message was received (from the inbound provider). */
	readonly receivedAt: string;
	/** The original message body, rendered verbatim in a sandboxed iframe. */
	readonly html: string;
	readonly savedLinks: readonly NewsletterMessageLink[];
	/** Links found in the body that failed save-ability validation. */
	readonly skippedCount: number;
}

/** Row shape for the list view — the heavy `html` body is omitted. */
export interface NewsletterMessageSummary {
	readonly id: NewsletterMessageId;
	readonly subject: string;
	readonly receivedAt: string;
	readonly savedCount: number;
}

export type FindInbox = (userId: UserId) => Promise<NewsletterInbox | undefined>;

export type GetOrCreateNewsletterInbox = (
	userId: UserId,
) => Promise<NewsletterInbox>;

export type FindUserIdByInboxToken = (
	token: NewsletterInboxToken,
) => Promise<UserId | undefined>;

export interface NewsletterInboxStore {
	findInbox: FindInbox;
	getOrCreateInbox: GetOrCreateNewsletterInbox;
	findUserIdByInboxToken: FindUserIdByInboxToken;
}

export type RecordNewsletterMessage = (
	message: NewsletterMessage,
) => Promise<void>;

export type ListNewsletterMessages = (
	userId: UserId,
) => Promise<readonly NewsletterMessageSummary[]>;

export type FindNewsletterMessage = (params: {
	userId: UserId;
	id: NewsletterMessageId;
}) => Promise<NewsletterMessage | undefined>;

export interface NewsletterMessageStore {
	recordMessage: RecordNewsletterMessage;
	listMessages: ListNewsletterMessages;
	findMessage: FindNewsletterMessage;
}

/** The body content of an inbound message. The Resend `email.received` webhook
 * carries metadata only, so the body is fetched separately by `email_id`. */
export interface InboundEmailContent {
	readonly html: string;
}

export type FetchInboundEmail = (
	emailId: string,
) => Promise<InboundEmailContent | undefined>;
