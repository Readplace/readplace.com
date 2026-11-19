import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/storage-client";
import { initDynamoDbRateLimit } from "./dynamodb-rate-limit";

function createFakeClient(
	impl: (command: unknown) => Record<string, unknown>,
): Pick<DynamoDBDocumentClient, "send"> {
	return {
		send: async (command) => impl(command),
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
			}),
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
			}),
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
			}),
			tableName: TABLE,
			now: midWindowNow,
		});

		await expect(
			consumeRateLimit({ bucket: "login", key: "203.0.113.9", rule: HOUR_RULE }),
		).rejects.toThrow("throttled");
	});
});

describe("initDynamoDbRateLimit claimRateLimitUnits", () => {
	const DAY_RULE = { limit: 28, windowSeconds: 86_400 };
	// 00:10:00 UTC on day 1 → window start 86400, 85800s to the window end.
	const dayNow = () => new Date(87_000_000);

	function conditionFailed(): never {
		throw new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" });
	}

	function initWithStoredCount(stored: { count: number }) {
		const sent: { name: string; input: CapturedUpdate["input"] & { ConsistentRead?: boolean } }[] = [];
		const { claimRateLimitUnits } = initDynamoDbRateLimit({
			client: createFakeClient((command) => {
				const { constructor: commandClass, input } = command as { constructor: { name: string }; input: CapturedUpdate["input"] & { ConsistentRead?: boolean } };
				sent.push({ name: commandClass.name, input });
				if (commandClass.name === "GetCommand") {
					return { Item: { pk: "daily-saves#user-1#86400", count: stored.count } };
				}
				const values = input.ExpressionAttributeValues ?? {};
				const units = Number(values[":units"]);
				if (stored.count > Number(values[":ceiling"])) conditionFailed();
				stored.count += units;
				return {};
			}),
			tableName: TABLE,
			now: dayNow,
		});
		return { claimRateLimitUnits, sent };
	}

	it("adds every requested unit in one conditional write when they fit", async () => {
		const { claimRateLimitUnits, sent } = initWithStoredCount({ count: 0 });

		const claim = await claimRateLimitUnits({ bucket: "daily-saves", key: "user-1", requested: 5, rule: DAY_RULE });

		assert.deepEqual(claim, { granted: 5, retryAfterSeconds: undefined });
		assert.equal(sent.length, 1);
		const [update] = sent;
		assert.equal(update.input.TableName, TABLE);
		assert.deepEqual(update.input.Key, { pk: "daily-saves#user-1#86400" });
		expect(update.input.UpdateExpression).toContain("ADD #count :units");
		expect(update.input.ConditionExpression).toContain("attribute_not_exists(#count)");
		expect(update.input.ConditionExpression).toContain("#count <= :ceiling");
		expect(update.input.ExpressionAttributeValues?.[":ceiling"]).toBe(23);
		expect(update.input.ExpressionAttributeValues?.[":expiresAt"]).toBe(86_400 + 2 * 86_400);
	});

	it("grants the remainder after reading the count when the full request does not fit", async () => {
		const stored = { count: 25 };
		const { claimRateLimitUnits, sent } = initWithStoredCount(stored);

		const claim = await claimRateLimitUnits({ bucket: "daily-saves", key: "user-1", requested: 5, rule: DAY_RULE });

		assert.deepEqual(claim, { granted: 3, retryAfterSeconds: 85_800 });
		assert.equal(stored.count, 28);
		const read = sent.find((command) => command.name === "GetCommand");
		assert.equal(read?.input.ConsistentRead, true);
		assert.deepEqual(read?.input.Key, { pk: "daily-saves#user-1#86400" });
	});

	it("grants nothing and writes nothing more from a spent window", async () => {
		const stored = { count: 28 };
		const { claimRateLimitUnits, sent } = initWithStoredCount(stored);

		const claim = await claimRateLimitUnits({ bucket: "daily-saves", key: "user-1", requested: 2, rule: DAY_RULE });

		assert.deepEqual(claim, { granted: 0, retryAfterSeconds: 85_800 });
		assert.equal(stored.count, 28);
		assert.equal(sent.filter((command) => command.name === "UpdateCommand").length, 1);
	});

	it("asks for no more than the limit when the request exceeds it", async () => {
		const stored = { count: 0 };
		const { claimRateLimitUnits } = initWithStoredCount(stored);

		const claim = await claimRateLimitUnits({ bucket: "daily-saves", key: "user-1", requested: 30, rule: DAY_RULE });

		assert.deepEqual(claim, { granted: 28, retryAfterSeconds: 85_800 });
		assert.equal(stored.count, 28);
	});

	it("sends nothing when no units are requested", async () => {
		const { claimRateLimitUnits, sent } = initWithStoredCount({ count: 0 });

		const claim = await claimRateLimitUnits({ bucket: "daily-saves", key: "user-1", requested: 0, rule: DAY_RULE });

		assert.deepEqual(claim, { granted: 0, retryAfterSeconds: undefined });
		assert.equal(sent.length, 0);
	});
});
