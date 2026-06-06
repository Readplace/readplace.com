import { z } from "zod";

/** The local-part of a user's inbound newsletter address. 12 random bytes
 * rendered as 24 lowercase hex characters — wide enough that the address is
 * unguessable (anyone who knows it can post links into the owner's queue). */
export const NewsletterInboxTokenSchema = z
	.string()
	.regex(/^[0-9a-f]{24}$/)
	.brand<"NewsletterInboxToken">();

export type NewsletterInboxToken = z.infer<typeof NewsletterInboxTokenSchema>;

/** Identifies a received message. Sourced from the inbound provider's email id
 * and used directly as a URL path segment, so it is constrained to a
 * URL-safe character set. */
export const NewsletterMessageIdSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,128}$/)
	.brand<"NewsletterMessageId">();

export type NewsletterMessageId = z.infer<typeof NewsletterMessageIdSchema>;

export const NEWSLETTER_INBOX_TOKEN_BYTES = 12;

/** Stub-save fan-out width when a single message yields many links. Smaller
 * than the file-import batch (newsletters carry far fewer links per message). */
export const NEWSLETTER_SAVE_CONCURRENCY = 10;
