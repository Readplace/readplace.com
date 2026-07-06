export const STRIPE_TRIAL_PERIOD_DAYS = 14;

export const TRIAL_REMINDER_LEAD_DAYS = 2;

export function trialReminderFiresAt(trialEndsAt: string): string {
	return new Date(
		Date.parse(trialEndsAt) - TRIAL_REMINDER_LEAD_DAYS * 86_400_000,
	).toISOString();
}
