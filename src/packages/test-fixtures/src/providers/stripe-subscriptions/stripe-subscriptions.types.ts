/* c8 ignore start -- type-only file, no runtime code */
export type CancelSubscriptionImmediately = (input: {
	subscriptionId: string;
}) => Promise<void>;

export type CreateStripeCustomer = (input: {
	email: string;
	userId: string;
}) => Promise<{ customerId: string }>;

export type SetDefaultPaymentMethod = (input: {
	customerId: string;
	paymentMethodId: string;
}) => Promise<void>;

export type CreateSubscriptionResult =
	| { status: "succeeded"; subscriptionId: string }
	| { status: "requires_action" | "payment_failed"; reason: string };

export type CreateSubscriptionOnExistingCustomer = (input: {
	customerId: string;
	priceId: string;
	idempotencyKey?: string;
	defaultPaymentMethodId?: string;
}) => Promise<{ subscriptionId: string }>;

export type ScheduleCancellationAtPeriodEnd = (input: {
	subscriptionId: string;
}) => Promise<{ cancellationEffectiveAt: string }>;

export type ReverseScheduledCancellation = (input: {
	subscriptionId: string;
}) => Promise<void>;

/** Strict variant used by the trial-end charge handler — surfaces SCA
 * `requires_action` and other non-throwing failures explicitly so the handler
 * can persist the reason without depending on Error message parsing. */
export type CreateSubscriptionWithOffSessionPayment = (input: {
	customerId: string;
	priceId: string;
	defaultPaymentMethodId: string;
	idempotencyKey: string;
}) => Promise<CreateSubscriptionResult>;
/* c8 ignore stop */
