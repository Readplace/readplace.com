import { UserIdSchema } from "@packages/domain/user";
import { initBuildBannerState } from "./banner-state";
import type { EffectiveAccess } from "../domain/access/effective-access";
import { OFFER_POPUP_TRIAL_DELAY_MS } from "../domain/access/offer-popup-eligibility";

const USER_ID = UserIdSchema.parse("user-1");
const ONE_DAY_MS = 86_400_000;
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const OFFER_LINK = "https://buy.stripe.com/test_banner";

function init(
	getEffectiveAccess: Parameters<
		typeof initBuildBannerState
	>[0]["getEffectiveAccess"],
) {
	return initBuildBannerState({
		getEffectiveAccess,
		now: () => FIXED_NOW,
		offerPaymentLink: OFFER_LINK,
	});
}

function activeTrial(trialStartedAt: string): EffectiveAccess {
	return {
		tier: "trial",
		access: "full",
		banner: "trial-countdown",
		trialEndsAt: new Date(FIXED_NOW.getTime() + 3 * ONE_DAY_MS).toISOString(),
		trialStartedAt,
	};
}

describe("initBuildBannerState", () => {
	it("returns isAuthenticated=false with no trial for an unauthenticated request and never fetches access", async () => {
		const getEffectiveAccess = jest.fn();
		const buildBannerState = init(getEffectiveAccess);

		const result = await buildBannerState({});

		expect(result).toEqual({ isAuthenticated: false, emailVerified: undefined });
		expect(getEffectiveAccess).not.toHaveBeenCalled();
	});

	it("populates trial.state='active' with the remaining window and escalation for a trialing user", async () => {
		const trialEndsAt = new Date(
			FIXED_NOW.getTime() + 3 * ONE_DAY_MS,
		).toISOString();
		const buildBannerState = init(async () => activeTrial(FIXED_NOW.toISOString()));

		const result = await buildBannerState({ userId: USER_ID });

		expect(result.trial).toEqual({
			state: "active",
			endsAtIso: trialEndsAt,
			serverNowIso: FIXED_NOW.toISOString(),
			remaining: expect.objectContaining({ days: 3 }),
			escalation: "moderate",
		});
	});

	it("ships the offer popup for a trial past the 30-minute mark", async () => {
		const startedAt = new Date(
			FIXED_NOW.getTime() - OFFER_POPUP_TRIAL_DELAY_MS,
		).toISOString();
		const buildBannerState = init(async () => activeTrial(startedAt));

		const result = await buildBannerState({ userId: USER_ID });

		expect(result.offerPopup?.html).toContain(OFFER_LINK);
		expect(result.offerPopup?.script).toContain("offer-popup.client.js");
		expect(result.offerPopup?.styles).toContain(".offer-popup");
	});

	it("withholds the offer popup for a trial still inside its first 30 minutes", async () => {
		const startedAt = new Date(
			FIXED_NOW.getTime() - OFFER_POPUP_TRIAL_DELAY_MS + 1,
		).toISOString();
		const buildBannerState = init(async () => activeTrial(startedAt));

		const result = await buildBannerState({ userId: USER_ID });

		expect(result.offerPopup).toBeUndefined();
	});

	it("populates trial.state='expired' and ships the offer popup for both trial-expired and subscription-cancelled inactive users", async () => {
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

		for (const access of [trialExpired, cancelled]) {
			const result = await init(async () => access)({ userId: USER_ID });
			expect(result.trial).toEqual({ state: "expired" });
			expect(result.offerPopup?.html).toContain(OFFER_LINK);
		}
	});

	it("leaves trial and offer popup undefined for founding members and paid users", async () => {
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

		for (const access of [founding, paid]) {
			const result = await init(async () => access)({ userId: USER_ID });
			expect(result.trial).toBeUndefined();
			expect(result.offerPopup).toBeUndefined();
		}
	});

	it("honors a preFetchedAccess without re-invoking getEffectiveAccess (queue page already fetched it)", async () => {
		const getEffectiveAccess = jest.fn();
		const buildBannerState = init(getEffectiveAccess);

		const result = await buildBannerState(
			{ userId: USER_ID },
			{ preFetchedAccess: activeTrial(FIXED_NOW.toISOString()) },
		);

		expect(result.trial?.state).toBe("active");
		expect(getEffectiveAccess).not.toHaveBeenCalled();
	});

	it("populates trial.state='cancellation-scheduled' and withholds the offer popup for a user inside the cancel window and keeps accessIsReadOnly=false (import + account nav stay visible)", async () => {
		const cancellationEffectiveAt = new Date(
			FIXED_NOW.getTime() + 5 * ONE_DAY_MS,
		).toISOString();
		const access: EffectiveAccess = {
			tier: "paid",
			access: "full",
			banner: "cancellation-scheduled",
			cancellationEffectiveAt,
		};
		const buildBannerState = init(async () => access);

		const result = await buildBannerState({ userId: USER_ID });

		expect(result.trial).toEqual({
			state: "cancellation-scheduled",
			endsAtIso: cancellationEffectiveAt,
			serverNowIso: FIXED_NOW.toISOString(),
		});
		expect(result.accessIsReadOnly).toBe(false);
		expect(result.offerPopup).toBeUndefined();
	});
});
