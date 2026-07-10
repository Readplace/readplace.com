import { z } from "zod";
import type { UserId } from "@packages/domain/user";

export const SubscriptionProviderSchema = z.enum(["stripe"]);
export type SubscriptionProvider = z.infer<typeof SubscriptionProviderSchema>;

export type SubscriptionStatus =
	| "trialing"
	| "active"
	| "pending_cancellation"
	| "cancelled";

export interface SubscriptionRecord {
	userId: UserId;
	provider: SubscriptionProvider;
	subscriptionId?: string;
	customerId?: string;
	status: SubscriptionStatus;
	trialEndsAt?: string;
	cancellationEffectiveAt?: string;
	trialFeedbackEmailSentAt?: string;
	trialReminderEmailSentAt?: string;
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

export type MarkSubscriptionCancelledByUserId = (input: {
	userId: UserId;
}) => Promise<void>;

export type MarkSubscriptionActive = (input: { userId: UserId }) => Promise<void>;

export type DeleteSubscription = (input: { userId: UserId }) => Promise<void>;

export type MarkTrialFeedbackEmailSent = (input: {
	userId: UserId;
	sentAt: string;
}) => Promise<void>;

export type MarkTrialReminderEmailSent = (input: {
	userId: UserId;
	sentAt: string;
}) => Promise<void>;
