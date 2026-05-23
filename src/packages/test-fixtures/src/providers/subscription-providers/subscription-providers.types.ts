/* c8 ignore start -- type-only file, no runtime code */
import type { UserId } from "@packages/domain/user";

export type SubscriptionStatus =
	| "trialing"
	| "active"
	| "pending_cancellation"
	| "cancelled";

export interface SubscriptionRecord {
	userId: UserId;
	provider: "stripe";
	subscriptionId?: string;
	customerId?: string;
	status: SubscriptionStatus;
	trialEndsAt?: string;
	cancellationEffectiveAt?: string;
	createdAt: string;
	updatedAt: string;
}

export type FindSubscriptionByUserId = (
	userId: UserId,
) => Promise<SubscriptionRecord | undefined>;

export type FindSubscriptionBySubscriptionId = (
	subscriptionId: string,
) => Promise<SubscriptionRecord | undefined>;

export type UpsertTrialingSubscription = (input: {
	userId: UserId;
	trialEndsAt: string;
}) => Promise<void>;

export type UpsertActiveSubscription = (input: {
	userId: UserId;
	subscriptionId: string;
	customerId: string;
}) => Promise<void>;

export type MarkSubscriptionPendingCancellation = (input: {
	userId: UserId;
	cancellationEffectiveAt: string;
}) => Promise<void>;

export type MarkSubscriptionCancelled = (input: {
	subscriptionId: string;
}) => Promise<void>;

export type MarkSubscriptionCancelledByUserId = (input: {
	userId: UserId;
}) => Promise<void>;

export type MarkSubscriptionActive = (input: { userId: UserId }) => Promise<void>;
/* c8 ignore stop */
