import assert from "node:assert/strict";
import { ImportSessionIdSchema } from "@packages/domain/import-session";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbImportSession } from "./dynamodb-import-session";

interface CapturedCommand {
	name: string;
	input: {
		Item?: Record<string, unknown>;
		Key?: Record<string, unknown>;
		ConditionExpression?: string;
		ExpressionAttributeValues?: Record<string, unknown>;
	};
}

const TABLE = "test-import-sessions";
const SESSION_ID = ImportSessionIdSchema.parse("0123456789abcdef0123456789abcdef");
const OWNER = UserIdSchema.parse("00000000000000000000000000000001");
const NOW = () => new Date("2026-05-01T00:00:00Z");

const ANON_CONDITION = "attribute_not_exists(userId)";
const OWNED_CONDITION = "attribute_not_exists(userId) OR userId = :uid";

/** A stored row that survives loadAccessible's expiry check under NOW(). Omitting
 * `userId` makes it anonymous (capability-accessible); setting it makes it owned. */
function storedRow(userId?: UserId): Record<string, unknown> {
	return {
		sessionId: SESSION_ID,
		...(userId ? { userId } : {}),
		createdAt: "2026-05-01T00:00:00.000Z",
		expiresAt: 9_999_999_999,
		totalUrls: 2,
		totalFoundInFile: 2,
		truncated: false,
		urls: ["https://example.com/a", "https://example.com/b"],
		deselected: [],
		allSelected: true,
	};
}

/** Replays `row` for the GetCommand that guarded toggles issue first, and records
 * every command so the write's ConditionExpression / ExpressionAttributeValues can
 * be asserted. A null `row` makes Get return no item (caller is denied). */
function createFakeClient(row: Record<string, unknown> | null): {
	client: DynamoDBDocumentClient;
	commands: CapturedCommand[];
} {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: CapturedCommand["input"] }) => {
			commands.push({ name: command.constructor.name, input: command.input });
			if (command.constructor.name === "GetCommand") return row ? { Item: row } : {};
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

function initStore(client: DynamoDBDocumentClient) {
	return initDynamoDbImportSession({ client, tableName: TABLE, now: NOW });
}

describe("initDynamoDbImportSession", () => {
	describe("createImportSession", () => {
		it("omits userId from the put item for an anonymous session", async () => {
			const { client, commands } = createFakeClient(null);

			await initStore(client).createImportSession({
				userId: undefined,
				urls: ["https://example.com/a"],
				truncated: false,
				totalFound: 1,
			});

			const put = commands.find((c) => c.name === "PutCommand");
			assert(put?.input.Item, "create must put an item");
			assert.equal("userId" in put.input.Item, false);
		});

		it("stores the owner's userId on the put item when authenticated", async () => {
			const { client, commands } = createFakeClient(null);

			await initStore(client).createImportSession({
				userId: OWNER,
				urls: ["https://example.com/a"],
				truncated: false,
				totalFound: 1,
			});

			const put = commands.find((c) => c.name === "PutCommand");
			assert(put?.input.Item, "create must put an item");
			assert.equal(put.input.Item.userId, OWNER);
		});
	});

	describe("toggleImportSelection ownership condition", () => {
		it("guards an anonymous toggle by attribute_not_exists(userId) with no :uid value", async () => {
			const { client, commands } = createFakeClient(storedRow());

			await initStore(client).toggleImportSelection({
				id: SESSION_ID,
				userId: undefined,
				index: 0,
				checked: false,
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			assert.equal(update?.input.ConditionExpression, ANON_CONDITION);
			const values = update?.input.ExpressionAttributeValues;
			assert(values, "toggle must bind update values");
			assert.equal(":uid" in values, false);
			assert(Object.keys(values).length > 0, "must never send an empty ExpressionAttributeValues map");
		});

		it("guards an authenticated toggle by the owner-or-anon condition with :uid bound", async () => {
			const { client, commands } = createFakeClient(storedRow());

			await initStore(client).toggleImportSelection({
				id: SESSION_ID,
				userId: OWNER,
				index: 0,
				checked: false,
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			assert.equal(update?.input.ConditionExpression, OWNED_CONDITION);
			assert.equal(update?.input.ExpressionAttributeValues?.[":uid"], OWNER);
		});

		it("issues no write when an anonymous caller targets an owned row", async () => {
			const { client, commands } = createFakeClient(storedRow(OWNER));

			await initStore(client).toggleImportSelection({
				id: SESSION_ID,
				userId: undefined,
				index: 0,
				checked: false,
			});

			assert.equal(
				commands.some((c) => c.name === "UpdateCommand"),
				false,
			);
		});
	});

	describe("toggleAllImportSelection ownership condition", () => {
		it("guards an anonymous bulk toggle by attribute_not_exists(userId) with no :uid value", async () => {
			const { client, commands } = createFakeClient(storedRow());

			await initStore(client).toggleAllImportSelection({
				id: SESSION_ID,
				userId: undefined,
				checked: false,
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			assert.equal(update?.input.ConditionExpression, ANON_CONDITION);
			const values = update?.input.ExpressionAttributeValues;
			assert(values, "bulk toggle must bind update values");
			assert.equal(":uid" in values, false);
			assert(Object.keys(values).length > 0, "must never send an empty ExpressionAttributeValues map");
		});

		it("guards an authenticated bulk toggle by the owner-or-anon condition with :uid bound", async () => {
			const { client, commands } = createFakeClient(storedRow(OWNER));

			await initStore(client).toggleAllImportSelection({
				id: SESSION_ID,
				userId: OWNER,
				checked: true,
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			assert.equal(update?.input.ConditionExpression, OWNED_CONDITION);
			assert.equal(update?.input.ExpressionAttributeValues?.[":uid"], OWNER);
		});
	});

	describe("deleteImportSession ownership condition", () => {
		it("guards an anonymous delete by attribute_not_exists(userId) and sends no ExpressionAttributeValues", async () => {
			const { client, commands } = createFakeClient(null);

			await initStore(client).deleteImportSession({ id: SESSION_ID, userId: undefined });

			const del = commands.find((c) => c.name === "DeleteCommand");
			assert.equal(del?.input.ConditionExpression, ANON_CONDITION);
			assert.equal(del?.input.ExpressionAttributeValues, undefined);
		});

		it("guards an authenticated delete by the owner-or-anon condition with :uid bound", async () => {
			const { client, commands } = createFakeClient(null);

			await initStore(client).deleteImportSession({ id: SESSION_ID, userId: OWNER });

			const del = commands.find((c) => c.name === "DeleteCommand");
			assert.equal(del?.input.ConditionExpression, OWNED_CONDITION);
			assert.deepEqual(del?.input.ExpressionAttributeValues, { ":uid": OWNER });
		});
	});
});
