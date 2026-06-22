import assert from "node:assert/strict";
import { type ChangelogBanner, isChangelogVersion } from "@packages/web-shell";
import { UserIdSchema } from "@packages/domain/user";
import { initBuildBannerState } from "./banner-state";
import type { GetChangelogBanner } from "./changelog-banner-source";
import type { EffectiveAccess } from "../domain/access/effective-access";
import { OFFER_POPUP_TRIAL_DELAY_MS } from "../domain/access/offer-popup-eligibility";

const USER_ID = UserIdSchema.parse("user-1");
const ONE_DAY_MS = 86_400_000;
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const OFFER_LINK = "https://buy.stripe.com/test_banner";

const noChangelogBanner: GetChangelogBanner = async () => undefined;

function init(
	getEffectiveAccess: Parameters<
		typeof initBuildBannerState
	>[0]["getEffectiveAccess"],
	getChangelogBanner: GetChangelogBanner = noChangelogBanner,
) {
	return initBuildBannerState({
		getEffectiveAccess,
		getChangelogBanner,
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

const CHANGELOG_VERSION = "a1b2c3d4";
assert(isChangelogVersion(CHANGELOG_VERSION));
const CHANGELOG: ChangelogBanner = {
	hook: "I added keyboard shortcuts to the reader",
	href: "/blog/keyboard-shortcuts?utm_source=changelog-banner&utm_medium=internal&utm_content=read-more",
	version: CHANGELOG_VERSION,
};

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

	describe("changelog banner", () => {
		it("includes the changelog banner for a guest, folded in before the unauthenticated early-return", async () => {
			const getEffectiveAccess = jest.fn();
			const build = init(getEffectiveAccess, async () => CHANGELOG);

			const result = await build({});

			expect(result).toEqual({
				isAuthenticated: false,
				emailVerified: undefined,
				changelogBanner: CHANGELOG,
			});
			expect(getEffectiveAccess).not.toHaveBeenCalled();
		});

		it("drops the changelog banner when the reader has dismissed that exact version", async () => {
			const build = init(jest.fn(), async () => CHANGELOG);

			const result = await build({ dismissedChangelogVersion: CHANGELOG.version });

			expect(result.changelogBanner).toBeUndefined();
		});

		it("keeps the changelog banner when the dismissed version is for a different (older) announcement", async () => {
			const build = init(jest.fn(), async () => CHANGELOG);

			const result = await build({ dismissedChangelogVersion: "ffffffff" });

			expect(result.changelogBanner).toEqual(CHANGELOG);
		});

		it("includes the changelog banner for an authenticated user alongside their trial state", async () => {
			const build = init(
				async () => activeTrial(FIXED_NOW.toISOString()),
				async () => CHANGELOG,
			);

			const result = await build({ userId: USER_ID });

			expect(result.changelogBanner).toEqual(CHANGELOG);
			expect(result.trial?.state).toBe("active");
		});

		it("leaves the state unchanged when there is nothing to announce", async () => {
			const build = init(jest.fn(), noChangelogBanner);

			const result = await build({});

			expect(result.changelogBanner).toBeUndefined();
		});
	});

	it("threads the request's originalUrl onto currentPath so the changelog dismiss form returns the reader to where they were", async () => {
		const build = initBuildBannerState({
			getEffectiveAccess: jest.fn(),
			getChangelogBanner: noChangelogBanner,
			now: () => FIXED_NOW,
			offerPaymentLink: OFFER_LINK,
		});

		const result = await build({ originalUrl: "/queue?filter=unread" });

		expect(result.currentPath).toBe("/queue?filter=unread");
	});
});
