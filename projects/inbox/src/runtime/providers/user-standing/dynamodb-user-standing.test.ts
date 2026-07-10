import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbUserStanding } from "./dynamodb-user-standing";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (input: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

const TABLES = { users: "test-users", sessions: "test-sessions" };
const USER_ID = UserIdSchema.parse("11112222333344445555666677778888");

function initWithFake(impl: (input: unknown) => unknown) {
	const client = createFakeClient(impl);
	return initDynamoDbUserStanding({
		client: client as DynamoDBDocumentClient,
		tableNames: TABLES,
	});
}

type CapturedCommandInput = {
	TableName?: string;
	IndexName?: string;
	ProjectionExpression?: string;
	KeyConditionExpression?: string;
	ExpressionAttributeValues?: Record<string, unknown>;
	Key?: Record<string, unknown>;
	UpdateExpression?: string;
};

function commandInput(input: unknown): CapturedCommandInput {
	return (input as { input: CapturedCommandInput }).input;
}

describe("initDynamoDbUserStanding", () => {
	describe("findUserById", () => {
		it("queries the users userId-index with a standing-only projection", async () => {
			let captured: CapturedCommandInput = {};
			const { findUserById } = initWithFake((input) => {
				captured = commandInput(input);
				return {
					Items: [
						{
							userId: USER_ID,
							emailVerified: true,
							registeredAt: "2026-01-01T00:00:00.000Z",
						},
					],
				};
			});

			const user = await findUserById(USER_ID);

			assert(user, "user must be returned");
			expect(user).toEqual({
				userId: USER_ID,
				emailVerified: true,
				registeredAt: "2026-01-01T00:00:00.000Z",
			});
			expect(captured.TableName).toBe(TABLES.users);
			expect(captured.IndexName).toBe("userId-index");
			expect(captured.ProjectionExpression).toBe("userId, emailVerified, registeredAt");
			expect(captured.ExpressionAttributeValues).toEqual({ ":userId": USER_ID });
		});

		it("reads an absent emailVerified attribute as false (legacy row)", async () => {
			const { findUserById } = initWithFake(() => ({
				Items: [{ userId: USER_ID, registeredAt: "2026-01-01T00:00:00.000Z" }],
			}));

			const user = await findUserById(USER_ID);

			assert(user, "user must be returned");
			expect(user.emailVerified).toBe(false);
		});

		it("returns null when the index has no match", async () => {
			const { findUserById } = initWithFake(() => ({ Items: [] }));

			expect(await findUserById(USER_ID)).toBeNull();
		});
	});

	describe("markSessionEmailVerified", () => {
		it("updates the session row's emailVerified flag", async () => {
			let captured: CapturedCommandInput = {};
			const { markSessionEmailVerified } = initWithFake((input) => {
				captured = commandInput(input);
				return {};
			});

			await markSessionEmailVerified("session-abc");

			expect(captured.TableName).toBe(TABLES.sessions);
			expect(captured.Key).toEqual({ sessionId: "session-abc" });
			expect(captured.UpdateExpression).toBe("SET emailVerified = :val");
			expect(captured.ExpressionAttributeValues).toEqual({ ":val": true });
		});
	});
});
