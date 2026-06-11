import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbRateLimit } from "./dynamodb-rate-limit";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (command: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (command: unknown) => impl(command)) as unknown as SendFn,
	};
}

interface CapturedUpdate {
	input: {
		TableName?: string;
		Key?: Record<string, unknown>;
		UpdateExpression?: string;
		ConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
}

const TABLE = "test-rate-limits";
const HOUR_RULE = { limit: 30, windowSeconds: 3600 };
// 02:00:00 UTC + 600s → window start 7200, window end 10800.
const midWindowNow = () => new Date(7_800_000);

describe("initDynamoDbRateLimit", () => {
	it("increments the (bucket, key, window) counter with a below-limit condition and TTL", async () => {
		let received: unknown;
		const { consumeRateLimit } = initDynamoDbRateLimit({
			client: createFakeClient((command) => {
				received = command;
				return {};
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			now: midWindowNow,
		});

		const decision = await consumeRateLimit({
			bucket: "view-crawl",
			key: "203.0.113.9",
			rule: HOUR_RULE,
		});

		assert.deepEqual(decision, { allowed: true });
		const command = received as CapturedUpdate;
		assert.equal(command.input.TableName, TABLE);
		assert.deepEqual(command.input.Key, { pk: "view-crawl#203.0.113.9#7200" });
		expect(command.input.UpdateExpression).toContain("ADD #count :one");
		expect(command.input.ConditionExpression).toContain("#count < :limit");
		expect(command.input.ConditionExpression).toContain(
			"attribute_not_exists(#count)",
		);
		expect(command.input.ExpressionAttributeValues?.[":limit"]).toBe(30);
		expect(command.input.ExpressionAttributeValues?.[":expiresAt"]).toBe(
			7200 + 2 * 3600,
		);
	});

	it("denies with seconds until the window resets when the condition fails", async () => {
		const { consumeRateLimit } = initDynamoDbRateLimit({
			client: createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "condition failed",
				});
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			now: midWindowNow,
		});

		const decision = await consumeRateLimit({
			bucket: "login",
			key: "203.0.113.9",
			rule: HOUR_RULE,
		});

		assert.deepEqual(decision, { allowed: false, retryAfterSeconds: 3000 });
	});

	it("rethrows non-conditional errors", async () => {
		const { consumeRateLimit } = initDynamoDbRateLimit({
			client: createFakeClient(() => {
				throw new Error("throttled");
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			now: midWindowNow,
		});

		await expect(
			consumeRateLimit({ bucket: "login", key: "203.0.113.9", rule: HOUR_RULE }),
		).rejects.toThrow("throttled");
	});
});
