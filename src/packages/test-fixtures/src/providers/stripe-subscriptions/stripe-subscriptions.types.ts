/* c8 ignore start -- type-only file, no runtime code */
export type CancelSubscriptionImmediately = (input: {
	subscriptionId: string;
}) => Promise<void>;

export type CreateSubscriptionOnExistingCustomer = (input: {
	customerId: string;
	priceId: string;
}) => Promise<{ subscriptionId: string }>;

export type ScheduleCancellationAtPeriodEnd = (input: {
	subscriptionId: string;
}) => Promise<{ cancellationEffectiveAt: string }>;

export type ReverseScheduledCancellation = (input: {
	subscriptionId: string;
}) => Promise<void>;
/* c8 ignore stop */
