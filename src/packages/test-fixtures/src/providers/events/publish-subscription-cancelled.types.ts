import type { UserId } from "@packages/domain/user";

export type SubscriptionCancelledReason =
	| "stripe_webhook"
	| "user_initiated_trial"
	| "user_initiated_paid_confirmed";

export type PublishSubscriptionCancelled = (params: {
	userId: UserId;
	subscriptionId?: string;
	reason: SubscriptionCancelledReason;
}) => Promise<void>;
