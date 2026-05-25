import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type {
	ClearChargeFailed,
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	FindSubscriptionByUserIdConsistent,
	MarkChargeFailed,
	MarkChargeRequested,
	MarkSubscriptionActive,
	MarkSubscriptionCancelled,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	SubscriptionRecord,
	UpsertActiveSubscription,
	UpsertCancelledSubscription,
	UpsertCustomerId,
	UpsertPaymentMethod,
	UpsertTrialingSubscription,
} from "./subscription-providers.types";

export function initInMemorySubscriptionProviders(opts: {
	now: () => Date;
}): {
	findByUserId: FindSubscriptionByUserId;
	findByUserIdConsistent: FindSubscriptionByUserIdConsistent;
	findBySubscriptionId: FindSubscriptionBySubscriptionId;
	upsertTrialing: UpsertTrialingSubscription;
	upsertActive: UpsertActiveSubscription;
	upsertCancelled: UpsertCancelledSubscription;
	upsertCustomerId: UpsertCustomerId;
	upsertPaymentMethod: UpsertPaymentMethod;
	markChargeRequested: MarkChargeRequested;
	markChargeFailed: MarkChargeFailed;
	clearChargeFailed: ClearChargeFailed;
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	markCancelled: MarkSubscriptionCancelled;
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	markActive: MarkSubscriptionActive;
	seedRow: (row: SubscriptionRecord) => void;
} {
	const rows = new Map<UserId, SubscriptionRecord>();

	const findByUserId: FindSubscriptionByUserId = async (userId) => rows.get(userId);

	const findByUserIdConsistent: FindSubscriptionByUserIdConsistent = async (userId) =>
		rows.get(userId);

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
		const next: SubscriptionRecord = {
			userId,
			provider: "stripe",
			subscriptionId,
			customerId,
			status: "active",
			createdAt: existing?.createdAt ?? nowIso,
			updatedAt: nowIso,
		};
		if (existing?.paymentMethodId) next.paymentMethodId = existing.paymentMethodId;
		if (existing?.paymentMethodBrand) next.paymentMethodBrand = existing.paymentMethodBrand;
		if (existing?.paymentMethodLast4) next.paymentMethodLast4 = existing.paymentMethodLast4;
		rows.set(userId, next);
	};

	const upsertCancelled: UpsertCancelledSubscription = async ({ userId }) => {
		const existing = rows.get(userId);
		const nowIso = opts.now().toISOString();
		const base: SubscriptionRecord = {
			userId,
			provider: "stripe",
			status: "cancelled",
			createdAt: existing?.createdAt ?? nowIso,
			updatedAt: nowIso,
		};
		if (existing?.customerId) base.customerId = existing.customerId;
		if (existing?.paymentMethodId) base.paymentMethodId = existing.paymentMethodId;
		if (existing?.paymentMethodBrand) base.paymentMethodBrand = existing.paymentMethodBrand;
		if (existing?.paymentMethodLast4) base.paymentMethodLast4 = existing.paymentMethodLast4;
		rows.set(userId, base);
	};

	const upsertCustomerId: UpsertCustomerId = async ({ userId, customerId }) => {
		const existing = rows.get(userId);
		if (existing?.customerId) {
			return { ok: false, reason: "customer-id-already-set" };
		}
		const nowIso = opts.now().toISOString();
		const next: SubscriptionRecord = existing
			? { ...existing, customerId, updatedAt: nowIso }
			: {
					userId,
					provider: "stripe",
					status: "cancelled",
					customerId,
					createdAt: nowIso,
					updatedAt: nowIso,
				};
		rows.set(userId, next);
		return { ok: true };
	};

	const upsertPaymentMethod: UpsertPaymentMethod = async ({ userId, paymentMethodId, brand, last4 }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		const { chargeFailedAt: _faf, chargeFailedReason: _frs, ...rest } = existing;
		rows.set(userId, {
			...rest,
			paymentMethodId,
			paymentMethodBrand: brand,
			paymentMethodLast4: last4,
			updatedAt: opts.now().toISOString(),
		});
	};

	const markChargeRequested: MarkChargeRequested = async ({ userId, requestedAt }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		if (existing.chargeRequestedAt) {
			return { ok: false, reason: "charge-already-requested" };
		}
		rows.set(userId, {
			...existing,
			chargeRequestedAt: requestedAt,
			updatedAt: opts.now().toISOString(),
		});
		return { ok: true };
	};

	const markChargeFailed: MarkChargeFailed = async ({ userId, failedAt, reason }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		const { chargeRequestedAt: _crq, ...rest } = existing;
		rows.set(userId, {
			...rest,
			chargeFailedAt: failedAt,
			chargeFailedReason: reason,
			updatedAt: opts.now().toISOString(),
		});
	};

	const clearChargeFailed: ClearChargeFailed = async ({ userId }) => {
		const existing = rows.get(userId);
		assert(existing, `No subscription row for user ${userId}`);
		const { chargeFailedAt: _faf, chargeFailedReason: _frs, ...rest } = existing;
		rows.set(userId, {
			...rest,
			updatedAt: opts.now().toISOString(),
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

	/** Test-only escape hatch for seeding hypothetical row shapes (e.g. a
	 * trialing row that also has a customerId — production paths never write
	 * this combination, but the trial-end charge handler must still cover the
	 * defensive case). DO NOT use in production code. */
	const seedRow = (row: SubscriptionRecord): void => {
		rows.set(row.userId, row);
	};

	return {
		findByUserId,
		findByUserIdConsistent,
		findBySubscriptionId,
		upsertTrialing,
		upsertActive,
		upsertCancelled,
		upsertCustomerId,
		upsertPaymentMethod,
		markChargeRequested,
		markChargeFailed,
		clearChargeFailed,
		markPendingCancellation,
		markCancelled,
		markCancelledByUserId,
		markActive,
		seedRow,
	};
}
