import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import {
	initFindSmartMatchRevisions,
	initRecordSmartMatchRevision,
	smartMatchRevisionAttribute,
} from "./smart-match-revision-marker";

type Captured = { name: string; input: Record<string, unknown> };

/**
 * 1. The DocumentClient `send` is a heavily-overloaded generic the test fake
 *    cannot structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function fakeClient(respond: () => Record<string, unknown>, commands: Captured[]): DynamoDBDocumentClient {
	const send = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
		commands.push({ name: command.constructor.name, input: command.input });
		return respond();
	};
	return { send } as unknown as DynamoDBDocumentClient /* 1 */;
}

const USER = UserIdSchema.parse("user-a");
const WORK = ReadlistSlugSchema.parse("work");
const HOME = ReadlistSlugSchema.parse("home");
const STORED_KEY = "example.com/post";

function find(respond: () => Record<string, unknown>, commands: Captured[] = []) {
	return initFindSmartMatchRevisions({
		client: fakeClient(respond, commands),
		userArticlesTableName: "user-articles",
	})({ userId: USER, storedKey: STORED_KEY });
}

function record(respond: () => Record<string, unknown>, commands: Captured[] = []) {
	return initRecordSmartMatchRevision({
		client: fakeClient(respond, commands),
		userArticlesTableName: "user-articles",
	})({ userId: USER, storedKey: STORED_KEY, readlist: WORK, revision: 3 });
}

describe("smartMatchRevisionAttribute", () => {
	it("names one marker per readlist on the All row", () => {
		assert.equal(smartMatchRevisionAttribute(WORK), "smartMatchRevision#work");
	});
});

describe("initFindSmartMatchRevisions", () => {
	it("reads the All row consistently by its stored key", async () => {
		const commands: Captured[] = [];

		await find(() => ({}), commands);

		assert.equal(commands[0]?.name, "GetCommand");
		assert.deepEqual(commands[0]?.input.Key, { userId: USER, url: STORED_KEY });
		assert.equal(commands[0]?.input.ConsistentRead, true);
	});

	it("answers not-in-all when there is no All row", async () => {
		assert.deepEqual(await find(() => ({})), { kind: "not-in-all" });
	});

	it("answers not-in-all for a row that holds only markers, with no save", async () => {
		assert.deepEqual(await find(() => ({ Item: { userId: USER, url: STORED_KEY, "smartMatchRevision#work": 2 } })), {
			kind: "not-in-all",
		});
	});

	it("returns the save time and every readlist's recorded revision", async () => {
		const result = await find(() => ({
			Item: {
				userId: USER,
				url: STORED_KEY,
				savedAt: "2026-11-20T08:00:00.000Z",
				"readlistRemovedAt#work": "2026-11-21T08:00:00Z",
				"smartMatchRevision#work": 2,
				"smartMatchRevision#home": 5,
			},
		}));

		assert.deepEqual(result, {
			kind: "in-all",
			savedAt: new Date("2026-11-20T08:00:00.000Z"),
			revisions: new Map([
				[WORK, 2],
				[HOME, 5],
			]),
		});
	});
});

describe("initRecordSmartMatchRevision", () => {
	it("records the revision only on a saved All row whose marker is absent or older", async () => {
		const commands: Captured[] = [];

		assert.deepEqual(await record(() => ({}), commands), { recorded: true });

		assert.equal(commands[0]?.name, "UpdateCommand");
		assert.deepEqual(commands[0]?.input.Key, { userId: USER, url: STORED_KEY });
		assert.equal(commands[0]?.input.UpdateExpression, "SET #marker = :revision");
		assert.equal(
			commands[0]?.input.ConditionExpression,
			"attribute_exists(savedAt) AND (attribute_not_exists(#marker) OR #marker < :revision)",
		);
		assert.deepEqual(commands[0]?.input.ExpressionAttributeNames, { "#marker": "smartMatchRevision#work" });
		assert.deepEqual(commands[0]?.input.ExpressionAttributeValues, { ":revision": 3 });
	});

	it("answers recorded:false when the row is not in All or holds an equal or newer revision", async () => {
		const result = await record(() => {
			throw new ConditionalCheckFailedException({ message: "conditional", $metadata: {} });
		});

		assert.deepEqual(result, { recorded: false });
	});
});
