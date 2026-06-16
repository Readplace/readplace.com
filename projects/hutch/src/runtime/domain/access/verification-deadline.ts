/** New accounts must verify their email within this window of registering.
 * After it lapses the account is locked and only support can restore access.
 * Kept in lockstep with the verification-token TTL so the single link mailed at
 * signup stays valid for the whole countdown. */
export const VERIFICATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Verification standing of an *unverified* account. Verified accounts never
 * carry a status — the absence of one is what the banner reads as "verified".
 * `pending` is the legacy fallback for rows written before `registeredAt`
 * existed: no anchor means no countdown and, crucially, no lockout. */
export type VerificationStatus =
	| { state: "pending" }
	| { state: "counting-down"; daysLeft: number }
	| { state: "locked" };

/** Days are rounded up so a partial final day still reads as "1 day left"
 * rather than "0"; the account only flips to `locked` once the deadline has
 * actually passed. */
export function computeVerificationStatus(input: {
	registeredAt: string | undefined;
	now: Date;
}): VerificationStatus {
	if (!input.registeredAt) return { state: "pending" };
	const registeredMs = Date.parse(input.registeredAt);
	if (Number.isNaN(registeredMs)) return { state: "pending" };

	const remainingMs = registeredMs + VERIFICATION_WINDOW_MS - input.now.getTime();
	if (remainingMs <= 0) return { state: "locked" };
	return { state: "counting-down", daysLeft: Math.ceil(remainingMs / ONE_DAY_MS) };
}
