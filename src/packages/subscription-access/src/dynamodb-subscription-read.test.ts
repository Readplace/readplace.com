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
});
