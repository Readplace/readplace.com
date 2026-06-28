import { z } from "zod";

/** Stable per-link ordinal within one email: the zero-padded index of the link
 * in extraction order. Branded so a raw string can't stand in; it doubles as the
 * DynamoDB sort key, so links list back in body order. */
export const EmailLinkOrdinalSchema = z
	.string()
	.regex(/^\d{4}$/)
	.brand<"EmailLinkOrdinal">();
export type EmailLinkOrdinal = z.infer<typeof EmailLinkOrdinalSchema>;

/** Crawl-preview lifecycle. Data-state words, contrasting "pending"/"staging":
 *  - `pending`  — extracted, not yet crawled (the only non-terminal state).
 *  - `crawled`  — crawl succeeded; title/excerpt/imageUrl/siteName populated.
 *  - `failed`   — crawl returned failed/unsupported, or the URL was SSRF-blocked.
 * Terminal = `crawled` | `failed`; a card polls only while it is `pending`. */
export const EmailLinkStatusSchema = z.enum(["pending", "crawled", "failed"]);
export type EmailLinkStatus = z.infer<typeof EmailLinkStatusSchema>;
