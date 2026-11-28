import { formatTrialRemaining } from "./trial-countdown.format";

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe("formatTrialRemaining", () => {
	it("breaks the remaining window into days/hours/minutes", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const endsAt = new Date(
			now.getTime() + 13 * ONE_DAY_MS + 12 * ONE_HOUR_MS + 33 * ONE_MINUTE_MS + 22 * ONE_SECOND_MS,
		).toISOString();
		expect(formatTrialRemaining(endsAt, now)).toEqual({
			days: 13,
			hours: 12,
			minutes: 33,
		});
	});

	it("clamps a past endsAt to zero remaining so an expired trial reports nothing left", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const endsAt = new Date(now.getTime() - ONE_DAY_MS).toISOString();
		expect(formatTrialRemaining(endsAt, now)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
		});
	});

	it("reports exactly zero at the boundary", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		expect(formatTrialRemaining(now.toISOString(), now)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
		});
	});
});
