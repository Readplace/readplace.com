import {
	deriveTrialEscalation,
	formatTrialDisplay,
	formatTrialRemaining,
	toTrialDisplay,
} from "./trial-countdown.format";
import type { EffectiveAccess } from "../domain/access/effective-access";

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe("formatTrialRemaining", () => {
	it("breaks the remaining window into days/hours/minutes/seconds", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const endsAt = new Date(
			now.getTime() + 13 * ONE_DAY_MS + 12 * ONE_HOUR_MS + 33 * ONE_MINUTE_MS + 22 * ONE_SECOND_MS,
		).toISOString();
		expect(formatTrialRemaining(endsAt, now)).toEqual({
			days: 13,
			hours: 12,
			minutes: 33,
			seconds: 22,
			totalMs:
				13 * ONE_DAY_MS + 12 * ONE_HOUR_MS + 33 * ONE_MINUTE_MS + 22 * ONE_SECOND_MS,
		});
	});

	it("clamps a past endsAt to zero remaining so an expired trial reports totalMs=0", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const endsAt = new Date(now.getTime() - ONE_DAY_MS).toISOString();
		expect(formatTrialRemaining(endsAt, now)).toEqual({
			days: 0,
			hours: 0,
			minutes: 0,
			seconds: 0,
			totalMs: 0,
		});
	});

	it("reports exactly zero across the boundary so the client sees totalMs<=0 once and only once", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		expect(formatTrialRemaining(now.toISOString(), now).totalMs).toBe(0);
	});
});

describe("deriveTrialEscalation", () => {
	const baseRemaining = { days: 0, hours: 0, minutes: 0, seconds: 0 };

	it("returns 'soft' when more than seven days remain", () => {
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 8 * ONE_DAY_MS }),
		).toBe("soft");
	});

	it("returns 'moderate' when between one and seven days remain", () => {
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 3 * ONE_DAY_MS }),
		).toBe("moderate");
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 7 * ONE_DAY_MS }),
		).toBe("moderate");
	});

	it("returns 'urgent' when between one hour and one day remain", () => {
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 5 * ONE_HOUR_MS }),
		).toBe("urgent");
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: ONE_DAY_MS }),
		).toBe("urgent");
	});

	it("returns 'critical' when less than one hour remains", () => {
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 30 * ONE_MINUTE_MS }),
		).toBe("critical");
		expect(
			deriveTrialEscalation({ ...baseRemaining, totalMs: 0 }),
		).toBe("critical");
	});
});

describe("formatTrialDisplay", () => {
	it("renders the active countdown as `Xd Xh Xm Xs in your free trial`", () => {
		expect(
			formatTrialDisplay({
				state: "active",
				endsAtIso: "2026-01-15T00:00:00.000Z",
				serverNowIso: "2026-01-01T00:00:00.000Z",
				remaining: {
					days: 13,
					hours: 12,
					minutes: 33,
					seconds: 22,
					totalMs: 1,
				},
				escalation: "soft",
			}),
		).toBe("13d 12h 33m 22s in your free trial");
	});

	it("renders the expired state as the standalone 'Free trial is over!' message", () => {
		expect(formatTrialDisplay({ state: "expired" })).toBe("Free trial is over!");
	});
});

describe("toTrialDisplay", () => {
	const now = new Date("2026-01-01T00:00:00.000Z");

	it("maps an active trial banner to a state=active TrialDisplay carrying the ISO end time and serverNowIso", () => {
		const trialEndsAt = new Date(now.getTime() + 3 * ONE_DAY_MS).toISOString();
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const result = toTrialDisplay(access, now);
		expect(result).toEqual({
			state: "active",
			endsAtIso: trialEndsAt,
			serverNowIso: now.toISOString(),
			remaining: expect.objectContaining({ days: 3 }),
			escalation: "moderate",
		});
	});

	it("maps an inactive banner (trial-expired or cancelled) to a state=expired TrialDisplay", () => {
		const trialExpired: EffectiveAccess = {
			tier: "inactive",
			access: "read-only",
			banner: "inactive",
			reason: "trial-expired",
		};
		const cancelled: EffectiveAccess = {
			tier: "inactive",
			access: "read-only",
			banner: "inactive",
			reason: "subscription-cancelled",
		};
		expect(toTrialDisplay(trialExpired, now)).toEqual({ state: "expired" });
		expect(toTrialDisplay(cancelled, now)).toEqual({ state: "expired" });
	});

	it("returns undefined for founding/paid so the countdown is hidden", () => {
		const founding: EffectiveAccess = {
			tier: "founding",
			access: "full",
			banner: "none",
		};
		const paid: EffectiveAccess = {
			tier: "paid",
			access: "full",
			banner: "none",
		};
		expect(toTrialDisplay(founding, now)).toBeUndefined();
		expect(toTrialDisplay(paid, now)).toBeUndefined();
	});
});
