import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import { inboxSavedLinkKey } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbInboxSavedLink } from "./dynamodb-inbox-saved-link";

type SendFn = DynamoDBDocumentClient["send"];

const TABLE = "hutch-inbox-saved-links-test";
const userId = UserIdSchema.parse("user-1");
const now = () => new Date("2026-07-26T10:00:00.000Z");

interface RecordedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records every command by SDK class name and answers BatchGet from a table of
 * rows keyed by linkKey, so a test states which rows exist and then asserts on
 * the keys the store asked for. */
function createFakeClient(
	rows: Record<string, unknown>[] = [],
	options: { rejectConditionalPut?: boolean } = {},
): {
	client: DynamoDBDocumentClient;
	commands: RecordedCommand[];
} {
	const commands: RecordedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (
				name === "PutCommand" &&
				options.rejectConditionalPut === true &&
				command.input.ConditionExpression !== undefined
			) {
				throw new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" });
			}
			if (name === "BatchGetCommand") {
				const requested = command.input.RequestItems as Record<string, { Keys: { linkKey: string }[] }>;
				const wanted = new Set(requested[TABLE].Keys.map((key) => key.linkKey));
				return { Responses: { [TABLE]: rows.filter((row) => wanted.has(String(row.linkKey))) } };
			}
			if (name === "QueryCommand") {
				return { Items: rows, Count: rows.length };
			}
			return {};
		}) as SendFn,
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

function savedRow(url: string, state: "saved" | "failed" = "saved") {
	return {
		userId,
		linkKey: inboxSavedLinkKey(url),
		state,
		updatedAt: "2026-07-01T00:00:00.000Z",
		url,
	};
}

describe("initDynamoDbInboxSavedLink", () => {
	it("keys the row on the normalized url and keeps the submitted url on it", async () => {
		const { client, commands } = createFakeClient();
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		await store.markLinkSaved({ userId, url: "https://example.com/post?utm_source=news" });

		const put = commands.find((command) => command.name === "PutCommand");
		assert(put, "markLinkSaved must issue a PutCommand");
		expect(put.input.Item).toEqual({
			userId,
			linkKey: inboxSavedLinkKey("https://example.com/post"),
			state: "saved",
			updatedAt: "2026-07-26T10:00:00.000Z",
			url: "https://example.com/post?utm_source=news",
		});
	});

	it("records a failed save under the same key, so a later success replaces it", async () => {
		const { client, commands } = createFakeClient();
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		await store.markLinkSaveFailed({ userId, url: "https://example.com/post" });
		await store.markLinkSaved({ userId, url: "https://example.com/post" });

		const puts = commands.filter((command) => command.name === "PutCommand");
		expect(puts.map((command) => (command.input.Item as { state: string }).state)).toEqual([
			"failed",
			"saved",
		]);
	});

	it("returns state keyed by the caller's own url, not the normalized key", async () => {
		const { client } = createFakeClient([savedRow("https://example.com/post")]);
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		const states = await store.findSavedLinks({
			userId,
			urls: ["https://example.com/post?utm_campaign=x", "https://example.com/other"],
		});

		expect([...states]).toEqual([["https://example.com/post?utm_campaign=x", "saved"]]);
	});

	it("asks for each distinct key once when two urls normalize the same", async () => {
		const { client, commands } = createFakeClient([savedRow("https://example.com/post")]);
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		await store.findSavedLinks({
			userId,
			urls: ["https://example.com/post?utm_source=a", "https://example.com/post?utm_source=b"],
		});

		const batch = commands.find((command) => command.name === "BatchGetCommand");
		assert(batch, "findSavedLinks must issue a BatchGetCommand");
		const requested = batch.input.RequestItems as Record<string, { Keys: unknown[] }>;
		expect(requested[TABLE].Keys).toEqual([
			{ userId, linkKey: inboxSavedLinkKey("https://example.com/post") },
		]);
	});

	it("guards the failure write, so a dead letter cannot unsay an accepted save", async () => {
		const { client, commands } = createFakeClient([], { rejectConditionalPut: true });
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		await store.markLinkSaveFailed({ userId, url: "https://example.com/post" });

		const put = commands.find((command) => command.name === "PutCommand");
		assert(put, "markLinkSaveFailed must issue a PutCommand");
		expect(put.input.ConditionExpression).toBe(
			"attribute_not_exists(linkKey) OR #state <> :saved",
		);
		expect(put.input.ExpressionAttributeValues).toEqual({ ":saved": "saved" });
	});

	it("still surfaces a genuine store fault on the guarded write", async () => {
		const client = {
			send: (async () => {
				throw new Error("dynamo unavailable");
			}) as SendFn,
		};
		const store = initDynamoDbInboxSavedLink({
			client: client as typeof client & DynamoDBDocumentClient,
			tableName: TABLE,
			now,
		});

		await expect(
			store.markLinkSaveFailed({ userId, url: "https://example.com/post" }),
		).rejects.toThrow("dynamo unavailable");
	});

	it("writes an accepted save unconditionally, so redelivery converges", async () => {
		const { client, commands } = createFakeClient();
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		await store.markLinkSaved({ userId, url: "https://example.com/post" });

		const put = commands.find((command) => command.name === "PutCommand");
		assert(put, "markLinkSaved must issue a PutCommand");
		expect(put.input.ConditionExpression).toBeUndefined();
	});

	it("keys a url far longer than a DynamoDB sort key allows", async () => {
		const { client, commands } = createFakeClient();
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });
		const longUrl = `https://esp.example.com/click/${"a".repeat(2000)}`;

		await store.markLinkSaved({ userId, url: longUrl });

		const put = commands.find((command) => command.name === "PutCommand");
		assert(put, "markLinkSaved must issue a PutCommand");
		const { linkKey } = put.input.Item as { linkKey: string };
		expect(Buffer.byteLength(linkKey, "utf8")).toBeLessThanOrEqual(1024);
	});

	it("skips a url that is not parseable rather than failing the whole page", async () => {
		const { client } = createFakeClient([savedRow("https://example.com/post")]);
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		const states = await store.findSavedLinks({
			userId,
			urls: ["not a url at all", "https://example.com/post"],
		});

		expect([...states]).toEqual([["https://example.com/post", "saved"]]);
	});

	it("issues no request when there is nothing to look up", async () => {
		const { client, commands } = createFakeClient();
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		const states = await store.findSavedLinks({ userId, urls: [] });

		expect(states.size).toBe(0);
		expect(commands).toEqual([]);
	});

	it("deletes every row in the user's partition", async () => {
		const { client, commands } = createFakeClient([
			savedRow("https://example.com/one"),
			savedRow("https://example.com/two"),
		]);
		const store = initDynamoDbInboxSavedLink({ client, tableName: TABLE, now });

		await store.deleteAllByUserId(userId);

		const deletes = commands.filter((command) => command.name === "DeleteCommand");
		expect(deletes.map((command) => command.input.Key)).toEqual([
			{ userId, linkKey: inboxSavedLinkKey("https://example.com/one") },
			{ userId, linkKey: inboxSavedLinkKey("https://example.com/two") },
		]);
	});
});
