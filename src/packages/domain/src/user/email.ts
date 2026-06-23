import assert from "node:assert";
import { z } from "zod";

// Plus aliases (user+tag@example.com) are intentionally preserved because some
// providers treat them as distinct mailboxes, not as aliases of the base address.
// Precondition: email must contain "@" (enforced by Zod schema validation upstream)
export function normalizeEmail(email: string): string {
	return email.toLowerCase().trim();
}

const CanonicalEmailSchema = z.string().brand<"CanonicalEmail">();

/**
 * The identity key for an account — NOT a delivery address. `canonicalizeEmail`
 * collapses the many Gmail spellings of one mailbox (dots, +tags, googlemail.com)
 * onto a single key so they cannot become separate accounts. Mail must always be
 * sent to the address the user actually typed (see `normalizeEmail`), never to this key.
 */
export type CanonicalEmail = z.infer<typeof CanonicalEmailSchema>;

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

const GMAIL_PLAINTEXT_BASE = /^[A-Za-z0-9.]+$/;

interface Identity {
	canonical: CanonicalEmail;
	gmailCollapsed: boolean;
}

function parseIdentity(raw: string): Identity {
	const trimmed = raw.trim();
	const at = trimmed.lastIndexOf("@");
	assert(at > 0, "Email is missing a local part");
	assert(at < trimmed.length - 1, "Email is missing a domain");

	const local = trimmed.slice(0, at);
	const loweredDomain = trimmed.slice(at + 1).toLowerCase();
	const domain = loweredDomain.endsWith(".") ? loweredDomain.slice(0, -1) : loweredDomain;

	if (!GMAIL_DOMAINS.has(domain)) {
		return { canonical: CanonicalEmailSchema.parse(`${local}@${domain}`), gmailCollapsed: false };
	}

	const plusIndex = local.indexOf("+");
	const base = plusIndex === -1 ? local : local.slice(0, plusIndex);

	if (base.length > 0 && !GMAIL_PLAINTEXT_BASE.test(base)) {
		return { canonical: CanonicalEmailSchema.parse(`${local}@gmail.com`), gmailCollapsed: false };
	}

	const canonical = base.toLowerCase().replaceAll(".", "");
	assert(canonical.length > 0, "Gmail address has no local part before the tag");

	return { canonical: CanonicalEmailSchema.parse(`${canonical}@gmail.com`), gmailCollapsed: true };
}

export function canonicalizeEmail(raw: string): CanonicalEmail {
	return parseIdentity(raw).canonical;
}

/**
 * The uniqueness-claim key for a Gmail mailbox, or null for any address whose
 * lower-cased delivery key already enforces uniqueness on its own (every
 * non-Gmail address, and quoted/non-ASCII Gmail locals). Returns a key only
 * where the canonical form is stronger than the delivery key, so one account is
 * claimed per Gmail mailbox across its dotted/+tagged/googlemail spellings.
 */
export function gmailIdentityKey(raw: string): CanonicalEmail | null {
	const { canonical, gmailCollapsed } = parseIdentity(raw);
	return gmailCollapsed ? canonical : null;
}
