import assert from "node:assert/strict";
import type { EffectiveAccess } from "./effective-access";
import {
	OFFER_POPUP_TRIAL_DELAY_MS,
	isOfferPopupEligible,
} from "./offer-popup-eligibility";

const NOW = new Date("2026-01-01T12:00:00.000Z");

function trial(trialStartedAt: string): EffectiveAccess {
	return {
		tier: "trial",
		access: "full",
		banner: "trial-countdown",
		trialEndsAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
		trialStartedAt,
	};
}

describe("isOfferPopupEligible", () => {
	it("hides for a trial still inside its first 30 minutes", () => {
		const startedAt = new Date(
			NOW.getTime() - OFFER_POPUP_TRIAL_DELAY_MS + 1,
		).toISOString();
		assert.equal(isOfferPopupEligible(trial(startedAt), NOW), false);
	});

	it("shows for a trial exactly 30 minutes after it started", () => {
		const startedAt = new Date(
			NOW.getTime() - OFFER_POPUP_TRIAL_DELAY_MS,
		).toISOString();
		assert.equal(isOfferPopupEligible(trial(startedAt), NOW), true);
	});

	it("shows for a trial well past the 30-minute mark", () => {
		const startedAt = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
		assert.equal(isOfferPopupEligible(trial(startedAt), NOW), true);
	});

	it("shows for a locked-out, trial-expired account", () => {
		const access: EffectiveAccess = {
			tier: "inactive",
			access: "read-only",
			banner: "inactive",
			reason: "trial-expired",
		};
		assert.equal(isOfferPopupEligible(access, NOW), true);
	});

	it("shows for a locked-out, subscription-cancelled account", () => {
		const access: EffectiveAccess = {
			tier: "inactive",
			access: "read-only",
			banner: "inactive",
			reason: "subscription-cancelled",
		};
		assert.equal(isOfferPopupEligible(access, NOW), true);
	});

	it("hides for a founding member", () => {
		const access: EffectiveAccess = {
			tier: "founding",
			access: "full",
			banner: "none",
		};
		assert.equal(isOfferPopupEligible(access, NOW), false);
	});

	it("hides for a paid user", () => {
		const access: EffectiveAccess = {
			tier: "paid",
			access: "full",
			banner: "none",
		};
		assert.equal(isOfferPopupEligible(access, NOW), false);
	});

	it("hides for a trial user with a scheduled cancellation (still active, opted to cancel)", () => {
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "cancellation-scheduled",
			cancellationEffectiveAt: new Date(
				NOW.getTime() + 86_400_000,
			).toISOString(),
		};
		assert.equal(isOfferPopupEligible(access, NOW), false);
	});
});
