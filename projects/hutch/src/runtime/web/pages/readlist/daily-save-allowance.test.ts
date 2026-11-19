import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { EffectiveAccess } from "@packages/subscription-access";
import { isDailyLimited } from "@packages/subscription-access";
import type { ClaimRateLimitUnits } from "@packages/provider-contracts/rate-limit";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { initClaimDailySaves } from "./daily-save-allowance";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const DAY_RULE = { limit: 28, windowSeconds: 86_400 };
const PAID: EffectiveAccess = { tier: "paid", banner: "none" };
const METERED: EffectiveAccess = {
	tier: "free",
	banner: "free",
	reason: "trial-expired",
};

function urls(count: number, prefix = "new"): string[] {
	return Array.from({ length: count }, (_value, index) => `https://example.com/${prefix}-${index}`);
}

function initMetered(input: { saved?: readonly string[]; claimRateLimitUnits?: ClaimRateLimitUnits }) {
	const limiter = initInMemoryRateLimit({ now: () => new Date(0) });
	const claimRateLimitUnits = input.claimRateLimitUnits ?? limiter.claimRateLimitUnits;
	const saved = new Set(input.saved ?? []);
	const claimDailySaves = initClaimDailySaves({
		getEffectiveAccess: async () => METERED,
		isDailyLimited,
		findSavedUrls: async ({ urls: asked }) => asked.filter((url) => saved.has(url)),
		claimRateLimitUnits,
		rule: DAY_RULE,
	});
	return { claimDailySaves, limiter };
}

describe("initClaimDailySaves", () => {
	it("grants a full-access account everything without asking the limiter or the store", async () => {
		const claimDailySaves = initClaimDailySaves({
			getEffectiveAccess: async () => PAID,
			isDailyLimited,
			findSavedUrls: async () => {
				throw new Error("findSavedUrls must not be called for a full-access account");
			},
			claimRateLimitUnits: async () => {
				throw new Error("the limiter must not be called for a full-access account");
			},
			rule: DAY_RULE,
		});

		const claim = await claimDailySaves({ userId: USER, urls: urls(40) });

		assert.deepEqual(claim, { granted: urls(40), refused: [], retryAfterSeconds: undefined });
	});

	it("claims new links from the daily-saves bucket keyed by the user", async () => {
		const claims: Parameters<ClaimRateLimitUnits>[0][] = [];
		const { claimDailySaves } = initMetered({
			claimRateLimitUnits: async (claim) => {
				claims.push(claim);
				return { granted: claim.requested, retryAfterSeconds: undefined };
			},
		});

		await claimDailySaves({ userId: USER, urls: urls(2) });

		assert.deepEqual(claims, [{ bucket: "daily-saves", key: USER, requested: 2, rule: DAY_RULE }]);
	});

	it("grants 28 of 30 new links from an unspent day, in input order", async () => {
		const { claimDailySaves } = initMetered({});

		const claim = await claimDailySaves({ userId: USER, urls: urls(30) });

		assert.deepEqual(claim.granted, urls(30).slice(0, 28));
		assert.deepEqual(claim.refused, urls(30).slice(28));
		assert.equal(claim.retryAfterSeconds, 86_400);
	});

	it("never charges a link the account already holds", async () => {
		const alreadySaved = urls(3, "saved");
		const { claimDailySaves, limiter } = initMetered({ saved: alreadySaved });
		await limiter.claimRateLimitUnits({ bucket: "daily-saves", key: USER, requested: 28, rule: DAY_RULE });

		const claim = await claimDailySaves({ userId: USER, urls: [...alreadySaved, ...urls(1)] });

		assert.deepEqual(claim, { granted: alreadySaved, refused: urls(1), retryAfterSeconds: 86_400 });
	});

	it("charges a link repeated in one request once", async () => {
		const { claimDailySaves, limiter } = initMetered({});
		const [url] = urls(1);

		const claim = await claimDailySaves({ userId: USER, urls: [url, url] });

		assert.deepEqual(claim, { granted: [url, url], refused: [], retryAfterSeconds: undefined });
		const left = await limiter.claimRateLimitUnits({ bucket: "daily-saves", key: USER, requested: 28, rule: DAY_RULE });
		assert.equal(left.granted, 27);
	});

	it("skips the limiter when every link is already saved", async () => {
		const alreadySaved = urls(2, "saved");
		const { claimDailySaves } = initMetered({
			saved: alreadySaved,
			claimRateLimitUnits: async () => {
				throw new Error("the limiter must not be called when nothing new is saved");
			},
		});

		const claim = await claimDailySaves({ userId: USER, urls: alreadySaved });

		assert.deepEqual(claim, { granted: alreadySaved, refused: [], retryAfterSeconds: undefined });
	});
});
