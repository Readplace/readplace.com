import { normalizeEmail } from "@packages/domain/user";
import type { CheckoutSessionId } from "@packages/provider-contracts/hosted-checkout";
import type {
	ClaimPendingSignup,
	DeletePendingSignupsByUser,
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
	claimPendingSignup: ClaimPendingSignup;
	deleteByUser: DeletePendingSignupsByUser;
} {
	const store = new Map<CheckoutSessionId, StoredEntry>();

	const storePendingSignup: StorePendingSignup = async ({ checkoutSessionId, signup, createdAt }) => {
		store.set(checkoutSessionId, { signup, createdAt, claimed: false });
	};

	const claimPendingSignup: ClaimPendingSignup = async ({ checkoutSessionId }) => {
		const entry = store.get(checkoutSessionId);
		if (!entry) return { outcome: "not-found" };
		if (entry.claimed) {
			return {
				outcome: "already-activated",
				...(entry.signup.returnUrl ? { returnUrl: entry.signup.returnUrl } : {}),
			};
		}
		entry.claimed = true;
		return { outcome: "claimed", signup: entry.signup };
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
		claimPendingSignup,
		deleteByUser,
	};
}
