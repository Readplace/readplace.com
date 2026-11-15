import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type {
	BillingPlan,
	FindSubscriptionByUserId,
	SubscriptionRecord,
} from "@packages/provider-contracts/subscription-providers";

export type FullAccessTier =
	| { tier: "founding"; banner: "none" }
	| { tier: "paid"; banner: "none" }
	| { tier: "trial"; banner: "trial-countdown"; trialEndsAt: string }
	| {
			tier: "paid" | "trial";
			banner: "cancellation-scheduled";
			cancellationEffectiveAt: string;
		};

export type FreeAccess =
	| {
			tier: "free";
			banner: "free";
			reason: "trial-expired";
		}
	| {
			tier: "free";
			banner: "free";
			reason: "subscription-cancelled";
			plan: BillingPlan | undefined;
		};

export type EffectiveAccess = FullAccessTier | FreeAccess;

export function isDailyLimited(access: EffectiveAccess): boolean {
	return access.tier === "free";
}

export type GetEffectiveAccess = (userId: UserId) => Promise<EffectiveAccess>;

export function resolveEffectiveAccess(
	row: SubscriptionRecord | undefined,
	now: Date,
): EffectiveAccess {
	if (!row) return { tier: "founding", banner: "none" };
	switch (row.status) {
		case "active":
			return { tier: "paid", banner: "none" };
		case "pending_cancellation": {
			assert(
				row.cancellationEffectiveAt,
				"pending_cancellation row must have cancellationEffectiveAt",
			);
			if (now < new Date(row.cancellationEffectiveAt)) {
				return {
					tier: row.trialEndsAt ? "trial" : "paid",
						banner: "cancellation-scheduled",
					cancellationEffectiveAt: row.cancellationEffectiveAt,
				};
			}
			return {
				tier: "free",
				banner: "free",
				reason: "subscription-cancelled",
				plan: row.plan,
			};
		}
		case "trialing": {
			assert(row.trialEndsAt, "trialing row must have trialEndsAt");
			if (now < new Date(row.trialEndsAt)) {
				return {
					tier: "trial",
						banner: "trial-countdown",
					trialEndsAt: row.trialEndsAt,
				};
			}
			return {
				tier: "free",
				banner: "free",
				reason: "trial-expired",
			};
		}
		case "cancelled":
			return {
				tier: "free",
				banner: "free",
				reason: "subscription-cancelled",
				plan: row.plan,
			};
	}
}

export function initGetEffectiveAccess(deps: {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}): GetEffectiveAccess {
	return async (userId) =>
		resolveEffectiveAccess(await deps.findSubscriptionByUserId(userId), deps.now());
}
