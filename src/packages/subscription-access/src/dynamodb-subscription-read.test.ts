import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbSubscriptionRead } from "./dynamodb-subscription-read";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(
	impl: (input: unknown) => unknown,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

const TABLE = "test-subscription-providers";
const USER_ID = UserIdSchema.parse("u-read-1");

const ACTIVE_ROW = {
	userId: USER_ID,
	provider: "stripe",
	status: "active",
	subscriptionId: "sub_123",
	customerId: "cus_123",
	createdAt: "2026-05-22T10:00:00.000Z",
	updatedAt: "2026-05-22T10:00:00.000Z",
};

describe("initDynamoDbSubscriptionRead", () => {
	describe("findByUserId", () => {
		it("returns undefined when no row exists", async () => {
			const client = createFakeClient(() => ({ Item: undefined }));
			const read = initDynamoDbSubscriptionRead({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			expect(await read.findByUserId(USER_ID)).toBeUndefined();
		});

		it("returns the parsed record when a row exists", async () => {
			const client = createFakeClient(() => ({ Item: ACTIVE_ROW }));
			const read = initDynamoDbSubscriptionRead({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const record = await read.findByUserId(USER_ID);
			assert(record, "record must be returned");
			expect(record.status).toBe("active");
			expect(record.subscriptionId).toBe("sub_123");
		});
	});

	describe("findBySubscriptionId", () => {
		it("queries the subscriptionId-index and returns the parsed record", async () => {
			let capturedInput: { IndexName?: string; ExpressionAttributeValues?: Record<string, string> } = {};
			const client = createFakeClient((input) => {
				capturedInput = (input as { input: typeof capturedInput }).input;
				return { Items: [ACTIVE_ROW] };
			});
			const read = initDynamoDbSubscriptionRead({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const record = await read.findBySubscriptionId("sub_123");
			assert(record, "record must be returned");
			expect(record.customerId).toBe("cus_123");
			expect(capturedInput.IndexName).toBe("subscriptionId-index");
			expect(capturedInput.ExpressionAttributeValues).toEqual({ ":sid": "sub_123" });
		});

		it("returns undefined when the index has no match", async () => {
			const client = createFakeClient(() => ({ Items: [] }));
			const read = initDynamoDbSubscriptionRead({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			expect(await read.findBySubscriptionId("sub_missing")).toBeUndefined();
		});
	});

	describe("listAllSubscriptionRows", () => {
		it("returns every row on a single page with optional fields mapped", async () => {
			const client = createFakeClient(() => ({
				Items: [
					{
						userId: "u-trial",
						provider: "stripe",
						status: "trialing",
						trialEndsAt: "2026-06-05T00:00:00.000Z",
						createdAt: "2026-05-22T10:00:00.000Z",
						updatedAt: "2026-05-22T10:00:00.000Z",
					},
					ACTIVE_ROW,
				],
				LastEvaluatedKey: undefined,
			}));
			const read = initDynamoDbSubscriptionRead({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const rows = await read.listAllSubscriptionRows();

			assert.equal(rows.length, 2);
			expect(rows[0].subscriptionId).toBeUndefined();
			expect(rows[0].trialEndsAt).toBe("2026-06-05T00:00:00.000Z");
			expect(rows[1].subscriptionId).toBe("sub_123");
			expect(rows[1].customerId).toBe("cus_123");
		});

		it("paginates using ExclusiveStartKey until LastEvaluatedKey is absent", async () => {
			const receivedKeys: unknown[] = [];
			const client = createFakeClient((input) => {
				const command = input as { input: { ExclusiveStartKey?: Record<string, unknown> } };
				receivedKeys.push(command.input.ExclusiveStartKey);
				if (command.input.ExclusiveStartKey === undefined) {
					return {
						Items: [
							{
								userId: "u-1",
								provider: "stripe",
								status: "active",
								subscriptionId: "sub_1",
								customerId: "cus_1",
								createdAt: "2026-05-22T10:00:00.000Z",
								updatedAt: "2026-05-22T10:00:00.000Z",
							},
						],
						LastEvaluatedKey: { userId: "u-1" },
					};
				}
				return {
					Items: [
						{
							userId: "u-2",
							provider: "stripe",
							status: "cancelled",
							createdAt: "2026-05-22T10:00:00.000Z",
							updatedAt: "2026-05-22T10:00:00.000Z",
						},
					],
					LastEvaluatedKey: undefined,
				};
			});
			const read = initDynamoDbSubscriptionRead({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			const rows = await read.listAllSubscriptionRows();

			assert.equal(rows.length, 2);
			expect(rows.map((r) => r.userId)).toEqual(["u-1", "u-2"]);
			assert.deepEqual(receivedKeys, [undefined, { userId: "u-1" }]);
		});

		it("returns an empty array when the table is empty", async () => {
			const client = createFakeClient(() => ({ Items: [], LastEvaluatedKey: undefined }));
			const read = initDynamoDbSubscriptionRead({
				client: client as DynamoDBDocumentClient,
				tableName: TABLE,
			});

			assert.deepEqual(await read.listAllSubscriptionRows(), []);
		});
	});
});
