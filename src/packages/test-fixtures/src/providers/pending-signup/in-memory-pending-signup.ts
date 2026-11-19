import assert from "node:assert";
import { normalizeEmail } from "@packages/domain/user";
import type { CheckoutSessionId } from "@packages/provider-contracts/hosted-checkout";
import type {
	ClaimPendingSignup,
	DeletePendingSignupsByUser,
	FindPendingSignup,
	PendingSignup,
	StorePendingSignup,
} from "@packages/provider-contracts/pending-signup";

interface StoredEntry {
	signup: PendingSignup;
	createdAt?: number;
	claimed: boolean;
}

export function initInMemoryPendingSignup(): {
	storePendingSignup: StorePendingSignup;
	findPendingSignup: FindPendingSignup;
	claimPendingSignup: ClaimPendingSignup;
	deleteByUser: DeletePendingSignupsByUser;
} {
	const store = new Map<CheckoutSessionId, StoredEntry>();

	const storePendingSignup: StorePendingSignup = async ({ checkoutSessionId, signup, createdAt }) => {
		store.set(checkoutSessionId, { signup, createdAt, claimed: false });
	};

	const findPendingSignup: FindPendingSignup = async (checkoutSessionId) => {
		const entry = store.get(checkoutSessionId);
		if (!entry) return { outcome: "not-found" };
		if (entry.claimed) {
			return {
				outcome: "already-activated",
				...(entry.signup.returnUrl ? { returnUrl: entry.signup.returnUrl } : {}),
			};
		}
		return { outcome: "pending", signup: entry.signup };
	};

	const claimPendingSignup: ClaimPendingSignup = async ({ checkoutSessionId }) => {
		const lookup = await findPendingSignup(checkoutSessionId);
		if (lookup.outcome !== "pending") return lookup;
		const entry = store.get(checkoutSessionId);
		assert(entry, "a pending lookup implies a stored entry");
		entry.claimed = true;
		return { outcome: "claimed", signup: lookup.signup };
	};

	const deleteByUser: DeletePendingSignupsByUser = async ({ userId, email }) => {
		const normalizedEmail = email === null ? null : normalizeEmail(email);
		for (const [checkoutSessionId, entry] of store) {
			const matchesUser = entry.signup.userId === userId;
			const matchesEmail =
				normalizedEmail !== null && normalizeEmail(entry.signup.email) === normalizedEmail;
			if (matchesUser || matchesEmail) store.delete(checkoutSessionId);
		}
	};

	return {
		storePendingSignup,
		findPendingSignup,
		claimPendingSignup,
		deleteByUser,
	};
}
