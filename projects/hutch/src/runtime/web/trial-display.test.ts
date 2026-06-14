import { toTrialDisplay } from "./trial-display";
import type { EffectiveAccess } from "../domain/access/effective-access";

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

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

	it("maps a cancellation-scheduled access (paid + trial both produce the same banner state) to a state=cancellation-scheduled TrialDisplay carrying the cancellation-effective-at instant", () => {
		const cancellationEffectiveAt = "2026-06-22T10:00:00.000Z";
		const paidCancelled: EffectiveAccess = {
			tier: "paid",
			access: "full",
			banner: "cancellation-scheduled",
			cancellationEffectiveAt,
		};
		const trialCancelled: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "cancellation-scheduled",
			cancellationEffectiveAt,
		};
		const expected = {
			state: "cancellation-scheduled",
			endsAtIso: cancellationEffectiveAt,
			serverNowIso: now.toISOString(),
		};
		expect(toTrialDisplay(paidCancelled, now)).toEqual(expected);
		expect(toTrialDisplay(trialCancelled, now)).toEqual(expected);
	});
});
