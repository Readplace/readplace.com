import { z } from "zod";

const EMAIL_LINK_ORDINAL_DIGITS = 4;

export const EMAIL_LINK_ORDINAL_CAPACITY = 10 ** EMAIL_LINK_ORDINAL_DIGITS;

/** Stable per-link ordinal within one email: the zero-padded index of the link
 * in extraction order. Branded so a raw string can't stand in; it doubles as the
 * DynamoDB sort key, so links list back in body order. */
export const EmailLinkOrdinalSchema = z
	.string()
	.regex(new RegExp(`^\\d{${EMAIL_LINK_ORDINAL_DIGITS}}$`))
	.brand<"EmailLinkOrdinal">();
export type EmailLinkOrdinal = z.infer<typeof EmailLinkOrdinalSchema>;

export const formatEmailLinkOrdinal = (index: number): EmailLinkOrdinal =>
	EmailLinkOrdinalSchema.parse(String(index).padStart(EMAIL_LINK_ORDINAL_DIGITS, "0"));

/** Crawl-preview lifecycle. Data-state words, contrasting "pending"/"staging":
 *  - `pending`  — extracted, not yet crawled (the only non-terminal state).
 *  - `crawled`  — crawl succeeded; title/excerpt/imageUrl/siteName populated.
 *  - `failed`   — crawl returned failed/unsupported, or the URL was SSRF-blocked.
 *  - `skipped`  — classified as an action link at extraction; never crawled.
 * Terminal = everything but `pending`; a card polls only while it is `pending`. */
export const EmailLinkStatusSchema = z.enum(["pending", "crawled", "failed", "skipped"]);
export type EmailLinkStatus = z.infer<typeof EmailLinkStatusSchema>;

export const EmailLinkSkipReasonSchema = z.enum(["list-unsubscribe", "action-link-pattern"]);
export type EmailLinkSkipReason = z.infer<typeof EmailLinkSkipReasonSchema>;
