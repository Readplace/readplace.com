import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { initInMemoryAuth, initInMemoryIsAccountLive } from "@packages/test-fixtures/providers/auth";
import { initResolveSubmitterStanding } from "./resolve-submitter-standing";

const now = () => new Date("2026-11-03T10:00:00.000Z");

async function signedUpReader() {
	const auth = initInMemoryAuth({ hashPassword, verifyPassword, now });
	const created = await auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok, "the reader must sign up");
	const resolveSubmitterStanding = initResolveSubmitterStanding({
		isAccountLive: initInMemoryIsAccountLive({ findUserById: auth.findUserById }),
	});
	return { auth, userId: created.userId, resolveSubmitterStanding };
}

describe("initResolveSubmitterStanding", () => {
	it("lets a live reader save", async () => {
		const { userId, resolveSubmitterStanding } = await signedUpReader();

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

});
