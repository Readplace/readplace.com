import assert from "node:assert/strict";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { initDynamoDbPendingViewHighlights } from "./dynamodb-pending-view-highlights";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

function createFakeClient(opts: { deleteAttributes?: Record<string, unknown>; deleteError?: Error }): {
	client: DynamoDBDocumentClient;
	commands: CapturedCommand[];
} {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "DeleteCommand") {
				if (opts.deleteError) throw opts.deleteError;
				return opts.deleteAttributes ? { Attributes: opts.deleteAttributes } : {};
			}
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

const TABLE = "hutch-pending-view-highlights";
const NOW_SECONDS = 1_700_000_000;
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
		});

		const put = commands.find((command) => command.name === "PutCommand");
		assert.equal(put?.input.TableName, TABLE);
		assert.deepEqual(put?.input.Item, {
			pendingId: PENDING_ID,
			articleUrl: ITEM.url,
			items: [ITEM],
			expiresAt: NOW_SECONDS + 86_400,
		});
	});

	it("claims the row once, deleting it on the condition that it still exists", async () => {
		const { client, commands } = createFakeClient({
			deleteAttributes: { pendingId: PENDING_ID, articleUrl: ITEM.url, items: [ITEM], expiresAt: NOW_SECONDS + 10 },
		});

		const claimed = await storeOn(client).claimPendingViewHighlights(PENDING_ID);

		assert.deepEqual(claimed, { articleUrl: ITEM.url, items: [ITEM] });
		const remove = commands.find((command) => command.name === "DeleteCommand");
		assert.deepEqual(remove?.input.Key, { pendingId: PENDING_ID });
		expect(remove?.input.ConditionExpression).toContain("attribute_exists(#pendingId)");
		assert.equal(remove?.input.ReturnValues, "ALL_OLD");
	});

	it("claims nothing once the row is gone", async () => {
		const { client } = createFakeClient({
			deleteError: new ConditionalCheckFailedException({ message: "gone", $metadata: {} }),
		});

		assert.equal(await storeOn(client).claimPendingViewHighlights(PENDING_ID), undefined);
	});

	it("claims nothing from a row past its expiry that TTL has not yet removed", async () => {
		const { client } = createFakeClient({
			deleteAttributes: { pendingId: PENDING_ID, articleUrl: ITEM.url, items: [ITEM], expiresAt: NOW_SECONDS },
		});

		assert.equal(await storeOn(client).claimPendingViewHighlights(PENDING_ID), undefined);
	});
});
