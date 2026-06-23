import assert from "node:assert";
import type { SubscriptionStatus } from "@packages/provider-contracts/subscription-providers";

export type WriteAccess = "full" | "read-only";

/** The subset of a subscription row that the write decision reads. Kept narrow
 * so the only thing that re-decides "can this user save?" is the row's status
 * and the two window dates — never the wider render model. */
type SubscriptionWriteState = {
	status: SubscriptionStatus;
	trialEndsAt?: string;
	cancellationEffectiveAt?: string;
};

/**
 * The single write-access decision shared by hutch's save gates (the `/queue`
 * middleware and the MCP `save_link` resolver). A missing row is a founding
 * member; an active subscription, an in-window trial, and an in-window pending
 * cancellation all keep "full"; an elapsed trial, an elapsed cancellation
 * window, and an outright cancellation are "read-only".
 *
 * The decision stays pure — it reads the row's status plus the two window
 * dates and the clock, nothing else — so hutch's save gates re-derive "can this
 * user save?" without reaching for the wider render model.
 */
export function resolveWriteAccess(
	subscription: SubscriptionWriteState | undefined,
	now: Date,
): WriteAccess {
	if (!subscription) return "full";
	switch (subscription.status) {
		case "active":
			return "full";
		case "pending_cancellation":
			assert(
				subscription.cancellationEffectiveAt,
				"pending_cancellation row must have cancellationEffectiveAt",
			);
			return now < new Date(subscription.cancellationEffectiveAt) ? "full" : "read-only";
		case "trialing":
			assert(subscription.trialEndsAt, "trialing row must have trialEndsAt");
			return now < new Date(subscription.trialEndsAt) ? "full" : "read-only";
		case "cancelled":
			return "read-only";
	}
}
