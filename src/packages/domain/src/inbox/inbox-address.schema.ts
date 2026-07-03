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

/** The user-chosen label in a forwarding address — the human-readable prefix in
 * `<alias>-<token>@<domain>` (e.g. `netflix` in `netflix-a7b2c9@read.place`).
 * Lowercase alphanumerics with single internal hyphens (no leading, trailing, or
 * doubled hyphen), 1–24 chars. Kept email-safe so it reads cleanly as a local
 * part and can never smuggle a second `@` or `.` into the address. */
export const AliasNameSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.max(24)
	.brand<"AliasName">();

export type AliasName = z.infer<typeof AliasNameSchema>;

/** A full forwarding address, `<alias>-<token>@<domain>`. Branded so a raw
 * string can't stand in for one without passing through the parser. The trailing
 * `-<token>` is the six-char random suffix by construction, so an address is a
 * strict generalization of the legacy `in-<token>` form (alias = `in`). */
export const InboxAddressSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-z]{6}@[a-z0-9.-]+$/)
	.brand<"InboxAddress">();

export type InboxAddress = z.infer<typeof InboxAddressSchema>;

export const INBOX_TOKEN_LENGTH = 6;
const INBOX_TOKEN_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Attempts the conditional-put address creation makes before giving up. A
 * collision at the 2.2B keyspace is already vanishingly rare; exhausting this
 * many retries signals a real fault, so the caller throws rather than degrading
 * silently. */
export const INBOX_ADDRESS_MAX_CREATE_ATTEMPTS = 5;

/** Upper bound on the *live* addresses one user may hold. Without it a create
 * loop — e.g. an account hammering POST /inbox/create — mints rows without
 * limit, and every row is permanent (a freed hash could be re-minted for
 * another user and leak their mail, so disabling stamps `disabledAt` rather
 * than deleting). Counting only live rows caps the active footprint.
 * Generous enough that honest one-per-newsletter use never reaches it. */
export const INBOX_ADDRESS_MAX_PER_USER = 25;

/** Raised when a user is already at {@link INBOX_ADDRESS_MAX_PER_USER}. Distinct
 * from a minting fault so callers can surface a friendly limit message without
 * logging an alerting-worthy error. */
export class InboxAddressLimitReachedError extends Error {
	constructor(readonly limit: number) {
		super(`Inbox address limit of ${limit} reached`);
		this.name = "InboxAddressLimitReachedError";
	}
}

/** randomInt is unbiased (rejection-sampled), so each character is drawn
 * uniformly from the 36-symbol alphabet — no modulo skew. */
export function generateInboxToken(): InboxToken {
	const chars = Array.from(
		{ length: INBOX_TOKEN_LENGTH },
		() => INBOX_TOKEN_ALPHABET[randomInt(INBOX_TOKEN_ALPHABET.length)],
	);
	return InboxTokenSchema.parse(chars.join(""));
}

export function buildInboxAddress(input: {
	name: AliasName;
	token: InboxToken;
	domain: string;
}): InboxAddress {
	return InboxAddressSchema.parse(`${input.name}-${input.token}@${input.domain}`);
}

/** Recover the alias label from a stored address. Used to backfill a label for a
 * legacy `in-<token>` row written before the `name` column existed. The address
 * is `<alias>-<token>@…` by construction (guaranteed by {@link
 * InboxAddressSchema}), so the label is the local part with the trailing
 * `-<token>` removed. */
export function aliasNameFromAddress(address: InboxAddress): AliasName {
	const localPart = address.slice(0, address.indexOf("@"));
	return AliasNameSchema.parse(localPart.slice(0, localPart.lastIndexOf("-")));
}

/** The single normalization seam for a user-typed alias. Lowercases, collapses
 * every run of non-alphanumerics to one hyphen, truncates to the max length, and
 * trims leading/trailing hyphens, then validates. Returns `undefined` when no
 * valid label survives (empty, whitespace-only, or emoji-only input) so callers
 * can reject rather than mint a nameless address. */
export function normalizeAliasName(raw: string): AliasName | undefined {
	const normalized = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 24)
		.replace(/^-+|-+$/g, "");
	const parsed = AliasNameSchema.safeParse(normalized);
	return parsed.success ? parsed.data : undefined;
}

/** The alias every account's first forwarding address is minted under at signup,
 * so a brand-new user lands on `inbox-<token>@…` without having to name one. */
export const DEFAULT_INBOX_ALIAS: AliasName = AliasNameSchema.parse("inbox");
