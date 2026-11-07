import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { initFindReadlistRemoval, initRecordReadlistRemoval, readlistRemovedAtAttribute } from "./readlist-removal-marker";

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

function record(respond: () => Record<string, unknown>, commands: Captured[] = []) {
	return initRecordReadlistRemoval({
		client: fakeClient(respond, commands),
		userArticlesTableName: "user-articles",
		now: () => new Date("2026-11-03T10:00:00.750Z"),
	})({ userId: USER, readlist: WORK, url: "https://example.com/post" });
}

describe("readlistRemovedAtAttribute", () => {
	it("names one attribute per readlist slug", () => {
		assert.equal(readlistRemovedAtAttribute(WORK), "readlistRemovedAt#work");
	});
});

describe("initRecordReadlistRemoval", () => {
	it("sets the slug's marker on the All row as a whole-second instant, only while the All row exists", async () => {
		const commands: Captured[] = [];

		await record(() => ({}), commands);

		assert.deepEqual(commands, [
			{
				name: "UpdateCommand",
				input: {
					TableName: "user-articles",
					Key: { userId: USER, url: "example.com/post" },
					UpdateExpression: "SET #removedAt = :removedAt",
					ConditionExpression: "attribute_exists(savedAt)",
					ExpressionAttributeNames: { "#removedAt": "readlistRemovedAt#work" },
					ExpressionAttributeValues: { ":removedAt": "2026-11-03T10:00:00Z" },
				},
			},
		]);
	});

	it("does nothing when the All row is gone", async () => {
		await record(() => {
			throw new ConditionalCheckFailedException({ message: "conditional", $metadata: {} });
		});
	});

	it("passes on any other failure", async () => {
		await assert.rejects(
			record(() => {
				throw new Error("throttled");
			}),
			/throttled/,
		);
	});
});

describe("initFindReadlistRemoval", () => {
	const find = (respond: () => Record<string, unknown>, commands: Captured[] = []) =>
		initFindReadlistRemoval({ client: fakeClient(respond, commands), userArticlesTableName: "user-articles" })({
			userId: USER,
			readlist: WORK,
			url: "https://example.com/post?utm_source=newsletter",
		});

	it("reads the slug's marker consistently from the All row keyed without tracking parameters", async () => {
		const commands: Captured[] = [];

		const removedAt = await find(() => ({ Item: { userId: USER, url: "example.com/post", "readlistRemovedAt#work": "2026-11-03T10:00:00Z" } }), commands);

		assert.equal(removedAt, "2026-11-03T10:00:00Z");
		assert.deepEqual(commands, [
			{
				name: "GetCommand",
				input: {
					TableName: "user-articles",
					Key: { userId: USER, url: "example.com/post" },
					ConsistentRead: true,
				},
			},
		]);
	});

	it("answers undefined for an All row without the marker and for no All row", async () => {
		assert.equal(await find(() => ({ Item: {} })), undefined);
		assert.equal(await find(() => ({})), undefined);
	});
});
