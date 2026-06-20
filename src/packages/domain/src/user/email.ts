import assert from "node:assert";
import { z } from "zod";

const CanonicalEmailSchema = z.string().brand<"CanonicalEmail">();

/**
 * The identity key for an account — NOT a delivery address. `canonicalizeEmail`
 * collapses the many Gmail spellings of one mailbox (dots, +tags, googlemail.com)
 * onto a single key so they cannot become separate accounts. Mail must always be
 * sent to the address the user actually typed (see `normalizeEmail`), never to this key.
 */
export type CanonicalEmail = z.infer<typeof CanonicalEmailSchema>;

// Plus aliases (user+tag@example.com) are intentionally preserved because some
// providers treat them as distinct mailboxes, not as aliases of the base address.
// Precondition: email must contain "@" (enforced by Zod schema validation upstream)
export function normalizeEmail(email: string): string {
	return email.toLowerCase().trim();
}

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

const GMAIL_PLAINTEXT_LOCAL = /^[A-Za-z0-9.+]+$/;

export function canonicalizeEmail(raw: string): CanonicalEmail {
	const trimmed = raw.trim();
	const at = trimmed.lastIndexOf("@");
	assert(at > 0, `Email is missing a local part: ${raw}`);
	assert(at < trimmed.length - 1, `Email is missing a domain: ${raw}`);

	const local = trimmed.slice(0, at);
	const loweredDomain = trimmed.slice(at + 1).toLowerCase();
	const domain = loweredDomain.endsWith(".") ? loweredDomain.slice(0, -1) : loweredDomain;

	if (!GMAIL_DOMAINS.has(domain)) {
		return CanonicalEmailSchema.parse(`${local}@${domain}`);
	}

	if (!GMAIL_PLAINTEXT_LOCAL.test(local)) {
		return CanonicalEmailSchema.parse(`${local}@gmail.com`);
	}

	const lowered = local.toLowerCase();
	const plusIndex = lowered.indexOf("+");
	const beforePlus = plusIndex === -1 ? lowered : lowered.slice(0, plusIndex);
	const base = beforePlus.replaceAll(".", "");
	assert(base.length > 0, `Gmail address has no local part before the tag: ${raw}`);

	return CanonicalEmailSchema.parse(`${base}@gmail.com`);
}
