import assert from "node:assert/strict";
import { UserIdSchema, hashPassword, verifyPassword } from "@packages/domain/user";
import { initInMemoryAuth } from "./in-memory-auth";
import { initInMemoryIsAccountLive } from "./in-memory-is-account-live";

async function signedUpAccount() {
	const auth = initInMemoryAuth({ hashPassword, verifyPassword, now: () => new Date() });
	const created = await auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok, "the user must be created");
	return { auth, userId: created.userId, isAccountLive: initInMemoryIsAccountLive({ findUserById: auth.findUserById }) };
}

describe("initInMemoryIsAccountLive", () => {
	it("reports an account live after signup", async () => {
		const { userId, isAccountLive } = await signedUpAccount();

		expect(await isAccountLive(userId)).toBe(true);
	});

	it("reports an account not live once it is marked deleted", async () => {
		const { auth, userId, isAccountLive } = await signedUpAccount();

		await auth.markAccountDeleted({ userId, at: "2026-11-03T10:00:00.000Z" });

		expect(await isAccountLive(userId)).toBe(false);
	});

	it("reports an account not live once it is closed", async () => {
		const { auth, userId, isAccountLive } = await signedUpAccount();

		await auth.closeUserAccount(userId);

		expect(await isAccountLive(userId)).toBe(false);
	});

	it("reports an unknown user id not live", async () => {
		const { isAccountLive } = await signedUpAccount();

		expect(await isAccountLive(UserIdSchema.parse("nobody"))).toBe(false);
	});
});
