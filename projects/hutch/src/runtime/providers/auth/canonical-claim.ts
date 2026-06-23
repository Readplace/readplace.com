import type { CanonicalEmail } from "@packages/domain/user";

/* Gmail uniqueness claims share the users table under this prefix. Zod rejects
 * "#" in emails, so a claim PK can never collide with a delivery-email PK. */
const CLAIM_PK_PREFIX = "canonical#";

export function gmailClaimPk(canonical: CanonicalEmail): string {
	return `${CLAIM_PK_PREFIX}${canonical}`;
}

export function isClaimPk(email: string): boolean {
	return email.startsWith(CLAIM_PK_PREFIX);
}
