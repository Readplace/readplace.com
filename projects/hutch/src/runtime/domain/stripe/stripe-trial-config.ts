export const STRIPE_TRIAL_PERIOD_DAYS = 14;

export const TRIAL_REMINDER_LEAD_DAYS = 2;

const STRIPE_TRIAL_END_API_MINIMUM_LEAD_MS = 48 * 60 * 60 * 1000;

const CLOCK_SKEW_AND_LATENCY_MARGIN_MS = 5 * 60 * 1000;

export const STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS =
	STRIPE_TRIAL_END_API_MINIMUM_LEAD_MS + CLOCK_SKEW_AND_LATENCY_MARGIN_MS;

export function trialReminderFiresAt(trialEndsAt: string): string {
	return new Date(
		Date.parse(trialEndsAt) - TRIAL_REMINDER_LEAD_DAYS * 86_400_000,
	).toISOString();
}

/** Visa requires a pre-charge reminder at least 7 days before the first
 * post-trial charge; Mastercard caps the same notice at 7 days. Seven days is
 * the only lead that satisfies both networks. */
export const CHARGE_REMINDER_LEAD_DAYS = 7;

/** A card attached inside the final 7 days cannot be given 7 days' notice, so
 * the reminder goes out as soon as the scheduler can fire it — the reader still
 * gets the charge date and the cancellation link before the charge. */
const CHARGE_REMINDER_MIN_DELAY_MS = 5 * 60 * 1000;

export function chargeReminderFiresAt(input: { chargeAt: string; now: Date }): string {
	const sevenDaysBefore = Date.parse(input.chargeAt) - CHARGE_REMINDER_LEAD_DAYS * 86_400_000;
	const soonest = input.now.getTime() + CHARGE_REMINDER_MIN_DELAY_MS;
	return new Date(Math.max(sevenDaysBefore, soonest)).toISOString();
}
