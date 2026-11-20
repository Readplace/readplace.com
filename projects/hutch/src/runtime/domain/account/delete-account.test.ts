import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { initDeleteAccount } from "./delete-account";

const USER_ID = UserIdSchema.parse("a".repeat(32));

describe("initDeleteAccount", () => {
	it("marks the account deleted, revokes OAuth tokens, destroys sessions, then publishes DeleteAccountCommand, in that order", async () => {
		const calls: unknown[] = [];
		const deleteAccount = initDeleteAccount({
			markAccountDeleted: async (input) => {
				calls.push(["markAccountDeleted", input]);
			},
			revokeAllUserOAuthTokens: async (userId, cause) => {
				calls.push(["revokeAllUserOAuthTokens", userId, cause]);
			},
			destroyUserSessions: async (userId) => {
				calls.push(["destroyUserSessions", userId]);
			},
			publishDeleteAccountCommand: async (params) => {
				calls.push(["publishDeleteAccountCommand", params]);
			},
			now: () => new Date("2026-11-20T09:00:00.000Z"),
		});

		await deleteAccount(USER_ID);

		assert.deepEqual(calls, [
			["markAccountDeleted", { userId: USER_ID, at: "2026-11-20T09:00:00.000Z" }],
			["revokeAllUserOAuthTokens", USER_ID, "account-deletion"],
			["destroyUserSessions", USER_ID],
			["publishDeleteAccountCommand", { userId: USER_ID }],
		]);
	});
});
