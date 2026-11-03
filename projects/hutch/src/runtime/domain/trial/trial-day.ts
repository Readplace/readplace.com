import { STRIPE_TRIAL_PERIOD_DAYS } from "../stripe/stripe-trial-config";

const DAY_MS = 24 * 60 * 60 * 1000;

export function trialDayOf(input: { trialEndsAt: string; at: Date }): number | null {
	const msToTrialEnd = Date.parse(input.trialEndsAt) - input.at.getTime();
	const trialDay = STRIPE_TRIAL_PERIOD_DAYS + 1 - Math.ceil(msToTrialEnd / DAY_MS);
	return trialDay >= 1 ? trialDay : null;
}
