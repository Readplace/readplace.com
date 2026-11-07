import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { initInMemoryAuth, initInMemoryIsAccountLive } from "@packages/test-fixtures/providers/auth";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initResolveSubmitterStanding } from "./resolve-submitter-standing";

const now = () => new Date("2026-11-03T10:00:00.000Z");

async function signedUpReader() {
	const auth = initInMemoryAuth({ hashPassword, verifyPassword, now });
	const created = await auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok, "the reader must sign up");
	const subscriptions = initInMemorySubscriptionProviders({ now });
	const resolveSubmitterStanding = initResolveSubmitterStanding({
		isAccountLive: initInMemoryIsAccountLive({ findUserById: auth.findUserById }),
		findSubscriptionByUserId: subscriptions.findByUserId,
		now,
	});
	return { auth, subscriptions, userId: created.userId, resolveSubmitterStanding };
}

describe("initResolveSubmitterStanding", () => {
	it("lets a live reader with full access save", async () => {
		const { subscriptions, userId, resolveSubmitterStanding } = await signedUpReader();
		await subscriptions.upsertTrialing({ userId, trialEndsAt: "2026-11-10T10:00:00.000Z" });

		assert.equal(await resolveSubmitterStanding(userId), "may-save");
	});

	it("reports a closed account gone", async () => {
		const { auth, userId, resolveSubmitterStanding } = await signedUpReader();
		await auth.closeUserAccount(userId);

		assert.equal(await resolveSubmitterStanding(userId), "account-gone");
	});

	it("reports an account marked deleted gone", async () => {
		const { auth, userId, resolveSubmitterStanding } = await signedUpReader();
		await auth.markAccountDeleted({ userId, at: "2026-11-03T09:00:00.000Z" });

		assert.equal(await resolveSubmitterStanding(userId), "account-gone");
	});

	it("reports a cancelled reader read-only", async () => {
		const { subscriptions, userId, resolveSubmitterStanding } = await signedUpReader();
		await subscriptions.upsertActive({ userId, subscriptionId: "sub_1", customerId: "cus_1" });
		await subscriptions.markCancelledByUserId({ userId });

		assert.equal(await resolveSubmitterStanding(userId), "read-only");
	});

	it("lets a founding member with no subscription row save", async () => {
		const { userId, resolveSubmitterStanding } = await signedUpReader();

		assert.equal(await resolveSubmitterStanding(userId), "may-save");
	});
});
