import type { CheckoutSessionId } from "@packages/provider-contracts/stripe-checkout";
import type {
	ConsumePendingSignup,
	DeletePendingSignupsByUserId,
	ListAllPendingSignups,
	MarkCheckoutRecoveryEmailSent,
	PendingSignup,
	StorePendingSignup,
} from "@packages/provider-contracts/pending-signup";

interface StoredEntry {
	signup: PendingSignup;
	createdAt?: number;
	checkoutRecoveryEmailSentAt?: number;
}

export function initInMemoryPendingSignup(): {
	storePendingSignup: StorePendingSignup;
	consumePendingSignup: ConsumePendingSignup;
	listAllPendingSignups: ListAllPendingSignups;
	markCheckoutRecoveryEmailSent: MarkCheckoutRecoveryEmailSent;
	deleteByUserId: DeletePendingSignupsByUserId;
} {
	const store = new Map<CheckoutSessionId, StoredEntry>();

	const storePendingSignup: StorePendingSignup = async ({ checkoutSessionId, signup, createdAt }) => {
		store.set(checkoutSessionId, { signup, createdAt });
	};

	const consumePendingSignup: ConsumePendingSignup = async (checkoutSessionId) => {
		const entry = store.get(checkoutSessionId);
		if (!entry) return null;
		store.delete(checkoutSessionId);
		return entry.signup;
	};

	const listAllPendingSignups: ListAllPendingSignups = async () =>
		Array.from(store.entries()).map(([checkoutSessionId, entry]) => ({
			checkoutSessionId,
			email: entry.signup.email,
			...(entry.createdAt !== undefined ? { createdAt: entry.createdAt } : {}),
			...(entry.checkoutRecoveryEmailSentAt !== undefined
				? { checkoutRecoveryEmailSentAt: entry.checkoutRecoveryEmailSentAt }
				: {}),
		}));

	const markCheckoutRecoveryEmailSent: MarkCheckoutRecoveryEmailSent = async ({
		checkoutSessionId,
		sentAt,
	}) => {
		const entry = store.get(checkoutSessionId);
		if (!entry) throw new Error(`No pending signup: ${checkoutSessionId}`);
		entry.checkoutRecoveryEmailSentAt = sentAt;
	};

	const deleteByUserId: DeletePendingSignupsByUserId = async (userId) => {
		for (const [checkoutSessionId, entry] of store) {
			if (entry.signup.userId === userId) store.delete(checkoutSessionId);
		}
	};

	return {
		storePendingSignup,
		consumePendingSignup,
		listAllPendingSignups,
		markCheckoutRecoveryEmailSent,
		deleteByUserId,
	};
}
