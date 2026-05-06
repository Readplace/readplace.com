import type { CheckoutSessionId } from "../stripe-checkout/stripe-checkout.types";
import type {
	ConsumePendingSignup,
	ListAllPendingSignups,
	MarkCheckoutRecoveryEmailSent,
	PendingSignup,
	StorePendingSignup,
} from "./pending-signup.types";

interface StoredEntry {
	signup: PendingSignup;
	checkoutRecoveryEmailSentAt?: number;
}

export function initInMemoryPendingSignup(): {
	storePendingSignup: StorePendingSignup;
	consumePendingSignup: ConsumePendingSignup;
	listAllPendingSignups: ListAllPendingSignups;
	markCheckoutRecoveryEmailSent: MarkCheckoutRecoveryEmailSent;
} {
	const store = new Map<CheckoutSessionId, StoredEntry>();

	const storePendingSignup: StorePendingSignup = async ({ checkoutSessionId, signup }) => {
		store.set(checkoutSessionId, { signup });
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

	return {
		storePendingSignup,
		consumePendingSignup,
		listAllPendingSignups,
		markCheckoutRecoveryEmailSent,
	};
}
