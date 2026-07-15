import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type {
	DeleteSubscription,
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	MarkTrialFeedbackEmailSent,
	MarkTrialReminderEmailSent,
	SetSubscriptionNextCharge,
	SubscriptionRecord,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";

export function initInMemorySubscriptionProviders(opts: {
	now: () => Date;
}): {
	findByUserId: FindSubscriptionByUserId;
	findBySubscriptionId: FindSubscriptionBySubscriptionId;
	upsertTrialing: UpsertTrialingSubscription;
	upsertActive: UpsertActiveSubscription;
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	markActive: MarkSubscriptionActive;
	markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent;
	markTrialReminderEmailSent: MarkTrialReminderEmailSent;
	setNextCharge: SetSubscriptionNextCharge;
	deleteSubscription: DeleteSubscription;
	seedRow: (row: SubscriptionRecord) => void;
} {
	const rows = new Map<UserId, SubscriptionRecord>();

	const findByUserId: FindSubscriptionByUserId = async (userId) => rows.get(userId);

	const findBySubscriptionId: FindSubscriptionBySubscriptionId = async (subscriptionId) => {
		for (const row of rows.values()) {
			if (row.subscriptionId === subscriptionId) return row;
		}
		return undefined;
	};

	const upsertTrialing: UpsertTrialingSubscription = async ({ userId, trialEndsAt }) => {
		const existing = rows.get(userId);
		const nowIso = opts.now().toISOString();
		rows.set(userId, {
			userId,
			provider: "stripe",
			status: "trialing",
			trialEndsAt,
			createdAt: existing?.createdAt ?? nowIso,
			updatedAt: nowIso,
		});
	};

	const upsertActive: UpsertActiveSubscription = async ({ userId, subscriptionId, customerId }) => {
		const existing = rows.get(userId);
		const nowIso = opts.now().toISOString();
		rows.set(userId, {
			userId,
			provider: "stripe",
			subscriptionId,
			customerId,
			status: "active",
			createdAt: existing?.createdAt ?? nowIso,
			updatedAt: nowIso,
		});
	};

	const markPendingCancellation: MarkSubscriptionPendingCancellation = async ({ userId, cancellationEffectiveAt }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		const { nextCharge: _nc, ...rest } = existing;
		rows.set(userId, {
			...rest,
			status: "pending_cancellation",
			cancellationEffectiveAt,
			updatedAt: opts.now().toISOString(),
		});
	};

	const markCancelledByUserId: MarkSubscriptionCancelledByUserId = async ({ userId }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		const { trialEndsAt: _t, cancellationEffectiveAt: _ca, nextCharge: _nc, ...rest } = existing;
		rows.set(userId, {
			...rest,
			status: "cancelled",
			updatedAt: opts.now().toISOString(),
		});
	};

	const markActive: MarkSubscriptionActive = async ({ userId }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		const { cancellationEffectiveAt: _ca, ...rest } = existing;
		rows.set(userId, {
			...rest,
			status: "active",
			updatedAt: opts.now().toISOString(),
		});
	};

	const markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent = async ({
		userId,
		sentAt,
	}) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		rows.set(userId, {
			...existing,
			trialFeedbackEmailSentAt: sentAt,
			updatedAt: opts.now().toISOString(),
		});
	};

	const markTrialReminderEmailSent: MarkTrialReminderEmailSent = async ({
		userId,
		sentAt,
	}) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		rows.set(userId, {
			...existing,
			trialReminderEmailSentAt: sentAt,
			updatedAt: opts.now().toISOString(),
		});
	};

	/* Mirrors the condition the real table enforces — the row must still exist, still
	 * be active, and still hold the subscription the charge was read from. Accepting
	 * writes the production store would reject would let tests pass against a world
	 * that cannot happen. */
	const setNextCharge: SetSubscriptionNextCharge = async ({
		userId,
		subscriptionId,
		nextCharge,
	}) => {
		const existing = rows.get(userId);
		assert(
			existing?.status === "active" && existing.subscriptionId === subscriptionId,
			`No active subscription ${subscriptionId} for user ${userId}`,
		);
		rows.set(userId, {
			...existing,
			nextCharge,
			updatedAt: opts.now().toISOString(),
		});
	};

	const deleteSubscription: DeleteSubscription = async ({ userId }) => {
		rows.delete(userId);
	};

	/** Test-only escape hatch for seeding hypothetical row shapes (e.g. a
	 * trialing row that also has a customerId — production paths never write
	 * this combination, but the trial-end charge handler must still cover the
	 * defensive case). DO NOT use in production code. */
	const seedRow = (row: SubscriptionRecord): void => {
		rows.set(row.userId, row);
	};

	return {
		findByUserId,
		findBySubscriptionId,
		upsertTrialing,
		upsertActive,
		markPendingCancellation,
		markCancelledByUserId,
		markActive,
		markTrialFeedbackEmailSent,
		markTrialReminderEmailSent,
		setNextCharge,
		deleteSubscription,
		seedRow,
	};
}
