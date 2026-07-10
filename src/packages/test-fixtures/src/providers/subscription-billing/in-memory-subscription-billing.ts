import type { UserId } from "@packages/domain/user";
import type {
	CancelSubscriptionImmediately,
	CreateSubscriptionOnExistingCustomer,
	ReverseScheduledCancellation,
	ScheduleCancellationAtPeriodEnd,
} from "@packages/provider-contracts/subscription-billing";

/** Fixed cancellationEffectiveAt for the in-memory provider. Tests that need a
 * specific period-end can override it via `scheduleCancellationAtPeriodEndReturns`. */
const DEFAULT_PERIOD_END = "2026-06-22T10:00:00.000Z";

export function initInMemorySubscriptionBilling(opts?: {
	createSubscriptionFails?: boolean;
	scheduleCancellationFails?: boolean;
	reverseScheduledCancellationFails?: boolean;
	scheduleCancellationAtPeriodEndReturns?: string;
}): {
	cancelImmediately: CancelSubscriptionImmediately;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	cancelledSubscriptionIds: () => readonly string[];
	createdSubscriptions: () => readonly {
		customerId: string;
		priceId: string;
		userId: UserId;
		subscriptionId: string;
	}[];
	scheduledCancellations: () => readonly { subscriptionId: string; cancellationEffectiveAt: string }[];
	reversedCancellations: () => readonly string[];
} {
	const cancelled: string[] = [];
	const created: { customerId: string; priceId: string; userId: UserId; subscriptionId: string }[] =
		[];
	const scheduledCancellationCalls: { subscriptionId: string; cancellationEffectiveAt: string }[] = [];
	const reversed: string[] = [];
	let nextId = 1;

	const cancelImmediately: CancelSubscriptionImmediately = async ({ subscriptionId }) => {
		cancelled.push(subscriptionId);
	};

	const createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer = async ({
		customerId,
		priceId,
		userId,
	}) => {
		if (opts?.createSubscriptionFails) {
			throw new Error("In-memory billing createSubscription failure");
		}
		const subscriptionId = `sub_inmem_${nextId++}`;
		created.push({ customerId, priceId, userId, subscriptionId });
		return { subscriptionId };
	};

	const scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd = async ({
		subscriptionId,
	}) => {
		if (opts?.scheduleCancellationFails) {
			throw new Error("In-memory billing scheduleCancellationAtPeriodEnd failure");
		}
		const cancellationEffectiveAt =
			opts?.scheduleCancellationAtPeriodEndReturns ?? DEFAULT_PERIOD_END;
		scheduledCancellationCalls.push({ subscriptionId, cancellationEffectiveAt });
		return { cancellationEffectiveAt };
	};

	const reverseScheduledCancellation: ReverseScheduledCancellation = async ({
		subscriptionId,
	}) => {
		if (opts?.reverseScheduledCancellationFails) {
			throw new Error("In-memory billing reverseScheduledCancellation failure");
		}
		reversed.push(subscriptionId);
	};

	return {
		cancelImmediately,
		createSubscriptionOnExistingCustomer,
		scheduleCancellationAtPeriodEnd,
		reverseScheduledCancellation,
		cancelledSubscriptionIds: () => [...cancelled],
		createdSubscriptions: () => [...created],
		scheduledCancellations: () => [...scheduledCancellationCalls],
		reversedCancellations: () => [...reversed],
	};
}
