import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type {
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	MarkSubscriptionCancelled,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	SubscriptionRecord,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "./subscription-providers.types";

export function initInMemorySubscriptionProviders(opts: {
	now: () => Date;
}): {
	findByUserId: FindSubscriptionByUserId;
	findBySubscriptionId: FindSubscriptionBySubscriptionId;
	upsertTrialing: UpsertTrialingSubscription;
	upsertActive: UpsertActiveSubscription;
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	markCancelled: MarkSubscriptionCancelled;
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	markActive: MarkSubscriptionActive;
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
		rows.set(userId, {
			...existing,
			status: "pending_cancellation",
			cancellationEffectiveAt,
			updatedAt: opts.now().toISOString(),
		});
	};

	const markCancelled: MarkSubscriptionCancelled = async ({ subscriptionId }) => {
		for (const [userId, row] of rows.entries()) {
			if (row.subscriptionId === subscriptionId) {
				rows.set(userId, {
					...row,
					status: "cancelled",
					updatedAt: opts.now().toISOString(),
				});
				return;
			}
		}
		throw new Error(`No subscription row for subscriptionId ${subscriptionId}`);
	};

	const markCancelledByUserId: MarkSubscriptionCancelledByUserId = async ({ userId }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		const { trialEndsAt: _t, cancellationEffectiveAt: _ca, ...rest } = existing;
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

	return {
		findByUserId,
		findBySubscriptionId,
		upsertTrialing,
		upsertActive,
		markPendingCancellation,
		markCancelled,
		markCancelledByUserId,
		markActive,
	};
}
