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
