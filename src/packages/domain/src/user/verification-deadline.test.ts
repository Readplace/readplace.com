import {
	VERIFICATION_WINDOW_MS,
	computeVerificationStatus,
} from "./verification-deadline";

const REGISTERED_AT = "2026-01-01T00:00:00.000Z";
const REGISTERED_MS = Date.parse(REGISTERED_AT);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe("computeVerificationStatus", () => {
	it("reports the full window on the first day, rounding partial days up", () => {
		const result = computeVerificationStatus({
			registeredAt: REGISTERED_AT,
			now: new Date(REGISTERED_MS + 1000),
		});
		expect(result).toEqual({ state: "counting-down", daysLeft: 7 });
	});

	it("rounds a partial final day up to 1 day left", () => {
		const halfDayBeforeDeadline = REGISTERED_MS + VERIFICATION_WINDOW_MS - ONE_DAY_MS / 2;
		const result = computeVerificationStatus({
			registeredAt: REGISTERED_AT,
			now: new Date(halfDayBeforeDeadline),
		});
		expect(result).toEqual({ state: "counting-down", daysLeft: 1 });
	});

	it("counts down to 4 days left at the three-day mark", () => {
		const result = computeVerificationStatus({
			registeredAt: REGISTERED_AT,
			now: new Date(REGISTERED_MS + 3 * ONE_DAY_MS),
		});
		expect(result).toEqual({ state: "counting-down", daysLeft: 4 });
	});

	it("locks the account exactly at the deadline", () => {
		const result = computeVerificationStatus({
			registeredAt: REGISTERED_AT,
			now: new Date(REGISTERED_MS + VERIFICATION_WINDOW_MS),
		});
		expect(result).toEqual({ state: "locked" });
	});

	it("locks the account after the deadline has passed", () => {
		const result = computeVerificationStatus({
			registeredAt: REGISTERED_AT,
			now: new Date(REGISTERED_MS + VERIFICATION_WINDOW_MS + ONE_DAY_MS),
		});
		expect(result).toEqual({ state: "locked" });
	});

	it("falls back to pending (never locks) when registeredAt is absent", () => {
		const result = computeVerificationStatus({
			registeredAt: undefined,
			now: new Date(),
		});
		expect(result).toEqual({ state: "pending" });
	});

	it("falls back to pending when registeredAt is not a parseable date", () => {
		const result = computeVerificationStatus({
			registeredAt: "not-a-date",
			now: new Date(),
		});
		expect(result).toEqual({ state: "pending" });
	});
});
