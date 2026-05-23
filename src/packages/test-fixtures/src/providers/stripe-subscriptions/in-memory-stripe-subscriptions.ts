import type { CancelSubscriptionImmediately } from "./stripe-subscriptions.types";

export function initInMemoryStripeSubscriptions(): {
	cancelImmediately: CancelSubscriptionImmediately;
	cancelledSubscriptionIds: () => readonly string[];
} {
	const cancelled: string[] = [];

	const cancelImmediately: CancelSubscriptionImmediately = async ({ subscriptionId }) => {
		cancelled.push(subscriptionId);
	};

	return {
		cancelImmediately,
		cancelledSubscriptionIds: () => [...cancelled],
	};
}
