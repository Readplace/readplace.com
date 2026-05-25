import type {
	CancelSubscriptionImmediately,
	CreateStripeCustomer,
	CreateSubscriptionOnExistingCustomer,
	CreateSubscriptionWithOffSessionPayment,
	ReverseScheduledCancellation,
	ScheduleCancellationAtPeriodEnd,
	SetDefaultPaymentMethod,
} from "./stripe-subscriptions.types";

/** Fixed cancellationEffectiveAt for the in-memory provider. Tests that need a
 * specific period-end can override it via `scheduleCancellationAtPeriodEndReturns`. */
const DEFAULT_PERIOD_END = "2026-06-22T10:00:00.000Z";

export function initInMemoryStripeSubscriptions(opts?: {
	createSubscriptionFails?: boolean;
	createSubscriptionResult?: "succeeded" | "requires_action" | "payment_failed";
	scheduleCancellationFails?: boolean;
	reverseScheduledCancellationFails?: boolean;
	scheduleCancellationAtPeriodEndReturns?: string;
}): {
	cancelImmediately: CancelSubscriptionImmediately;
	createStripeCustomer: CreateStripeCustomer;
	setDefaultPaymentMethod: SetDefaultPaymentMethod;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	createSubscriptionWithOffSessionPayment: CreateSubscriptionWithOffSessionPayment;
	scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	cancelledSubscriptionIds: () => readonly string[];
	createdCustomers: () => readonly { email: string; userId: string; customerId: string }[];
	defaultPaymentMethodAssignments: () => readonly { customerId: string; paymentMethodId: string }[];
	createdSubscriptions: () => readonly {
		customerId: string;
		priceId: string;
		subscriptionId: string;
		defaultPaymentMethodId?: string;
		idempotencyKey?: string;
	}[];
	scheduledCancellations: () => readonly { subscriptionId: string; cancellationEffectiveAt: string }[];
	reversedCancellations: () => readonly string[];
} {
	const cancelled: string[] = [];
	const customers: { email: string; userId: string; customerId: string }[] = [];
	const defaultPaymentMethods: { customerId: string; paymentMethodId: string }[] = [];
	const created: {
		customerId: string;
		priceId: string;
		subscriptionId: string;
		defaultPaymentMethodId?: string;
		idempotencyKey?: string;
	}[] = [];
	const scheduledCancellationCalls: { subscriptionId: string; cancellationEffectiveAt: string }[] = [];
	const reversed: string[] = [];
	let nextSubId = 1;
	let nextCustomerId = 1;

	const cancelImmediately: CancelSubscriptionImmediately = async ({ subscriptionId }) => {
		cancelled.push(subscriptionId);
	};

	const createStripeCustomer: CreateStripeCustomer = async ({ email, userId }) => {
		const customerId = `cus_inmem_${nextCustomerId++}`;
		customers.push({ email, userId, customerId });
		return { customerId };
	};

	const setDefaultPaymentMethod: SetDefaultPaymentMethod = async ({ customerId, paymentMethodId }) => {
		defaultPaymentMethods.push({ customerId, paymentMethodId });
	};

	const createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer = async ({
		customerId,
		priceId,
		idempotencyKey,
		defaultPaymentMethodId,
	}) => {
		if (opts?.createSubscriptionFails) {
			throw new Error("In-memory Stripe createSubscription failure");
		}
		const subscriptionId = `sub_inmem_${nextSubId++}`;
		const record: typeof created[number] = { customerId, priceId, subscriptionId };
		if (defaultPaymentMethodId !== undefined) record.defaultPaymentMethodId = defaultPaymentMethodId;
		if (idempotencyKey !== undefined) record.idempotencyKey = idempotencyKey;
		created.push(record);
		return { subscriptionId };
	};

	const createSubscriptionWithOffSessionPayment: CreateSubscriptionWithOffSessionPayment = async ({
		customerId,
		priceId,
		defaultPaymentMethodId,
		idempotencyKey,
	}) => {
		const outcome = opts?.createSubscriptionResult ?? "succeeded";
		if (outcome === "requires_action") {
			return { status: "requires_action", reason: "requires_action" };
		}
		if (outcome === "payment_failed") {
			return { status: "payment_failed", reason: "card_declined" };
		}
		if (opts?.createSubscriptionFails) {
			throw new Error("In-memory Stripe createSubscription failure");
		}
		const subscriptionId = `sub_inmem_${nextSubId++}`;
		created.push({ customerId, priceId, subscriptionId, defaultPaymentMethodId, idempotencyKey });
		return { status: "succeeded", subscriptionId };
	};

	const scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd = async ({
		subscriptionId,
	}) => {
		if (opts?.scheduleCancellationFails) {
			throw new Error("In-memory Stripe scheduleCancellationAtPeriodEnd failure");
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
			throw new Error("In-memory Stripe reverseScheduledCancellation failure");
		}
		reversed.push(subscriptionId);
	};

	return {
		cancelImmediately,
		createStripeCustomer,
		setDefaultPaymentMethod,
		createSubscriptionOnExistingCustomer,
		createSubscriptionWithOffSessionPayment,
		scheduleCancellationAtPeriodEnd,
		reverseScheduledCancellation,
		cancelledSubscriptionIds: () => [...cancelled],
		createdCustomers: () => [...customers],
		defaultPaymentMethodAssignments: () => [...defaultPaymentMethods],
		createdSubscriptions: () => [...created],
		scheduledCancellations: () => [...scheduledCancellationCalls],
		reversedCancellations: () => [...reversed],
	};
}
