import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { resolveEffectiveAccess } from "@packages/subscription-access";
import { initHasNoOcrPagesLeft } from "./ocr-page-allowance";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const getEffectiveAccess = async () => resolveEffectiveAccess(undefined, new Date(0));

describe("initHasNoOcrPagesLeft", () => {
	it("never refuses an account that is not daily limited, without reading its page counter", async () => {
		const reads: unknown[] = [];
		const hasNoOcrPagesLeft = initHasNoOcrPagesLeft({
			getEffectiveAccess,
			isDailyLimited: () => false,
			readOcrPagesLeft: async (params) => {
				reads.push(params);
				return 0;
			},
		});

		assert.equal(await hasNoOcrPagesLeft({ userId: USER }), false);
		assert.deepEqual(reads, []);
	});

	it("refuses a metered account whose day's pages are spent", async () => {
		const hasNoOcrPagesLeft = initHasNoOcrPagesLeft({ getEffectiveAccess, isDailyLimited: () => true, readOcrPagesLeft: async () => 0 });

		assert.equal(await hasNoOcrPagesLeft({ userId: USER }), true);
	});

	it("lets a metered account with a page left through", async () => {
		const hasNoOcrPagesLeft = initHasNoOcrPagesLeft({ getEffectiveAccess, isDailyLimited: () => true, readOcrPagesLeft: async () => 1 });

		assert.equal(await hasNoOcrPagesLeft({ userId: USER }), false);
	});
});
