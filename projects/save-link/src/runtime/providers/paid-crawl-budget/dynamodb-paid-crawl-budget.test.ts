import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/hutch-storage-client";
import { initDynamoDbPaidCrawlBudget } from "./dynamodb-paid-crawl-budget";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (command: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (command: unknown) => impl(command)) as unknown as SendFn,
	};
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

function cancelled(codes: (string | undefined)[] | undefined): TransactionCanceledException {
	return new TransactionCanceledException({
		$metadata: {},
		message: "transaction cancelled",
		CancellationReasons: codes?.map((Code) => ({ Code })),
	});
}

const noDelay = async () => {};

function recordDelay(delays: number[]) {
	return async (milliseconds: number) => {
		delays.push(milliseconds);
	};
}

function sequencedClient(outcomes: (TransactionCanceledException | Record<string, never>)[]) {
	let calls = 0;
	const client = createFakeClient(() => {
		const outcome = outcomes[calls];
		calls += 1;
		if (outcome instanceof Error) throw outcome;
		return outcome;
	}) as DynamoDBDocumentClient;
	return { client, calls: () => calls };
}

describe("initDynamoDbPaidCrawlBudget", () => {
	it("claims the message and counts one invocation against the global window in a single transaction", async () => {
		let received: unknown;
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient((command) => {
				received = command;
				return {};
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "paid-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
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
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "paid-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		const decision = await consumePaidCrawlBudget({ messageId: "msg-1" });

		assert.deepEqual(decision, { allowed: true, consumed: false });
	});

	it("blocks the invocation once the window's budget is spent (counter rejected, claim fresh)", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw cancelled(["None", "ConditionalCheckFailed"]);
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "paid-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		const decision = await consumePaidCrawlBudget({ messageId: "msg-1" });

		assert.deepEqual(decision, { allowed: false });
	});

	it("favours idempotency when a redelivery lands after the budget is also spent (both axes rejected)", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw cancelled(["ConditionalCheckFailed", "ConditionalCheckFailed"]);
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "paid-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		const decision = await consumePaidCrawlBudget({ messageId: "msg-1" });

		assert.deepEqual(decision, { allowed: true, consumed: false });
	});

	it("retries a transaction cancelled by a conflict on the counter and counts the invocation once it commits", async () => {
		const client = sequencedClient([cancelled(["None", "TransactionConflict"]), {}]);
		const delays: number[] = [];
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: client.client,
			tableName: TABLE,
			scope: "render-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: recordDelay(delays),
		});

		const decision = await consumePaidCrawlBudget({ messageId: "msg-1" });

		assert.deepEqual(decision, { allowed: true, consumed: true });
		assert.equal(client.calls(), 2);
		assert.equal(delays.length, 1);
		expect(delays[0]).toBeGreaterThanOrEqual(0);
		expect(delays[0]).toBeLessThan(50);
	});

	it("rethrows a conflict that persists on every attempt after three attempts with a growing jittered delay between them", async () => {
		const conflict = cancelled(["None", "TransactionConflict"]);
		const client = sequencedClient([conflict, conflict, conflict, {}]);
		const delays: number[] = [];
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: client.client,
			tableName: TABLE,
			scope: "render-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: recordDelay(delays),
		});

		await expect(consumePaidCrawlBudget({ messageId: "msg-1" })).rejects.toBe(conflict);
		assert.equal(client.calls(), 3);
		assert.equal(delays.length, 2);
		expect(delays[0]).toBeLessThan(50);
		expect(delays[1]).toBeLessThan(100);
	});

	it("resolves as an idempotent re-consume when a retry after a conflict finds the claim already committed", async () => {
		const client = sequencedClient([cancelled(["None", "TransactionConflict"]), cancelled(["ConditionalCheckFailed", "None"])]);
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: client.client,
			tableName: TABLE,
			scope: "render-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		assert.deepEqual(await consumePaidCrawlBudget({ messageId: "msg-1" }), { allowed: true, consumed: false });
		assert.equal(client.calls(), 2);
	});

	it.each([
		{ name: "a throttled claim", outcome: cancelled(["ThrottlingError", "None"]) },
		{ name: "a cancellation with no reasons", outcome: cancelled(undefined) },
	])("rethrows $name after one attempt without retrying", async ({ outcome }) => {
		const client = sequencedClient([outcome, {}]);
		const delays: number[] = [];
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: client.client,
			tableName: TABLE,
			scope: "render-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: recordDelay(delays),
		});

		await expect(consumePaidCrawlBudget({ messageId: "msg-1" })).rejects.toBe(outcome);
		assert.equal(client.calls(), 1);
		assert.deepEqual(delays, []);
	});

	it.each([
		{ name: "counter", reasons: ["None", "ConditionalCheckFailed"], decision: { allowed: false } },
		{ name: "claim", reasons: ["ConditionalCheckFailed", "None"], decision: { allowed: true, consumed: false } },
	])("decides on a rejected $name without retrying", async ({ reasons, decision }) => {
		const client = sequencedClient([cancelled(reasons), {}]);
		const delays: number[] = [];
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: client.client,
			tableName: TABLE,
			scope: "render-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: recordDelay(delays),
		});

		assert.deepEqual(await consumePaidCrawlBudget({ messageId: "msg-1" }), decision);
		assert.equal(client.calls(), 1);
		assert.deepEqual(delays, []);
	});

	it("rethrows non-transaction errors", async () => {
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw new Error("throttled");
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "paid-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		await expect(consumePaidCrawlBudget({ messageId: "msg-1" })).rejects.toThrow("throttled");
	});

	it("prefixes the claim and window counter keys with the render-crawl scope so the render budget counts apart from the paid-crawl one", async () => {
		let received: unknown;
		const { consumePaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient((command) => {
				received = command;
				return {};
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "render-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		await consumePaidCrawlBudget({ messageId: "msg-1" });

		const [claim, counter] = (received as CapturedTransaction).input.TransactItems ?? [];
		assert.deepEqual(claim?.Update?.Key, { pk: "render-crawl#claim#msg-1#7200" });
		assert.deepEqual(counter?.Update?.Key, { pk: "render-crawl#global#7200" });
	});

	it("refunds a render-crawl slot to the render-crawl window counter", async () => {
		let received: unknown;
		const { refundPaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient((command) => {
				received = command;
				return {};
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "render-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		await refundPaidCrawlBudget();

		assert.deepEqual((received as CapturedUpdate).input.Key, { pk: "render-crawl#global#7200" });
	});

	it("refunds a slot to the current window with an underflow-guarding condition", async () => {
		let received: unknown;
		const { refundPaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient((command) => {
				received = command;
				return {};
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "paid-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
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
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "paid-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		await expect(refundPaidCrawlBudget()).resolves.toBeUndefined();
	});

	it("rethrows non-conditional errors on refund", async () => {
		const { refundPaidCrawlBudget } = initDynamoDbPaidCrawlBudget({
			client: createFakeClient(() => {
				throw new Error("throttled");
			}) as DynamoDBDocumentClient,
			tableName: TABLE,
			scope: "paid-crawl",
			rule: HOUR_BUDGET,
			now: midWindowNow,
			delay: noDelay,
		});

		await expect(refundPaidCrawlBudget()).rejects.toThrow("throttled");
	});
});
