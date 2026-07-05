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
}) => Promise<{ trialEndsAt?: string }>;

export type DeleteCustomer = (input: { customerId: string }) => Promise<void>;

export const STRIPE_SUBSCRIPTION_STATUSES = [
	"incomplete",
	"incomplete_expired",
	"trialing",
	"active",
	"past_due",
	"canceled",
	"unpaid",
	"paused",
] as const;

export type StripeSubscriptionStatus = (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];

export type StripeSubscriptionSummary = {
	subscriptionId: string;
	customerId: string;
	status: StripeSubscriptionStatus;
	customerEmail?: string;
};

export type ListAllStripeSubscriptions = () => Promise<StripeSubscriptionSummary[]>;
