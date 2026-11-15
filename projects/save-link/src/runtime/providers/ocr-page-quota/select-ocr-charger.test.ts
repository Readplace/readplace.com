import assert from "node:assert/strict";
import type { ChargeOcrPages } from "@packages/crawl-article";
import type { EffectiveAccess } from "@packages/subscription-access";
import { UserIdSchema } from "@packages/domain/user";
import { initChargeOcrPagesForAccount, selectOcrCharger } from "./select-ocr-charger";

const refuse: ChargeOcrPages = async () => ({ allowed: false, pagesLeft: 0, retryAt: new Date("2026-11-16T00:00:00Z") });

describe("selectOcrCharger", () => {
	it.each<EffectiveAccess>([
		{ tier: "founding", banner: "none" },
		{ tier: "paid", banner: "none" },
		{ tier: "trial", banner: "trial-countdown", trialEndsAt: "2026-12-01T00:00:00Z" },
	])("never counts pages for a $tier account", async (access) => {
		assert.deepEqual(await selectOcrCharger({ access, quota: refuse })({ pages: 300 }), { allowed: true });
	});

	it("counts pages for a free account", async () => {
		const access: EffectiveAccess = { tier: "free", banner: "free", reason: "trial-expired" };
		assert.equal(selectOcrCharger({ access, quota: refuse }), refuse);
	});
});

describe("initChargeOcrPagesForAccount", () => {
	it("reads the saver's access at charge time and charges the saver's quota", async () => {
		const userId = UserIdSchema.parse("reader-1");
		const quotaCalls: unknown[] = [];
		const chargeOcrPagesFor = initChargeOcrPagesForAccount({
			getEffectiveAccess: async () => ({ tier: "free", banner: "free", reason: "trial-expired" }),
			quota: (params) => {
				quotaCalls.push(params);
				return refuse;
			},
		});

		const result = await chargeOcrPagesFor({ userId, claimId: "msg-1" })({ pages: 4 });

		assert.equal(result.allowed, false);
		assert.deepEqual(quotaCalls, [{ userId, claimId: "msg-1" }]);
	});
});
