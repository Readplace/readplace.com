import assert from "node:assert/strict";
import { z } from "zod";
import { dynamoField } from "./dynamo-field";
import {
	assertItem,
	batchGetFromTable,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	forEachQueryPage,
} from "./define-table";

type SendFn = DynamoDBDocumentClient["send"];

type SentCommand = { name: string; input: Record<string, unknown> };

function createFakeClient(
	respond: (command: SentCommand) => Record<string, unknown>,
): {
	client: Pick<DynamoDBDocumentClient, "send">;
	sent: SentCommand[];
} {
	const sent: SentCommand[] = [];
	const send: SendFn = (async (command: {
		constructor: { name: string };
		input: Record<string, unknown>;
	}) => {
		const captured = { name: command.constructor.name, input: command.input };
		sent.push(captured);
		return respond(captured);
	}) as SendFn;
	return { client: { send }, sent };
}

const TABLE = "test-rows";
const RowSchema = z.object({ url: z.string(), title: dynamoField(z.string()) });

describe("defineDynamoTable", () => {
	describe("get", () => {
		it("parses the item through the schema, turning a stored null into undefined", async () => {
			const { client, sent } = createFakeClient(() => ({
				Item: { url: "u", title: null },
			}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			const row = await table.get({ url: "u" });

			assert.deepEqual(row, { url: "u", title: undefined });
			assert.deepEqual(sent, [
				{
					name: "GetCommand",
					input: { TableName: TABLE, Key: { url: "u" } },
				},
			]);
		});

		it("returns undefined when the item does not exist", async () => {
			const { client } = createFakeClient(() => ({}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			assert.equal(await table.get({ url: "missing" }), undefined);
		});

		it("aliases projected attributes and asks for a consistent read", async () => {
			const { client, sent } = createFakeClient(() => ({ Item: { url: "u" } }));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			await table.get(
				{ url: "u" },
				{ projection: ["url", "title"], consistentRead: true },
			);

			assert.deepEqual(sent[0]?.input, {
				TableName: TABLE,
				Key: { url: "u" },
				ProjectionExpression: "#url, #title",
				ExpressionAttributeNames: { "#url": "url", "#title": "title" },
				ConsistentRead: true,
			});
		});
	});

	it("put sends the item to the table", async () => {
		const { client, sent } = createFakeClient(() => ({}));
		const table = defineDynamoTable({
			client,
			tableName: TABLE,
			schema: RowSchema,
		});

		await table.put({ Item: { url: "u" } });

		assert.deepEqual(sent, [
			{
				name: "PutCommand",
				input: { TableName: TABLE, Item: { url: "u" } },
			},
		]);
	});

	describe("update", () => {
		it("parses the returned attributes", async () => {
			const { client, sent } = createFakeClient(() => ({
				Attributes: { url: "u", title: "t" },
			}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			const result = await table.update({
				Key: { url: "u" },
				ReturnValues: "ALL_OLD",
			});

			assert.deepEqual(result, { Attributes: { url: "u", title: "t" } });
			assert.equal(sent[0]?.name, "UpdateCommand");
			assert.equal(sent[0]?.input.TableName, TABLE);
		});

		it("resolves with an empty object when no attributes come back", async () => {
			const { client } = createFakeClient(() => ({}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			assert.deepEqual(await table.update({ Key: { url: "u" } }), {});
		});
	});

	describe("delete", () => {
		it("parses the returned attributes", async () => {
			const { client, sent } = createFakeClient(() => ({
				Attributes: { url: "u" },
			}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			const result = await table.delete({
				Key: { url: "u" },
				ReturnValues: "ALL_OLD",
			});

			assert.deepEqual(result, { Attributes: { url: "u" } });
			assert.equal(sent[0]?.name, "DeleteCommand");
			assert.equal(sent[0]?.input.TableName, TABLE);
		});

		it("resolves with an empty object when no attributes come back", async () => {
			const { client } = createFakeClient(() => ({}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			assert.deepEqual(await table.delete({ Key: { url: "u" } }), {});
		});
	});

	describe("query", () => {
		it("parses the items and reports the count and the last evaluated key", async () => {
			const { client, sent } = createFakeClient(() => ({
				Items: [{ url: "a" }, { url: "b", title: "B" }],
				Count: 2,
				LastEvaluatedKey: { url: "b" },
			}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			const result = await table.query({
				KeyConditionExpression: "url = :url",
			});

			assert.deepEqual(result, {
				items: [{ url: "a" }, { url: "b", title: "B" }],
				count: 2,
				lastEvaluatedKey: { url: "b" },
			});
			assert.equal(sent[0]?.name, "QueryCommand");
			assert.equal(sent[0]?.input.TableName, TABLE);
		});

		it("answers no items and a zero count when the response carries neither", async () => {
			const { client } = createFakeClient(() => ({}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			assert.deepEqual(
				await table.query({ KeyConditionExpression: "url = :url" }),
				{
					items: [],
					count: 0,
					lastEvaluatedKey: undefined,
				},
			);
		});
	});

	describe("scan", () => {
		it("scans the whole table when given no input", async () => {
			const { client, sent } = createFakeClient(() => ({}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			const result = await table.scan();

			assert.deepEqual(result, {
				items: [],
				count: 0,
				lastEvaluatedKey: undefined,
			});
			assert.deepEqual(sent, [
				{ name: "ScanCommand", input: { TableName: TABLE } },
			]);
		});

		it("forwards the input and parses the items", async () => {
			const { client, sent } = createFakeClient(() => ({
				Items: [{ url: "a" }],
				Count: 1,
				LastEvaluatedKey: { url: "a" },
			}));
			const table = defineDynamoTable({
				client,
				tableName: TABLE,
				schema: RowSchema,
			});

			const result = await table.scan({ Select: "ALL_ATTRIBUTES" });

			assert.deepEqual(result, {
				items: [{ url: "a" }],
				count: 1,
				lastEvaluatedKey: { url: "a" },
			});
			assert.deepEqual(sent[0]?.input, {
				TableName: TABLE,
				Select: "ALL_ATTRIBUTES",
			});
		});
	});
});

describe("batchGetFromTable", () => {
	it("returns no rows when the response carries none for the table", async () => {
		const { client, sent } = createFakeClient(() => ({}));

		const rows = await batchGetFromTable({
			client,
			tableName: TABLE,
			schema: RowSchema,
			keys: [{ url: "u" }],
		});

		assert.deepEqual(rows, []);
		assert.equal(sent[0]?.name, "BatchGetCommand");
	});
});

describe("forEachQueryPage", () => {
	it("follows the last evaluated key until the final page", async () => {
		const pages = [
			{ items: ["a", "b"], count: 2, lastEvaluatedKey: { url: "b" } },
			{ items: ["c"], count: 1, lastEvaluatedKey: undefined },
		];
		const startKeys: unknown[] = [];
		const table = {
			query: async (input: { ExclusiveStartKey?: Record<string, unknown> }) => {
				startKeys.push(input.ExclusiveStartKey);
				const page = pages[startKeys.length - 1];
				assert(page);
				return page;
			},
		};
		const seen: string[][] = [];

		await forEachQueryPage(
			table,
			{ KeyConditionExpression: "url = :url" },
			async (items) => {
				seen.push(items);
			},
		);

		assert.deepEqual(seen, [["a", "b"], ["c"]]);
		assert.deepEqual(startKeys, [undefined, { url: "b" }]);
	});
});

describe("assertItem", () => {
	it("accepts a present item", () => {
		assert.doesNotThrow(() => assertItem({ url: "u" }, "row missing"));
	});

	it("throws the message when the item is absent", () => {
		assert.throws(() => assertItem(undefined, "row missing"), /row missing/);
	});
});
