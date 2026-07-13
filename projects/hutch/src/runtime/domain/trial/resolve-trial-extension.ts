import type {
	SubscriptionRecord,
	SubscriptionStatus,
} from "@packages/provider-contracts/subscription-providers";

export type TrialExtensionRefusal =
	| { reason: "founding-member" }
	| { reason: "paid-subscription"; status: SubscriptionStatus }
	| { reason: "not-in-future" };

export type TrialExtensionDecision =
	| {
			allowed: true;
			trialEndsAt: string;
			previousStatus: SubscriptionStatus;
			previousTrialEndsAt: string | undefined;
		}
	| { allowed: false; refusal: TrialExtensionRefusal };

/**
 * Whether an operator may (re)open a trial window on a row.
 *
 * Deliberately outside `startTrial`: signup legitimately starts a trial for a
 * user with no row, and "no row" is precisely what this must refuse. Folding it
 * into `startTrial` would make every signup illegal.
 *
 * No row → founding member, permanent full access. Writing a row where none
 * existed converts that into a countdown, so it is never allowed.
 *
 * Any Stripe linkage → refuse. `upsertTrialing` REMOVEs subscriptionId and
 * customerId, so running it on a paying row orphans a live Stripe subscription
 * that keeps billing a user the database now calls "trialing". Keyed on the ids
 * rather than `status === "active"` alone, so a cancelled ex-payer is refused
 * too — they re-subscribe through /account, not through this page.
 */
export function resolveTrialExtension(params: {
	subscription: SubscriptionRecord | undefined;
	trialEndsAt: string;
	now: Date;
}): TrialExtensionDecision {
	const { subscription, trialEndsAt, now } = params;

	if (!subscription) {
		return { allowed: false, refusal: { reason: "founding-member" } };
	}

	if (
		subscription.status === "active" ||
		subscription.subscriptionId !== undefined ||
		subscription.customerId !== undefined
	) {
		return {
			allowed: false,
			refusal: { reason: "paid-subscription", status: subscription.status },
		};
	}

	/* A window that closes in the past is read-only the instant it is written
	 * (trialing + elapsed trialEndsAt === read-only) and would arm an EventBridge
	 * schedule at an instant it rejects. The rule lives here so "a trial must end
	 * in the future" has exactly one home. */
	if (Date.parse(trialEndsAt) <= now.getTime()) {
		return { allowed: false, refusal: { reason: "not-in-future" } };
	}

	return {
		allowed: true,
		trialEndsAt,
		previousStatus: subscription.status,
		previousTrialEndsAt: subscription.trialEndsAt,
	};
}
