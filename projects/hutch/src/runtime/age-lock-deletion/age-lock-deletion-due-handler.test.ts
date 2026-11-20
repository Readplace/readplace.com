import assert from "node:assert/strict";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { DeleteAccountCommand } from "@packages/infra-components";
import { Logger, noopLogger } from "@packages/logger";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initDeleteAccount } from "../domain/account/delete-account";
import { initAgeLockDeletionDueHandler } from "./age-lock-deletion-due-handler";

const NOW = new Date("2026-12-20T00:00:00.000Z");

function buildSubject() {
	const auth = initInMemoryAuth({
		hashPassword: async (password) => `hashed:${password}`,
		verifyPassword: async (password, stored) => stored === `hashed:${password}`,
		now: () => NOW,
	});
	const published: Array<{ detailType: string; detail: unknown }> = [];
	const revocations: UserId[] = [];
	const infoLines: Array<{ message: string; context: unknown }> = [];
	const handler = initAgeLockDeletionDueHandler({
		findUserById: auth.findUserById,
		deleteAccount: initDeleteAccount({
			markAccountDeleted: auth.markAccountDeleted,
			revokeAllUserOAuthTokens: async (userId) => {
				revocations.push(userId);
			},
			destroyUserSessions: auth.destroyUserSessions,
			publishDeleteAccountCommand: async (params) => {
				published.push({ detailType: DeleteAccountCommand.detailType, detail: params });
			},
			now: () => NOW,
		}),
		logger: Logger.from({
			...noopLogger,
			info: (message, context) => {
				infoLines.push({ message: String(message), context });
			},
		}),
	});
	return { auth, published, revocations, infoLines, handler };
}

type Subject = ReturnType<typeof buildSubject>;

async function signUp(s: Subject, email: string): Promise<UserId> {
	const created = await s.auth.createUser({ email, password: "password123" });
	assert(created.ok, "sign-up failed");
	return created.userId;
}

async function run(s: Subject, userId: string | undefined) {
	const result = await s.handler(
		buildSqsEvent([{ messageId: "msg", body: JSON.stringify({ detail: { userId } }) }]),
		buildLambdaContext(),
		() => {},
	);
	assert(result, "handler must return an SQSBatchResponse");
	return result;
}

describe("age-lock deletion due handler", () => {
	it("deletes a still-locked account: marks it deleted, revokes its tokens and publishes DeleteAccountCommand", async () => {
		const s = buildSubject();
		const userId = await signUp(s, "locked@example.com");
		await s.auth.markAgeLocked({ userId, at: "2026-11-20T00:00:00.000Z" });

		const result = await run(s, userId);

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(s.published, [{ detailType: "DeleteAccountCommand", detail: { userId } }]);
		assert.deepEqual(s.revocations, [userId]);
		assert.equal((await s.auth.findUserById(userId))?.deletedAt, NOW.toISOString());
		assert.deepEqual(s.infoLines, [
			{ message: "[age-lock-deletion] completed", context: { userId, outcome: "deleted" } },
		]);
	});

	it("does nothing when the holder unlocked the account before the schedule fired", async () => {
		const s = buildSubject();
		const userId = await signUp(s, "unlocked@example.com");

		const result = await run(s, userId);

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(s.published, []);
		assert.deepEqual(s.revocations, []);
		assert.deepEqual(s.infoLines, [
			{ message: "[age-lock-deletion] completed", context: { userId, outcome: "not-locked" } },
		]);
	});

	it("does nothing when the account was already deleted", async () => {
		const s = buildSubject();
		const userId = await signUp(s, "gone@example.com");
		await s.auth.markAgeLocked({ userId, at: "2026-11-20T00:00:00.000Z" });
		await s.auth.markAccountDeleted({ userId, at: "2026-11-21T00:00:00.000Z" });

		const result = await run(s, userId);

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(s.published, []);
		assert.deepEqual(s.infoLines, [
			{ message: "[age-lock-deletion] completed", context: { userId, outcome: "already-deleted" } },
		]);
	});

	it("does nothing when the user row no longer exists", async () => {
		const s = buildSubject();
		const userId = UserIdSchema.parse("9".repeat(32));

		const result = await run(s, userId);

		assert.deepEqual(result.batchItemFailures, []);
		assert.deepEqual(s.published, []);
		assert.deepEqual(s.infoLines, [
			{ message: "[age-lock-deletion] completed", context: { userId, outcome: "user-missing" } },
		]);
	});

	it("reports a malformed message for retry without deleting anything", async () => {
		const s = buildSubject();

		const result = await run(s, undefined);

		assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "msg" }]);
		assert.deepEqual(s.published, []);
	});
});
