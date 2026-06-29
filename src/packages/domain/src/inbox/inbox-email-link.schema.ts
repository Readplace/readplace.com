import { z } from "zod";

/** Width of the zero-padded ordinal. Single source of truth for the regex below
 * and the per-email link cap: extraction renders each link's index as this many
 * digits, so the width fixes the largest ordinal — and the largest safe cap. */
const EMAIL_LINK_ORDINAL_DIGITS = 4;

/** Most links one email may extract before an index overflows the ordinal width.
 * `EMAIL_LINK_ORDINAL_DIGITS` digits represent indices `0`…`10^d - 1`, and the
 * last index is `maxLinks - 1`, so a cap of `10^d` is the largest that still
 * parses. The extract-email-links composition root asserts `maxLinks` stays at
 * or below this, so a higher cap can't mint an unparseable 5-digit ordinal. */
export const MAX_EMAIL_LINKS_PER_EMAIL = 10 ** EMAIL_LINK_ORDINAL_DIGITS;

/** Stable per-link ordinal within one email: the zero-padded index of the link
 * in extraction order. Branded so a raw string can't stand in; it doubles as the
 * DynamoDB sort key, so links list back in body order. */
export const EmailLinkOrdinalSchema = z
	.string()
	.regex(new RegExp(`^\\d{${EMAIL_LINK_ORDINAL_DIGITS}}$`))
	.brand<"EmailLinkOrdinal">();
export type EmailLinkOrdinal = z.infer<typeof EmailLinkOrdinalSchema>;

/** Crawl-preview lifecycle. Data-state words, contrasting "pending"/"staging":
 *  - `pending`  — extracted, not yet crawled (the only non-terminal state).
 *  - `crawled`  — crawl succeeded; title/excerpt/imageUrl/siteName populated.
 *  - `failed`   — crawl returned failed/unsupported, or the URL was SSRF-blocked.
 * Terminal = `crawled` | `failed`; a card polls only while it is `pending`. */
export const EmailLinkStatusSchema = z.enum(["pending", "crawled", "failed"]);
export type EmailLinkStatus = z.infer<typeof EmailLinkStatusSchema>;
