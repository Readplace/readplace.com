import type { UserId } from "@packages/domain/user";

export type CancelSubscriptionImmediately = (input: {
	subscriptionId: string;
}) => Promise<void>;

export type CreateSubscriptionOnExistingCustomer = (input: {
	customerId: string;
	priceId: string;
	userId: UserId;
}) => Promise<{ subscriptionId: string }>;

export type ScheduleCancellationAtPeriodEnd = (input: {
	subscriptionId: string;
}) => Promise<{ cancellationEffectiveAt: string }>;

export type ReverseScheduledCancellation = (input: {
	subscriptionId: string;
}) => Promise<void>;

export type DeleteCustomer = (input: { customerId: string }) => Promise<void>;
