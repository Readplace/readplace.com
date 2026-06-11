import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/hutch-storage-client";
import { initDynamoDbPaidCrawlBudget } from "./dynamodb-paid-crawl-budget";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(impl: (command: unknown) => unknown): DynamoDBDocumentClient {
	return {
		send: (async (command: unknown) => impl(command)) as unknown as SendFn,
	} as DynamoDBDocumentClient;
}

interface CapturedTransaction {
	input: {
		TransactItems?: {
			Update?: {
				TableName?: string;
				Key?: Record<string, unknown>;
				UpdateExpression?: string;
				ConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		}[];
	};
}

interface CapturedUpdate {
	input: {
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

function cancelled(codes: (string | undefined)[]): TransactionCanceledException {
	return new TransactionCanceledException({
		$metadata: {},
		message: "transaction cancelled",
		CancellationReasons: codes.map((Code) => ({ Code })),
	});
}

describe("initDynamoDbPaidCrawlBudget", () => {
	it("claims the message and counts one invocation against the global window in a single transaction", async () => {
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

		const decision = await consumePaidCrawlBudget({ messageId: "msg-1" });

		assert.deepEqual(decision, { allowed: true, consumed: true });
		const command = received as CapturedTransaction;
		const [claim, counter] = command.input.TransactItems ?? [];
		assert.equal(claim?.Update?.TableName, TABLE);
		assert.deepEqual(claim?.Update?.Key, { pk: "paid-crawl#claim#msg-1#7200" });
		expect(claim?.Update?.ConditionExpression).toContain("attribute_not_exists(pk)");
		assert.deepEqual(counter?.Update?.Key, { pk: "paid-crawl#global#7200" });
		expect(counter?.Update?.UpdateExpression).toContain("ADD #count :one");
		expect(counter?.Update?.ConditionExpression).toContain("#count < :limit");
		expect(counter?.Update?.ConditionExpression).toContain("attribute_not_exists(#count)");
		expect(counter?.Update?.ExpressionAttributeValues?.[":limit"]).toBe(50);
		expect(counter?.Update?.ExpressionAttributeValues?.[":expiresAt"]).toBe(7200 + 2 * 3600);
	});

	it("treats a rejected claim as an idempotent re-consume (redelivery): allowed but not freshly counted", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw cancelled(["ConditionalCheckFailed", "None"]);
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		const decision = await consumePaidCrawlBudget({ messageId: "msg-1" });

		assert.deepEqual(decision, { allowed: true, consumed: false });
	});

	it("blocks the invocation once the window's budget is spent (counter rejected, claim fresh)", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw cancelled(["None", "ConditionalCheckFailed"]);
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		const decision = await consumePaidCrawlBudget({ messageId: "msg-1" });

		assert.deepEqual(decision, { allowed: false });
	});

	it("favours idempotency when a redelivery lands after the budget is also spent (both axes rejected)", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw cancelled(["ConditionalCheckFailed", "ConditionalCheckFailed"]);
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		const decision = await consumePaidCrawlBudget({ messageId: "msg-1" });

		assert.deepEqual(decision, { allowed: true, consumed: false });
	});

	it("rethrows a transaction cancelled for a non-budget reason (e.g. throttling) so the gate re-runs (fail closed)", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw cancelled(["TransactionConflict", "None"]);
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		await expect(consumePaidCrawlBudget({ messageId: "msg-1" })).rejects.toThrow(
			TransactionCanceledException,
		);
	});

	it("rethrows non-transaction errors", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw new Error("throttled");
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		await expect(consumePaidCrawlBudget({ messageId: "msg-1" })).rejects.toThrow("throttled");
	});

	it("refunds a slot to the current window with an underflow-guarding condition", async () => {
		let received: unknown;
		const { refundPaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient((command) => {
				received = command;
				return {};
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		await refundPaidCrawlBudget();

		const command = received as CapturedUpdate;
		assert.deepEqual(command.input.Key, { pk: "paid-crawl#global#7200" });
		expect(command.input.UpdateExpression).toContain("ADD #count :negOne");
		expect(command.input.ConditionExpression).toContain("#count > :zero");
		expect(command.input.ExpressionAttributeValues?.[":negOne"]).toBe(-1);
	});

	it("treats an underflow-blocked refund as a no-op (nothing left to give back)", async () => {
		const { refundPaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
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

		await expect(refundPaidCrawlBudget()).resolves.toBeUndefined();
	});

	it("rethrows non-conditional errors on refund", async () => {
		const { refundPaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw new Error("throttled");
			}),
			tableName: TABLE,
			rule: HOUR_BUDGET,
			now: midWindowNow,
		});

		await expect(refundPaidCrawlBudget()).rejects.toThrow("throttled");
	});
});
