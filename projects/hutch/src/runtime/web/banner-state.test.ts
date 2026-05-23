import { UserIdSchema } from "@packages/domain/user";
import {
	bannerStateFromRequest,
	initBuildBannerState,
} from "./banner-state";
import type { EffectiveAccess } from "../domain/access/effective-access";

const USER_ID = UserIdSchema.parse("user-1");
const ONE_DAY_MS = 86_400_000;
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

describe("bannerStateFromRequest", () => {
	it("maps a present userId to isAuthenticated=true", () => {
		expect(bannerStateFromRequest({ userId: USER_ID })).toMatchObject({
			isAuthenticated: true,
		});
	});

	it("maps a missing userId to isAuthenticated=false", () => {
		expect(bannerStateFromRequest({})).toMatchObject({
			isAuthenticated: false,
		});
	});

	it("passes emailVerified through unchanged for true, false, and undefined", () => {
		expect(bannerStateFromRequest({ emailVerified: true }).emailVerified).toBe(true);
		expect(bannerStateFromRequest({ emailVerified: false }).emailVerified).toBe(false);
		expect(bannerStateFromRequest({}).emailVerified).toBeUndefined();
	});

	it("sets showAccountMenu=true when query.feature is 'account'", () => {
		expect(bannerStateFromRequest({ query: { feature: "account" } }).showAccountMenu).toBe(true);
	});

	it("sets showAccountMenu=false when query.feature is absent", () => {
		expect(bannerStateFromRequest({}).showAccountMenu).toBe(false);
	});

	it("sets showAccountMenu=false when query.feature is a different value", () => {
		expect(bannerStateFromRequest({ query: { feature: "other" } }).showAccountMenu).toBe(false);
	});
});

describe("initBuildBannerState", () => {
	it("returns isAuthenticated=false with no trial for an unauthenticated request and never fetches access", async () => {
		const getEffectiveAccess = jest.fn();
		const buildBannerState = initBuildBannerState({
			getEffectiveAccess,
			now: () => FIXED_NOW,
		});

		const result = await buildBannerState({});

		expect(result).toEqual({ isAuthenticated: false, emailVerified: undefined, showAccountMenu: false });
		expect(getEffectiveAccess).not.toHaveBeenCalled();
	});

	it("populates trial.state='active' with the remaining window and escalation for a trialing user", async () => {
		const trialEndsAt = new Date(FIXED_NOW.getTime() + 3 * ONE_DAY_MS).toISOString();
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const buildBannerState = initBuildBannerState({
			getEffectiveAccess: async () => access,
			now: () => FIXED_NOW,
		});

		const result = await buildBannerState({ userId: USER_ID });

		expect(result.trial).toEqual({
			state: "active",
			endsAtIso: trialEndsAt,
			serverNowIso: FIXED_NOW.toISOString(),
			remaining: expect.objectContaining({ days: 3 }),
			escalation: "moderate",
		});
	});

	it("populates trial.state='expired' for both trial-expired and subscription-cancelled inactive users", async () => {
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

		const buildExpired = initBuildBannerState({
			getEffectiveAccess: async () => trialExpired,
			now: () => FIXED_NOW,
		});
		const buildCancelled = initBuildBannerState({
			getEffectiveAccess: async () => cancelled,
			now: () => FIXED_NOW,
		});

		expect((await buildExpired({ userId: USER_ID })).trial).toEqual({
			state: "expired",
		});
		expect((await buildCancelled({ userId: USER_ID })).trial).toEqual({
			state: "expired",
		});
	});

	it("leaves trial undefined for founding members and paid users", async () => {
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
			const build = initBuildBannerState({
				getEffectiveAccess: async () => access,
				now: () => FIXED_NOW,
			});
			expect((await build({ userId: USER_ID })).trial).toBeUndefined();
		}
	});

	it("honors a preFetchedAccess without re-invoking getEffectiveAccess (queue page already fetched it)", async () => {
		const trialEndsAt = new Date(FIXED_NOW.getTime() + ONE_DAY_MS).toISOString();
		const preFetchedAccess: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt,
		};
		const getEffectiveAccess = jest.fn();
		const buildBannerState = initBuildBannerState({
			getEffectiveAccess,
			now: () => FIXED_NOW,
		});

		const result = await buildBannerState(
			{ userId: USER_ID },
			{ preFetchedAccess },
		);

		expect(result.trial?.state).toBe("active");
		expect(getEffectiveAccess).not.toHaveBeenCalled();
	});
});
