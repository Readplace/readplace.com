import assert from "node:assert/strict";
import { generateCspNonce } from "@packages/web-shell";
import { type ChangelogBanner, isChangelogVersion } from "@packages/web-shell";
import { UserIdSchema } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import { initBuildBannerState } from "./banner-state";
import type { GetChangelogBanner } from "./changelog-banner-source";
import type { EffectiveAccess } from "@packages/subscription-access";

const USER_ID = UserIdSchema.parse("user-1");

const CSP_NONCE = generateCspNonce();
const ONE_DAY_MS = 86_400_000;
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

const noChangelogBanner: GetChangelogBanner = async () => undefined;

const noUser: FindUserById = async () => null;

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
		const buildBannerState = initBuildBannerState({
			getEffectiveAccess,
			getChangelogBanner: noChangelogBanner,
			findUserById: noUser,
			now: () => FIXED_NOW,
		});

		const result = await buildBannerState({ cspNonce: CSP_NONCE });

		expect(result).toEqual({
			isAuthenticated: false,
			emailVerified: undefined,
			gmailFeatureEnabled: false,
			cspNonce: CSP_NONCE,
		});
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
			getChangelogBanner: noChangelogBanner,
			findUserById: noUser,
			now: () => FIXED_NOW,
		});

		const result = await buildBannerState({ userId: USER_ID, cspNonce: CSP_NONCE });

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
			getChangelogBanner: noChangelogBanner,
			findUserById: noUser,
			now: () => FIXED_NOW,
		});
		const buildCancelled = initBuildBannerState({
			getEffectiveAccess: async () => cancelled,
			getChangelogBanner: noChangelogBanner,
			findUserById: noUser,
			now: () => FIXED_NOW,
		});

		expect((await buildExpired({ userId: USER_ID, cspNonce: CSP_NONCE })).trial).toEqual({
			state: "expired",
		});
		expect((await buildCancelled({ userId: USER_ID, cspNonce: CSP_NONCE })).trial).toEqual({
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
				getChangelogBanner: noChangelogBanner,
				findUserById: noUser,
				now: () => FIXED_NOW,
			});
			expect((await build({ userId: USER_ID, cspNonce: CSP_NONCE })).trial).toBeUndefined();
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
			getChangelogBanner: noChangelogBanner,
			findUserById: noUser,
			now: () => FIXED_NOW,
		});

		const result = await buildBannerState(
			{ userId: USER_ID, cspNonce: CSP_NONCE },
			{ preFetchedAccess },
		);

		expect(result.trial?.state).toBe("active");
		expect(getEffectiveAccess).not.toHaveBeenCalled();
	});

	it("populates trial.state='cancellation-scheduled' with the cancellation-effective-at instant for a user inside the cancel window and keeps accessIsReadOnly=false (import + account nav stay visible)", async () => {
		const cancellationEffectiveAt = new Date(
			FIXED_NOW.getTime() + 5 * ONE_DAY_MS,
		).toISOString();
		const access: EffectiveAccess = {
			tier: "paid",
			access: "full",
			banner: "cancellation-scheduled",
			cancellationEffectiveAt,
		};
		const buildBannerState = initBuildBannerState({
			getEffectiveAccess: async () => access,
			getChangelogBanner: noChangelogBanner,
			findUserById: noUser,
			now: () => FIXED_NOW,
		});

		const result = await buildBannerState({ userId: USER_ID, cspNonce: CSP_NONCE });

		expect(result.trial).toEqual({
			state: "cancellation-scheduled",
			endsAtIso: cancellationEffectiveAt,
			serverNowIso: FIXED_NOW.toISOString(),
		});
		expect(result.accessIsReadOnly).toBe(false);
	});

	describe("changelog banner", () => {
		it("includes the changelog banner for a guest, folded in before the unauthenticated early-return", async () => {
			const getEffectiveAccess = jest.fn();
			const build = initBuildBannerState({
				getEffectiveAccess,
				getChangelogBanner: async () => CHANGELOG,
				findUserById: noUser,
				now: () => FIXED_NOW,
			});

			const result = await build({ cspNonce: CSP_NONCE });

			expect(result).toEqual({
				isAuthenticated: false,
				emailVerified: undefined,
				changelogBanner: CHANGELOG,
				gmailFeatureEnabled: false,
				cspNonce: CSP_NONCE,
			});
			expect(getEffectiveAccess).not.toHaveBeenCalled();
		});

		it("drops the changelog banner when the reader has dismissed that exact version", async () => {
			const build = initBuildBannerState({
				getEffectiveAccess: jest.fn(),
				getChangelogBanner: async () => CHANGELOG,
				findUserById: noUser,
				now: () => FIXED_NOW,
			});

			const result = await build({ dismissedChangelogVersion: CHANGELOG.version, cspNonce: CSP_NONCE });

			expect(result.changelogBanner).toBeUndefined();
		});

		it("keeps the changelog banner when the dismissed version is for a different (older) announcement", async () => {
			const build = initBuildBannerState({
				getEffectiveAccess: jest.fn(),
				getChangelogBanner: async () => CHANGELOG,
				findUserById: noUser,
				now: () => FIXED_NOW,
			});

			const result = await build({ dismissedChangelogVersion: "ffffffff", cspNonce: CSP_NONCE });

			expect(result.changelogBanner).toEqual(CHANGELOG);
		});

		it("includes the changelog banner for an authenticated user alongside their trial state", async () => {
			const trialEndsAt = new Date(FIXED_NOW.getTime() + 3 * ONE_DAY_MS).toISOString();
			const access: EffectiveAccess = {
				tier: "trial",
				access: "full",
				banner: "trial-countdown",
				trialEndsAt,
			};
			const build = initBuildBannerState({
				getEffectiveAccess: async () => access,
				getChangelogBanner: async () => CHANGELOG,
				findUserById: noUser,
				now: () => FIXED_NOW,
			});

			const result = await build({ userId: USER_ID, cspNonce: CSP_NONCE });

			expect(result.changelogBanner).toEqual(CHANGELOG);
			expect(result.trial?.state).toBe("active");
		});

		it("leaves the state unchanged when there is nothing to announce", async () => {
			const build = initBuildBannerState({
				getEffectiveAccess: jest.fn(),
				getChangelogBanner: noChangelogBanner,
				findUserById: noUser,
				now: () => FIXED_NOW,
			});

			const result = await build({ cspNonce: CSP_NONCE });

			expect(result.changelogBanner).toBeUndefined();
		});
	});

	it("threads the request's originalUrl onto currentPath so the changelog dismiss form returns the reader to where they were", async () => {
		const build = initBuildBannerState({
			getEffectiveAccess: jest.fn(),
			getChangelogBanner: noChangelogBanner,
			findUserById: noUser,
			now: () => FIXED_NOW,
		});

		const result = await build({ originalUrl: "/queue?filter=unread", cspNonce: CSP_NONCE });

		expect(result.currentPath).toBe("/queue?filter=unread");
	});

	it("carries the signed-in user's stored appearance preference onto the banner state", async () => {
		const access: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
		const build = initBuildBannerState({
			getEffectiveAccess: async () => access,
			getChangelogBanner: noChangelogBanner,
			findUserById: async () => ({ userId: USER_ID, emailVerified: true, appearance: "dark" }),
			now: () => FIXED_NOW,
		});

		const result = await build({ userId: USER_ID, cspNonce: CSP_NONCE });

		expect(result.appearance).toBe("dark");
	});

	it("leaves appearance undefined when the signed-in user has no stored preference", async () => {
		const access: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
		const build = initBuildBannerState({
			getEffectiveAccess: async () => access,
			getChangelogBanner: noChangelogBanner,
			findUserById: async () => ({ userId: USER_ID, emailVerified: true }),
			now: () => FIXED_NOW,
		});

		const result = await build({ userId: USER_ID, cspNonce: CSP_NONCE });

		expect(result.appearance).toBeUndefined();
	});

	it("uses a pre-fetched user instead of reading it again, so a caller that already loaded the user pays no second read", async () => {
		const access: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
		const findUserById = jest.fn();
		const build = initBuildBannerState({
			getEffectiveAccess: async () => access,
			getChangelogBanner: noChangelogBanner,
			findUserById,
			now: () => FIXED_NOW,
		});

		const result = await build(
			{ userId: USER_ID, cspNonce: CSP_NONCE },
			{ preFetchedAccess: access, preFetchedUser: { userId: USER_ID, emailVerified: true, appearance: "light" } },
		);

		expect(result.appearance).toBe("light");
		expect(findUserById).not.toHaveBeenCalled();
	});
});
