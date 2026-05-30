import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type { FindSubscriptionByUserId } from "@packages/test-fixtures/providers/subscription-providers";

/** The user can save articles, use the extension, and import. */
export type FullAccessTier =
	| { tier: "founding"; access: "full"; banner: "none" }
	| { tier: "paid"; access: "full"; banner: "none" }
	| { tier: "trial"; access: "full"; banner: "trial-countdown"; trialEndsAt: string }
	| {
			tier: "paid" | "trial";
			access: "full";
			banner: "cancellation-scheduled";
			cancellationEffectiveAt: string;
		};

/** Read-only: the user can view + export but cannot save or use the extension.
 * The `reason` field is INTERNAL state. It must NOT leak into visible copy —
 * the inactive banner uses identical wording across all reasons (a cancelled
 * user and a trial-expired user see the same message). The reason exists so
 * callers can branch on it for non-user-facing concerns (e.g. analytics, or a
 * future one-click Subscribe upgrade for cancelled users with a Stripe
 * customer record). */
export type InactiveAccess = {
	tier: "inactive";
	access: "read-only";
	banner: "inactive";
	reason: "trial-expired" | "subscription-cancelled";
};

export type EffectiveAccess = FullAccessTier | InactiveAccess;

export type GetEffectiveAccess = (userId: UserId) => Promise<EffectiveAccess>;

export function initGetEffectiveAccess(deps: {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}): GetEffectiveAccess {
	return async (userId): Promise<EffectiveAccess> => {
		const row = await deps.findSubscriptionByUserId(userId);
		if (!row) return { tier: "founding", access: "full", banner: "none" };
		switch (row.status) {
			case "active":
				return { tier: "paid", access: "full", banner: "none" };
			case "pending_cancellation": {
				assert(
					row.cancellationEffectiveAt,
					"pending_cancellation row must have cancellationEffectiveAt",
				);
				if (deps.now() < new Date(row.cancellationEffectiveAt)) {
					return {
						tier: row.trialEndsAt ? "trial" : "paid",
						access: "full",
						banner: "cancellation-scheduled",
						cancellationEffectiveAt: row.cancellationEffectiveAt,
					};
				}
				return {
					tier: "inactive",
					access: "read-only",
					banner: "inactive",
					reason: "subscription-cancelled",
				};
			}
			case "trialing": {
				assert(row.trialEndsAt, "trialing row must have trialEndsAt");
				if (deps.now() < new Date(row.trialEndsAt)) {
					return {
						tier: "trial",
						access: "full",
						banner: "trial-countdown",
						trialEndsAt: row.trialEndsAt,
					};
				}
				return {
					tier: "inactive",
					access: "read-only",
					banner: "inactive",
					reason: "trial-expired",
				};
			}
			case "cancelled":
				return {
					tier: "inactive",
					access: "read-only",
					banner: "inactive",
					reason: "subscription-cancelled",
				};
		}
	};
}
