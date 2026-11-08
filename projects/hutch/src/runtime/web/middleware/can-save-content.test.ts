import assert from "node:assert/strict";
import type { Request } from "express";
import { authenticatedUserIdFrom, type VerificationStatus } from "@packages/domain/user";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initCanSaveContent } from "./can-save-content";

const TEST_USER_ID = authenticatedUserIdFrom("11112222333344445555666677778888");
const NOW = new Date("2026-05-23T12:00:00.000Z");
const ONE_DAY_MS = 86_400_000;

function requestFor(verificationStatus?: VerificationStatus): Pick<Request, "userId" | "verificationStatus"> {
	return { userId: TEST_USER_ID, verificationStatus };
}

async function setup(access: "full" | "read-only") {
	const providers = initInMemorySubscriptionProviders({ now: () => NOW });
	if (access === "read-only") {
		await providers.upsertTrialing({
			userId: TEST_USER_ID,
			trialEndsAt: new Date(NOW.getTime() - ONE_DAY_MS).toISOString(),
		});
	}
	return initCanSaveContent({ findSubscriptionByUserId: providers.findByUserId, now: () => NOW });
}

describe("initCanSaveContent", () => {
	it("lets an unlocked reader with full write access save", async () => {
		const canSaveContent = await setup("full");

		assert.equal(await canSaveContent(requestFor({ state: "counting-down", daysLeft: 3 })), true);
	});

	it("refuses an unlocked reader whose subscription is read-only", async () => {
		const canSaveContent = await setup("read-only");

		assert.equal(await canSaveContent(requestFor()), false);
	});

	it("refuses a locked reader even with full write access", async () => {
		const canSaveContent = await setup("full");

		assert.equal(await canSaveContent(requestFor({ state: "locked" })), false);
	});

	it("refuses a locked reader whose subscription is read-only", async () => {
		const canSaveContent = await setup("read-only");

		assert.equal(await canSaveContent(requestFor({ state: "locked" })), false);
	});
});
