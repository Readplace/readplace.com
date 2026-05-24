/* c8 ignore start -- type-only file, no runtime code */
export type CancelSubscriptionImmediately = (input: {
	subscriptionId: string;
}) => Promise<void>;

export type CreateSubscriptionOnExistingCustomer = (input: {
	customerId: string;
	priceId: string;
}) => Promise<{ subscriptionId: string }>;
/* c8 ignore stop */
