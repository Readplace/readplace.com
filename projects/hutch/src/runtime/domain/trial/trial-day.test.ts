import { STRIPE_TRIAL_PERIOD_DAYS } from "../stripe/stripe-trial-config";
import { trialDayOf } from "./trial-day";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_ENDS_AT = "2026-06-15T00:00:00.000Z";
const TRIAL_END_MS = Date.parse(TRIAL_ENDS_AT);

function daysFromTrialEnd(days: number): Date {
	return new Date(TRIAL_END_MS + days * DAY_MS);
}

describe("trialDayOf", () => {
	it("is day 1 at signup", () => {
		expect(trialDayOf({ trialEndsAt: TRIAL_ENDS_AT, at: daysFromTrialEnd(-STRIPE_TRIAL_PERIOD_DAYS) })).toBe(1);
	});

	it("records day 4 for a send 72 hours after the trial start", () => {
		expect(trialDayOf({ trialEndsAt: TRIAL_ENDS_AT, at: daysFromTrialEnd(3 - STRIPE_TRIAL_PERIOD_DAYS) })).toBe(4);
	});

	it("is day 13 two days before the trial end", () => {
		expect(trialDayOf({ trialEndsAt: TRIAL_ENDS_AT, at: daysFromTrialEnd(-2) })).toBe(13);
	});

	it("is null when the trial end is more than 14 days ahead", () => {
		expect(trialDayOf({ trialEndsAt: TRIAL_ENDS_AT, at: new Date(TRIAL_END_MS - STRIPE_TRIAL_PERIOD_DAYS * DAY_MS - 1) })).toBeNull();
	});

	it("keeps counting up one day past the trial end", () => {
		expect(trialDayOf({ trialEndsAt: TRIAL_ENDS_AT, at: daysFromTrialEnd(1) })).toBe(16);
	});
});
