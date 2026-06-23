// Plus aliases (user+tag@example.com) are intentionally preserved because some
// providers treat them as distinct mailboxes, not as aliases of the base address.
// Precondition: email must contain "@" (enforced by Zod schema validation upstream)
export function normalizeEmail(email: string): string {
	return email.toLowerCase().trim();
}
