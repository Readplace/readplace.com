import type {
	CancelSubscriptionImmediately,
	CreateSubscriptionOnExistingCustomer,
} from "./stripe-subscriptions.types";

export function initInMemoryStripeSubscriptions(opts?: {
	createSubscriptionFails?: boolean;
}): {
	cancelImmediately: CancelSubscriptionImmediately;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	cancelledSubscriptionIds: () => readonly string[];
	createdSubscriptions: () => readonly { customerId: string; priceId: string; subscriptionId: string }[];
} {
	const cancelled: string[] = [];
	const created: { customerId: string; priceId: string; subscriptionId: string }[] = [];
	let nextId = 1;

	const cancelImmediately: CancelSubscriptionImmediately = async ({ subscriptionId }) => {
		cancelled.push(subscriptionId);
	};

	const createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer = async ({
		customerId,
		priceId,
	}) => {
		if (opts?.createSubscriptionFails) {
			throw new Error("In-memory Stripe createSubscription failure");
		}
		const subscriptionId = `sub_inmem_${nextId++}`;
		created.push({ customerId, priceId, subscriptionId });
		return { subscriptionId };
	};

	return {
		cancelImmediately,
		createSubscriptionOnExistingCustomer,
		cancelledSubscriptionIds: () => [...cancelled],
		createdSubscriptions: () => [...created],
	};
}
