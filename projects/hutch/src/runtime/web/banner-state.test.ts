import { generateCspNonce } from "@packages/web-shell";
import { FETCH_CHANGELOG_BANNER_IN_BROWSER } from "@packages/web-shell";
import { UserIdSchema } from "@packages/domain/user";
import type { FindUserById } from "@packages/provider-contracts/auth";
import { initBuildBannerState } from "./banner-state";
import type { EffectiveAccess } from "@packages/subscription-access";

const USER_ID = UserIdSchema.parse("user-1");

const CSP_NONCE = generateCspNonce();

const noUser: FindUserById = async () => null;

describe("initBuildBannerState", () => {
	it("returns isAuthenticated=false for an unauthenticated request and never fetches access", async () => {
		const getEffectiveAccess = jest.fn();
		const buildBannerState = initBuildBannerState({
			getEffectiveAccess,
			findUserById: noUser,
		});

		const result = await buildBannerState({ cspNonce: CSP_NONCE });

		expect(result).toEqual({
			isAuthenticated: false,
			emailVerified: undefined,
			changelogBanner: FETCH_CHANGELOG_BANNER_IN_BROWSER,
			cspNonce: CSP_NONCE,
		});
		expect(getEffectiveAccess).not.toHaveBeenCalled();
	});

	it("hands a trialing user's header no trial countdown: the state carries only the shell fields and access", async () => {
		const access: EffectiveAccess = {
			tier: "trial",
			access: "full",
			banner: "trial-countdown",
			trialEndsAt: "2026-01-04T00:00:00.000Z",
		};
		const buildBannerState = initBuildBannerState({
			getEffectiveAccess: async () => access,
			findUserById: noUser,
		});

		const result = await buildBannerState({ userId: USER_ID, cspNonce: CSP_NONCE });

		expect(result).toEqual({
			isAuthenticated: true,
			emailVerified: undefined,
			changelogBanner: FETCH_CHANGELOG_BANNER_IN_BROWSER,
			cspNonce: CSP_NONCE,
			accessIsReadOnly: false,
		});
	});

	it("marks both trial-expired and subscription-cancelled inactive users read-only", async () => {
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
			findUserById: noUser,
		});
		const buildCancelled = initBuildBannerState({
			getEffectiveAccess: async () => cancelled,
			findUserById: noUser,
		});

		expect((await buildExpired({ userId: USER_ID, cspNonce: CSP_NONCE })).accessIsReadOnly).toBe(true);
		expect((await buildCancelled({ userId: USER_ID, cspNonce: CSP_NONCE })).accessIsReadOnly).toBe(true);
	});

	it("keeps full access for founding members, paid users, and a user inside the cancellation window", async () => {
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
		const cancellationScheduled: EffectiveAccess = {
			tier: "paid",
			access: "full",
			banner: "cancellation-scheduled",
			cancellationEffectiveAt: "2026-01-06T00:00:00.000Z",
		};

		for (const access of [founding, paid, cancellationScheduled]) {
			const build = initBuildBannerState({
				getEffectiveAccess: async () => access,
				findUserById: noUser,
			});
			expect((await build({ userId: USER_ID, cspNonce: CSP_NONCE })).accessIsReadOnly).toBe(false);
		}
	});

	it("honors a preFetchedAccess without re-invoking getEffectiveAccess (queue page already fetched it)", async () => {
		const preFetchedAccess: EffectiveAccess = {
			tier: "inactive",
			access: "read-only",
			banner: "inactive",
			reason: "trial-expired",
		};
		const getEffectiveAccess = jest.fn();
		const buildBannerState = initBuildBannerState({
			getEffectiveAccess,
			findUserById: noUser,
		});

		const result = await buildBannerState(
			{ userId: USER_ID, cspNonce: CSP_NONCE },
			{ preFetchedAccess },
		);

		expect(result.accessIsReadOnly).toBe(true);
		expect(getEffectiveAccess).not.toHaveBeenCalled();
	});

	it("leaves the changelog banner for the browser to fetch for an authenticated user", async () => {
		const access: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
		const build = initBuildBannerState({
			getEffectiveAccess: async () => access,
			findUserById: noUser,
		});

		const result = await build({ userId: USER_ID, cspNonce: CSP_NONCE });

		expect(result.changelogBanner).toBe(FETCH_CHANGELOG_BANNER_IN_BROWSER);
	});

	it("threads the request's originalUrl onto currentPath so the changelog dismiss form returns the reader to where they were", async () => {
		const build = initBuildBannerState({
			getEffectiveAccess: jest.fn(),
			findUserById: noUser,
		});

		const result = await build({ originalUrl: "/queue?filter=unread", cspNonce: CSP_NONCE });

		expect(result.currentPath).toBe("/queue?filter=unread");
	});

	it("carries the signed-in user's stored appearance preference onto the banner state", async () => {
		const access: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
		const build = initBuildBannerState({
			getEffectiveAccess: async () => access,
			findUserById: async () => ({ userId: USER_ID, email: "james.davis@example.com", emailVerified: true, appearance: "dark" }),
		});

		const result = await build({ userId: USER_ID, cspNonce: CSP_NONCE });

		expect(result.appearance).toBe("dark");
	});

	it("carries the signed-in user's email onto the banner state so the header can name the account", async () => {
		const access: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
		const build = initBuildBannerState({
			getEffectiveAccess: async () => access,
			findUserById: async () => ({ userId: USER_ID, email: "james.davis@example.com", emailVerified: true }),
		});

		const result = await build({ userId: USER_ID, cspNonce: CSP_NONCE });

		expect(result.userEmail).toBe("james.davis@example.com");
	});

	it("leaves the email off the banner state for a guest, who has no account to name", async () => {
		const build = initBuildBannerState({
			getEffectiveAccess: async () => ({ tier: "founding", access: "full", banner: "none" }),
			findUserById: noUser,
		});

		const result = await build({ cspNonce: CSP_NONCE });

		expect(result.userEmail).toBeUndefined();
	});

	it("leaves appearance undefined when the signed-in user has no stored preference", async () => {
		const access: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
		const build = initBuildBannerState({
			getEffectiveAccess: async () => access,
			findUserById: async () => ({ userId: USER_ID, email: "james.davis@example.com", emailVerified: true }),
		});

		const result = await build({ userId: USER_ID, cspNonce: CSP_NONCE });

		expect(result.appearance).toBeUndefined();
	});

	it("uses a pre-fetched user instead of reading it again, so a caller that already loaded the user pays no second read", async () => {
		const access: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
		const findUserById = jest.fn();
		const build = initBuildBannerState({
			getEffectiveAccess: async () => access,
			findUserById,
		});

		const result = await build(
			{ userId: USER_ID, cspNonce: CSP_NONCE },
			{ preFetchedAccess: access, preFetchedUser: { userId: USER_ID, email: "james.davis@example.com", emailVerified: true, appearance: "light" } },
		);

		expect(result.appearance).toBe("light");
		expect(findUserById).not.toHaveBeenCalled();
	});
});
