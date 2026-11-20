import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { EmailMessage } from "@packages/provider-contracts/email";
import { VerificationTokenSchema } from "@packages/provider-contracts/email-verification";
import { initAgeLockAccount } from "./age-lock-account";

const USER_ID = UserIdSchema.parse("a".repeat(32));
const TOKEN = VerificationTokenSchema.parse("b".repeat(64));

function lockWith(email: string | null) {
	const calls: unknown[] = [];
	const sent: EmailMessage[] = [];
	const lock = initAgeLockAccount({
		markAgeLocked: async (input) => {
			calls.push(["markAgeLocked", input]);
		},
		revokeAllUserOAuthTokens: async (userId, cause) => {
			calls.push(["revokeAllUserOAuthTokens", userId, cause]);
		},
		destroyUserSessions: async (userId) => {
			calls.push(["destroyUserSessions", userId]);
		},
		createAgeLockDeletionSchedule: async (input) => {
			calls.push(["createAgeLockDeletionSchedule", input]);
		},
		findEmailByUserId: async () => email,
		createAgeUnlockToken: async (input) => {
			calls.push(["createAgeUnlockToken", input]);
			return TOKEN;
		},
		sendEmail: async (message) => {
			sent.push(message);
		},
		baseUrl: "https://readplace.com",
		now: () => new Date("2026-11-20T09:00:00.000Z"),
	});
	return { lock, calls, sent };
}

describe("initAgeLockAccount", () => {
	it("locks the account, signs it out everywhere, schedules deletion 30 days out and emails an unlock link", async () => {
		const { lock, calls, sent } = lockWith("reader@example.com");

		await lock(USER_ID);

		assert.deepEqual(calls, [
			["markAgeLocked", { userId: USER_ID, at: "2026-11-20T09:00:00.000Z" }],
			["revokeAllUserOAuthTokens", USER_ID, "logout-all"],
			["destroyUserSessions", USER_ID],
			["createAgeLockDeletionSchedule", { userId: USER_ID, firesAt: "2026-12-20T09:00:00.000Z" }],
			["createAgeUnlockToken", { userId: USER_ID, email: "reader@example.com" }],
		]);
		assert.equal(sent.length, 1);
		assert.equal(sent[0]?.to, "reader@example.com");
		assert.equal(sent[0]?.subject, "your Readplace account is paused");
		assert.ok(sent[0]?.html.includes(`https://readplace.com/account/age-unlock?token&#x3D;${TOKEN}`));
	});

	it("refuses to finish when the account has no email to send the unlock link to", async () => {
		const { lock } = lockWith(null);

		await assert.rejects(lock(USER_ID), /no email/);
	});
});
