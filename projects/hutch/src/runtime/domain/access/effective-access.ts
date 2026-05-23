import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import type { FindSubscriptionByUserId } from "@packages/test-fixtures/providers/subscription-providers";

/** The user can save articles, use the extension, and import. */
export type FullAccessTier =
	| { tier: "founding"; access: "full"; banner: "none" }
	| { tier: "paid"; access: "full"; banner: "none" }
	| { tier: "paid"; access: "full"; banner: "pending-cancellation"; cancellationEffectiveAt: string }
	| { tier: "trial"; access: "full"; banner: "trial-countdown"; trialEndsAt: string };

/** Read-only: the user can view + export but cannot save or use the extension.
 * The `reason` field is INTERNAL state used by Phase 3 to branch the Subscribe
 * button (trial → checkout vs. cancelled → one-click resume). It MUST NOT leak
 * into visible copy — the inactive banner uses identical wording for both
 * reasons. */
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
				assert(row.cancellationEffectiveAt, "pending_cancellation row must have cancellationEffectiveAt");
				return {
					tier: "paid",
					access: "full",
					banner: "pending-cancellation",
					cancellationEffectiveAt: row.cancellationEffectiveAt,
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
