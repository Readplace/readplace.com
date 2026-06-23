import { randomInt } from "node:crypto";
import { z } from "zod";

/** Opaque per-newsletter token in a forwarding address. Six lowercase base36
 * characters (a–z0–9) — short enough to be memorable/typeable, ~2.2B
 * combinations. Disposable and disable-able, so the smaller keyspace (vs a
 * 128-bit token) is an accepted trade-off; creation guards uniqueness with a
 * conditional put + bounded retry. */
export const InboxTokenSchema = z
	.string()
	.regex(/^[0-9a-z]{6}$/)
	.brand<"InboxToken">();

export type InboxToken = z.infer<typeof InboxTokenSchema>;

/** A full forwarding address, `in-<token>@<domain>`. Branded so a raw string
 * can't stand in for one without passing through the parser. */
export const InboxAddressSchema = z
	.string()
	.regex(/^in-[0-9a-z]{6}@[a-z0-9.-]+$/)
	.brand<"InboxAddress">();

export type InboxAddress = z.infer<typeof InboxAddressSchema>;

export const INBOX_TOKEN_LENGTH = 6;
const INBOX_TOKEN_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Attempts the conditional-put address creation makes before giving up. A
 * collision at the 2.2B keyspace is already vanishingly rare; exhausting this
 * many retries signals a real fault, so the caller throws rather than degrading
 * silently. */
export const INBOX_ADDRESS_MAX_CREATE_ATTEMPTS = 5;

/** randomInt is unbiased (rejection-sampled), so each character is drawn
 * uniformly from the 36-symbol alphabet — no modulo skew. */
export function generateInboxToken(): InboxToken {
	const chars = Array.from(
		{ length: INBOX_TOKEN_LENGTH },
		() => INBOX_TOKEN_ALPHABET[randomInt(INBOX_TOKEN_ALPHABET.length)],
	);
	return InboxTokenSchema.parse(chars.join(""));
}

export function buildInboxAddress(input: { token: InboxToken; domain: string }): InboxAddress {
	return InboxAddressSchema.parse(`in-${input.token}@${input.domain}`);
}
