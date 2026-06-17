import type { EffectiveAccess } from "./effective-access";

/** A trialing user only sees the founding-offer popup once they have spent this
 * long in the trial — long enough to have used the product before being pitched. */
export const OFFER_POPUP_TRIAL_DELAY_MS = 30 * 60 * 1000;

/** Whether the founding-offer popup is eligible to ship for a user on any page.
 * Shows for an active trial once 30 minutes have elapsed since it started, and
 * for any read-only/locked account (expired trial or cancelled subscription).
 * Founding members (no subscription → tier "founding"), paid users, trials still
 * inside their first 30 minutes, and still-active users with a scheduled
 * cancellation never see it. */
export function isOfferPopupEligible(
	access: EffectiveAccess,
	now: Date,
): boolean {
	if (access.tier === "trial" && access.banner === "trial-countdown") {
		return (
			now.getTime() - new Date(access.trialStartedAt).getTime() >=
			OFFER_POPUP_TRIAL_DELAY_MS
		);
	}
	return access.tier === "inactive";
}
