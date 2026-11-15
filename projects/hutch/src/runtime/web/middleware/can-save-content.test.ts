import assert from "node:assert/strict";
import type { Request } from "express";
import { authenticatedUserIdFrom, type VerificationStatus } from "@packages/domain/user";
import { initCanSaveContent } from "./can-save-content";

const TEST_USER_ID = authenticatedUserIdFrom("11112222333344445555666677778888");

function requestFor(verificationStatus?: VerificationStatus): Pick<Request, "userId" | "verificationStatus"> {
	return { userId: TEST_USER_ID, verificationStatus };
}

describe("initCanSaveContent", () => {
	it("lets an unlocked reader save, whatever plan they are on", async () => {
		const canSaveContent = initCanSaveContent();

		assert.equal(await canSaveContent(requestFor({ state: "counting-down", daysLeft: 3 })), true);
		assert.equal(await canSaveContent(requestFor()), true);
	});

	it("refuses a locked reader", async () => {
		const canSaveContent = initCanSaveContent();

		assert.equal(await canSaveContent(requestFor({ state: "locked" })), false);
	});
});
