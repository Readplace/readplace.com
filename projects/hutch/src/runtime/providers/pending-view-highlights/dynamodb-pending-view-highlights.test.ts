import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initDynamoDbPendingViewHighlights } from "./dynamodb-pending-view-highlights";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

function createFakeClient(opts: { item?: Record<string, unknown> }): {
	client: DynamoDBDocumentClient;
	commands: CapturedCommand[];
} {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "GetCommand") return opts.item ? { Item: opts.item } : {};
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

const TABLE = "hutch-pending-view-highlights";
const NOW_SECONDS = 1_700_000_000;
const RETURN_TO = "/save?url=https%3A%2F%2Fexample.com%2Fpost";
const PENDING_ID = "6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";
const ITEM = {
	url: "https://example.com/post",
	exact: "A second sentence",
	prefix: "paragraph opens the article. ",
	suffix: " follows it.",
	note: "Worth keeping",
};

function storeOn(client: DynamoDBDocumentClient) {
	return initDynamoDbPendingViewHighlights({ client, tableName: TABLE, now: () => new Date(NOW_SECONDS * 1000) });
}

describe("initDynamoDbPendingViewHighlights", () => {
	it("puts the kept highlights under their pending id, expiring a day later", async () => {
		const { client, commands } = createFakeClient({});

		await storeOn(client).storePendingViewHighlights({
			pendingId: PENDING_ID,
			articleUrl: ITEM.url,
			items: [ITEM],
			returnTo: undefined,
		});

		const put = commands.find((command) => command.name === "PutCommand");
		assert.equal(put?.input.TableName, TABLE);
		assert.deepEqual(put?.input.Item, {
			pendingId: PENDING_ID,
			articleUrl: ITEM.url,
			items: [ITEM],
			returnTo: null,
			expiresAt: NOW_SECONDS + 86_400,
		});
	});

	it("puts the page to return to once the highlights are claimed", async () => {
		const { client, commands } = createFakeClient({});

		await storeOn(client).storePendingViewHighlights({
			pendingId: PENDING_ID,
			articleUrl: ITEM.url,
			items: [ITEM],
			returnTo: RETURN_TO,
		});

		const put = commands.find((command) => command.name === "PutCommand");
		assert.deepEqual(put?.input.Item, {
			pendingId: PENDING_ID,
			articleUrl: ITEM.url,
			items: [ITEM],
			returnTo: RETURN_TO,
			expiresAt: NOW_SECONDS + 86_400,
		});
	});

	it("finds the kept highlights with a consistent read and leaves the row in place", async () => {
		const { client, commands } = createFakeClient({
			item: { pendingId: PENDING_ID, articleUrl: ITEM.url, items: [ITEM], returnTo: null, expiresAt: NOW_SECONDS + 10 },
		});

		const found = await storeOn(client).findPendingViewHighlights(PENDING_ID);

		assert.deepEqual(found, { articleUrl: ITEM.url, items: [ITEM], returnTo: undefined });
		const get = commands.find((command) => command.name === "GetCommand");
		assert.deepEqual(get?.input.Key, { pendingId: PENDING_ID });
		assert.equal(get?.input.ConsistentRead, true);
		assert.equal(commands.some((command) => command.name === "DeleteCommand"), false);
	});

	it("finds the page to return to once the highlights are claimed", async () => {
		const { client } = createFakeClient({
			item: { pendingId: PENDING_ID, articleUrl: ITEM.url, items: [ITEM], returnTo: RETURN_TO, expiresAt: NOW_SECONDS + 10 },
		});

		const found = await storeOn(client).findPendingViewHighlights(PENDING_ID);

		assert.equal(found?.returnTo, RETURN_TO);
	});

	it("finds nothing once the row is gone", async () => {
		const { client } = createFakeClient({});

		assert.equal(await storeOn(client).findPendingViewHighlights(PENDING_ID), undefined);
	});

	it("finds nothing in a row past its expiry that TTL has not yet removed", async () => {
		const { client } = createFakeClient({
			item: { pendingId: PENDING_ID, articleUrl: ITEM.url, items: [ITEM], returnTo: null, expiresAt: NOW_SECONDS },
		});

		assert.equal(await storeOn(client).findPendingViewHighlights(PENDING_ID), undefined);
	});

	it("releases the row by deleting it", async () => {
		const { client, commands } = createFakeClient({});

		await storeOn(client).releasePendingViewHighlights(PENDING_ID);

		const remove = commands.find((command) => command.name === "DeleteCommand");
		assert.equal(remove?.input.TableName, TABLE);
		assert.deepEqual(remove?.input.Key, { pendingId: PENDING_ID });
	});
});
