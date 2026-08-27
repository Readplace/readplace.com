import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailCredentials } from "./in-memory-gmail-credentials";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

describe("initInMemoryGmailCredentials", () => {
	it("returns the refresh token it stored for the owner", async () => {
		const store = initInMemoryGmailCredentials({ now: () => new Date() });

		await store.saveCredentials({ userId: owner, refreshToken: "refresh-1", grantedScope: SCOPE });

		assert.equal(await store.findRefreshTokenByUserId(owner), "refresh-1");
	});

	it("scopes credentials to their owner", async () => {
		const store = initInMemoryGmailCredentials({ now: () => new Date() });

		await store.saveCredentials({ userId: owner, refreshToken: "refresh-1", grantedScope: SCOPE });

		assert.equal(await store.findRefreshTokenByUserId(otherUser), undefined);
	});

	it("replaces the token when the user reconnects", async () => {
		const store = initInMemoryGmailCredentials({ now: () => new Date() });
		await store.saveCredentials({ userId: owner, refreshToken: "refresh-1", grantedScope: SCOPE });

		await store.saveCredentials({ userId: owner, refreshToken: "refresh-2", grantedScope: SCOPE });

		assert.equal(await store.findRefreshTokenByUserId(owner), "refresh-2");
	});

	it("forgets the token on disconnect", async () => {
		const store = initInMemoryGmailCredentials({ now: () => new Date() });
		await store.saveCredentials({ userId: owner, refreshToken: "refresh-1", grantedScope: SCOPE });

		await store.deleteCredentials(owner);

		assert.equal(await store.findRefreshTokenByUserId(owner), undefined);
	});

	it("reports no token for a user who never connected", async () => {
		const store = initInMemoryGmailCredentials({ now: () => new Date() });

		assert.equal(await store.findRefreshTokenByUserId(owner), undefined);
	});
});
