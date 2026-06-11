import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbPaidCrawlBudget } from "./dynamodb-paid-crawl-budget";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(impl: (command: unknown) => unknown): DynamoDBDocumentClient {
	return {
		send: (async (command: unknown) => impl(command)) as unknown as SendFn,
	} as DynamoDBDocumentClient;
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
const HOUR_BUDGET = { limit: 50, windowSeconds: 3600 };
// 02:00:00 UTC + 600s → window start 7200.
const midWindowNow = () => new Date(7_800_000);

describe("initDynamoDbPaidCrawlBudget", () => {
	it("counts one invocation against the global window with a below-budget condition and TTL", async () => {
		let received: unknown;
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient((command) => {
				received = command;
				return {};
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		const decision = await consumePaidCrawlBudget();

		assert.deepEqual(decision, { allowed: true });
		const command = received as CapturedUpdate;
		assert.equal(command.input.TableName, TABLE);
		assert.deepEqual(command.input.Key, { pk: "paid-crawl#global#7200" });
		expect(command.input.UpdateExpression).toContain("ADD #count :one");
		expect(command.input.ConditionExpression).toContain("#count < :limit");
		expect(command.input.ConditionExpression).toContain(
			"attribute_not_exists(#count)",
		);
		expect(command.input.ExpressionAttributeValues?.[":limit"]).toBe(50);
		expect(command.input.ExpressionAttributeValues?.[":expiresAt"]).toBe(
			7200 + 2 * 3600,
		);
	});

	it("blocks invocations once the window's budget is spent", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw new ConditionalCheckFailedException({
					$metadata: {},
					message: "condition failed",
				});
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		const decision = await consumePaidCrawlBudget();

		assert.deepEqual(decision, { allowed: false });
	});

	it("rethrows non-conditional errors", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw new Error("throttled");
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		await expect(consumePaidCrawlBudget()).rejects.toThrow("throttled");
	});
});
