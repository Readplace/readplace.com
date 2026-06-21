import { z } from "zod";
import {
	batchGetFromTable,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";

type SendFn = DynamoDBDocumentClient["send"];

interface BatchGetCommandLike {
	input: {
		RequestItems?: Record<
			string,
			{
				Keys?: Array<Record<string, unknown>>;
				ProjectionExpression?: string;
				ExpressionAttributeNames?: Record<string, string>;
			}
		>;
	};
}

interface CapturedRequest {
	tableName: string;
	keys: Array<{ url: string }>;
	projection: string | undefined;
	expressionAttributeNames: Record<string, string> | undefined;
}

function createFakeClient(
	respond: (
		keys: Array<{ url: string }>,
		callIndex: number,
	) => {
		responses?: Array<{ url: string; payload: string }>;
		unprocessedKeys?: Array<{ url: string }>;
	},
): { client: Pick<DynamoDBDocumentClient, "send">; calls: CapturedRequest[] } {
	const calls: CapturedRequest[] = [];
	const send: SendFn = (async (input: BatchGetCommandLike) => {
		const requestItems = input.input.RequestItems ?? {};
		const tableName = Object.keys(requestItems)[0] ?? "";
		const tableEntry = requestItems[tableName];
		const rawKeys = tableEntry?.Keys ?? [];
		const keys = rawKeys.map((k) => ({ url: String(k.url) }));
		const callIndex = calls.length;
		calls.push({
			tableName,
			keys,
			projection: tableEntry?.ProjectionExpression,
			expressionAttributeNames: tableEntry?.ExpressionAttributeNames,
		});
		const { responses = [], unprocessedKeys = [] } = respond(keys, callIndex);
		return {
			Responses: { [tableName]: responses },
			UnprocessedKeys:
				unprocessedKeys.length > 0
					? { [tableName]: { Keys: unprocessedKeys } }
					: undefined,
		};
	}) as SendFn;
	return { client: { send }, calls };
}

const TABLE = "test-articles";
const RowSchema = z.object({ url: z.string(), payload: z.string() });

function makeKeys(count: number): Array<{ url: string }> {
	return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${i}` }));
}

describe("batchGetFromTable", () => {
	it("returns an empty array without calling the client when keys are empty", async () => {
		const { client, calls } = createFakeClient(() => ({ responses: [] }));

		const result = await batchGetFromTable({
			client,
			tableName: TABLE,
			schema: RowSchema,
			keys: [],
		});

		expect(result).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it("issues a single request when keys fit within the 100-key limit", async () => {
		const keys = makeKeys(100);
		const { client, calls } = createFakeClient((received) => ({
			responses: received.map(({ url }) => ({ url, payload: `p-${url}` })),
		}));

		const result = await batchGetFromTable({
			client,
			tableName: TABLE,
			schema: RowSchema,
			keys,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].keys).toHaveLength(100);
		expect(calls[0].tableName).toBe(TABLE);
		expect(result).toHaveLength(100);
	});

	it("chunks into multiple requests of at most 100 keys when keys exceed the limit", async () => {
		const keys = makeKeys(250);
		const { client, calls } = createFakeClient((received) => ({
			responses: received.map(({ url }) => ({ url, payload: `p-${url}` })),
		}));

		const result = await batchGetFromTable({
			client,
			tableName: TABLE,
			schema: RowSchema,
			keys,
		});

		expect(calls).toHaveLength(3);
		expect(calls.map((c) => c.keys.length)).toEqual([100, 100, 50]);
		expect(result).toHaveLength(250);
		const returnedUrls = new Set(result.map((r) => r.url));
		expect(returnedUrls.size).toBe(250);
	});

	it("reproduces the production scenario of 600 keys split into six chunks", async () => {
		// Regression for the export-user-data DLQ incident: a user with 600 saved
		// articles triggered ValidationException because BatchGetItem rejects
		// requests with more than 100 keys.
		const keys = makeKeys(600);
		const { client, calls } = createFakeClient((received) => ({
			responses: received.map(({ url }) => ({ url, payload: `p-${url}` })),
		}));

		const result = await batchGetFromTable({
			client,
			tableName: TABLE,
			schema: RowSchema,
			keys,
		});

		expect(calls).toHaveLength(6);
		for (const call of calls) {
			expect(call.keys.length).toBeLessThanOrEqual(100);
		}
		expect(result).toHaveLength(600);
	});

	it("retries UnprocessedKeys returned by DynamoDB until they all succeed", async () => {
		const keys = makeKeys(50);
		const { client, calls } = createFakeClient((received, callIndex) => {
			if (callIndex === 0) {
				const processed = received.slice(0, 30);
				const unprocessed = received.slice(30);
				return {
					responses: processed.map(({ url }) => ({ url, payload: `p-${url}` })),
					unprocessedKeys: unprocessed,
				};
			}
			return {
				responses: received.map(({ url }) => ({ url, payload: `p-${url}` })),
			};
		});

		const result = await batchGetFromTable({
			client,
			tableName: TABLE,
			schema: RowSchema,
			keys,
		});

		expect(calls).toHaveLength(2);
		expect(calls[0].keys).toHaveLength(50);
		expect(calls[1].keys).toHaveLength(20);
		expect(result).toHaveLength(50);
	});

	it("throws when UnprocessedKeys persist past the retry budget", async () => {
		const keys = makeKeys(10);
		const { client, calls } = createFakeClient((received) => ({
			responses: [],
			unprocessedKeys: received,
		}));

		await expect(
			batchGetFromTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
				keys,
			}),
		).rejects.toThrow(/UnprocessedKeys/);

		// One initial attempt + 5 retries before assert fires.
		expect(calls).toHaveLength(6);
	});

	it("aliases projection attributes to dodge DynamoDB reserved words and forwards them on every chunk", async () => {
		// `url`, `name`, `status` are reserved words in DynamoDB. Without aliasing,
		// a ProjectionExpression like "url, payload" would fail at the API.
		const keys = makeKeys(150);
		const { client, calls } = createFakeClient((received) => ({
			responses: received.map(({ url }) => ({ url, payload: `p-${url}` })),
		}));

		await batchGetFromTable({
			client,
			tableName: TABLE,
			schema: RowSchema,
			keys,
			projection: ["url", "payload"],
		});

		expect(calls).toHaveLength(2);
		expect(calls.map((c) => c.projection)).toEqual(["#url, #payload", "#url, #payload"]);
		expect(calls.map((c) => c.expressionAttributeNames)).toEqual([
			{ "#url": "url", "#payload": "payload" },
			{ "#url": "url", "#payload": "payload" },
		]);
	});
});
