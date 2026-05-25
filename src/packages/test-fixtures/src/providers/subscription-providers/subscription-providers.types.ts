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
	paymentMethodId?: string;
	paymentMethodBrand?: string;
	paymentMethodLast4?: string;
	chargeRequestedAt?: string;
	chargeFailedAt?: string;
	chargeFailedReason?: string;
	createdAt: string;
	updatedAt: string;
}

export type FindSubscriptionByUserId = (
	userId: UserId,
) => Promise<SubscriptionRecord | undefined>;

export type FindSubscriptionByUserIdConsistent = (
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

export type UpsertCancelledSubscription = (input: {
	userId: UserId;
}) => Promise<void>;

/** Conditional write — succeeds only when the row has no `customerId` yet.
 * Returns `false` if a `customerId` is already present so the caller can
 * read the winning id and reuse it (defeats double-click and at-least-once
 * SQS retries that would otherwise create a second Stripe Customer). */
export type UpsertCustomerId = (input: {
	userId: UserId;
	customerId: string;
}) => Promise<{ ok: true } | { ok: false; reason: "customer-id-already-set" }>;

export type UpsertPaymentMethod = (input: {
	userId: UserId;
	paymentMethodId: string;
	brand: string;
	last4: string;
}) => Promise<void>;

/** Conditional write — succeeds only when the row has no in-flight charge
 * (`chargeRequestedAt` is absent). Returns `false` so the caller can skip
 * publishing a duplicate `SubscriptionStartRequestCommand`. The stored ISO
 * timestamp doubles as the Stripe Idempotency-Key for the eventual
 * subscriptions.create call. */
export type MarkChargeRequested = (input: {
	userId: UserId;
	requestedAt: string;
}) => Promise<{ ok: true } | { ok: false; reason: "charge-already-requested" }>;

export type MarkChargeFailed = (input: {
	userId: UserId;
	failedAt: string;
	reason: string;
}) => Promise<void>;

export type ClearChargeFailed = (input: { userId: UserId }) => Promise<void>;

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
