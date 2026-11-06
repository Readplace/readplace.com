import assert from "node:assert/strict";
import { formatEmailLinkOrdinal } from "@packages/domain/inbox";
import { ReadlistPurposeVersionSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/storage-client";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import { initDynamoDbReadlistFitOverrides } from "./dynamodb-readlist-fit-overrides";

type Captured = { name: string; input: Record<string, unknown> };

/**
 * 1. The DocumentClient `send` is a heavily-overloaded generic the test fake
 *    cannot structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeDynamo(
	responses: (Record<string, unknown> | (() => Record<string, unknown>))[],
	commands: Captured[],
): DynamoDBDocumentClient {
	let call = 0;
	const send = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
		commands.push({ name: command.constructor.name, input: command.input });
		const response = responses[call] ?? {};
		call += 1;
		return typeof response === "function" ? response() : response;
	};
	return { send } as unknown as DynamoDBDocumentClient /* 1 */;
}

const TABLE = "user-articles";
const USER = "abc123" as UserId;
const WORK = ReadlistSlugSchema.parse("work");
const MESSAGE = "2026-11-02T21:15:00.000Z#msg-1";
const CREATED_AT = new Date("2026-11-03T08:00:00.000Z");
const OVERRIDE_ID = `${Number.MAX_SAFE_INTEGER - CREATED_AT.getTime()}-${MESSAGE}-0003`;
const OVERRIDE_KEY = `readplace:queue-override/work/${OVERRIDE_ID}`;

const ENGINE_OVERRIDE: Omit<ReadlistFitOverride, "id"> = {
	url: "https://example.com/post",
	anchorText: "A post",
	host: "example.com",
	engineVerdict: "drop",
	engineReason: "About cooking, not work.",
	readerVerdict: "keep",
	purposeVersion: ReadlistPurposeVersionSchema.parse("0123456789ab"),
	receivedAtMessageId: MESSAGE,
	ordinal: formatEmailLinkOrdinal(3),
	createdAt: CREATED_AT,
};

const FAILED_OVERRIDE: Omit<ReadlistFitOverride, "id"> = {
	url: "https://example.com/post",
	anchorText: "A post",
	host: "example.com",
	readerVerdict: "drop",
	receivedAtMessageId: MESSAGE,
	ordinal: formatEmailLinkOrdinal(3),
	createdAt: CREATED_AT,
};

function overrideItem(url: string): Record<string, unknown> {
	return {
		userId: USER,
		url,
		articleUrl: "https://example.com/post",
		anchorText: "A post",
		host: "example.com",
		readerVerdict: "keep",
		receivedAtMessageId: MESSAGE,
		ordinal: "0003",
		createdAt: CREATED_AT.toISOString(),
	};
}

function initStore(responses: Parameters<typeof createFakeDynamo>[0], commands: Captured[] = []) {
	return initDynamoDbReadlistFitOverrides({
		client: createFakeDynamo(responses, commands),
		userArticlesTableName: TABLE,
	});
}

function conditionalCheckFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ message: "conditional", $metadata: {} });
}

describe("recordReadlistFitOverride", () => {
	it("writes the choice under the user's own partition, keyed so the newest sorts first", async () => {
		const commands: Captured[] = [];
		const store = initStore([{}, { Items: [] }], commands);

		const id = await store.recordReadlistFitOverride({ userId: USER, readlist: WORK, override: ENGINE_OVERRIDE });

		assert.equal(id, OVERRIDE_ID);
		const put = commands[0];
		assert.equal(put?.name, "PutCommand");
		assert.deepEqual(put?.input.Item, {
			userId: USER,
			url: OVERRIDE_KEY,
			articleUrl: "https://example.com/post",
			anchorText: "A post",
			host: "example.com",
			engineVerdict: "drop",
			engineReason: "About cooking, not work.",
			readerVerdict: "keep",
			purposeVersion: "0123456789ab",
			receivedAtMessageId: MESSAGE,
			ordinal: "0003",
			createdAt: CREATED_AT.toISOString(),
		});
		assert.equal(put?.input.ConditionExpression, "attribute_not_exists(#url)");
	});

	it("leaves out what a failed decision never had", async () => {
		const commands: Captured[] = [];
		const store = initStore([{}, { Items: [] }], commands);

		await store.recordReadlistFitOverride({ userId: USER, readlist: WORK, override: FAILED_OVERRIDE });

		const item = commands[0]?.input.Item;
		assert.ok(item && typeof item === "object");
		assert.equal("engineVerdict" in item, false);
		assert.equal("engineReason" in item, false);
		assert.equal("purposeVersion" in item, false);
	});

	it("sorts a later choice before an earlier one", async () => {
		const store = initStore([{}, { Items: [] }, {}, { Items: [] }]);

		const earlier = await store.recordReadlistFitOverride({ userId: USER, readlist: WORK, override: ENGINE_OVERRIDE });
		const later = await store.recordReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			override: { ...ENGINE_OVERRIDE, createdAt: new Date(CREATED_AT.getTime() + 1) },
		});

		assert.equal(later < earlier, true);
	});

	it("deletes the 21st newest choice so the readlist keeps 20", async () => {
		const commands: Captured[] = [];
		const rows = Array.from({ length: 21 }, (_, index) => overrideItem(`readplace:queue-override/work/row-${index}`));
		const store = initStore([{}, { Items: rows }, {}], commands);

		await store.recordReadlistFitOverride({ userId: USER, readlist: WORK, override: ENGINE_OVERRIDE });

		const query = commands[1];
		assert.equal(query?.input.Limit, 21);
		assert.equal(query?.input.ConsistentRead, true);
		assert.deepEqual(query?.input.ExpressionAttributeValues, {
			":userId": USER,
			":prefix": "readplace:queue-override/work/",
		});
		const deletes = commands.filter((c) => c.name === "DeleteCommand");
		assert.deepEqual(
			deletes.map((d) => d.input.Key),
			[{ userId: USER, url: "readplace:queue-override/work/row-20" }],
		);
	});

	it("deletes nothing while the readlist holds 20 or fewer", async () => {
		const commands: Captured[] = [];
		const rows = Array.from({ length: 20 }, (_, index) => overrideItem(`readplace:queue-override/work/row-${index}`));
		const store = initStore([{}, { Items: rows }], commands);

		await store.recordReadlistFitOverride({ userId: USER, readlist: WORK, override: ENGINE_OVERRIDE });

		assert.equal(commands.filter((c) => c.name === "DeleteCommand").length, 0);
	});
});

describe("listReadlistFitOverrides", () => {
	it("reads the newest 20 in one consistent query and round-trips what was recorded", async () => {
		const recorded: Captured[] = [];
		await initStore([{}, { Items: [] }], recorded).recordReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			override: ENGINE_OVERRIDE,
		});
		const commands: Captured[] = [];
		const store = initStore([{ Items: [recorded[0]?.input.Item], LastEvaluatedKey: { userId: USER, url: "x" } }], commands);

		const overrides = await store.listReadlistFitOverrides({ userId: USER, readlist: WORK });

		assert.deepEqual(overrides, [{ id: OVERRIDE_ID, ...ENGINE_OVERRIDE }]);
		assert.equal(commands.length, 1);
		assert.equal(commands[0]?.input.Limit, 20);
		assert.equal(commands[0]?.input.ConsistentRead, true);
	});

	it("reads a failed decision's choice without the engine's verdict", async () => {
		const store = initStore([{ Items: [overrideItem(OVERRIDE_KEY)] }]);

		const [override] = await store.listReadlistFitOverrides({ userId: USER, readlist: WORK });

		assert.ok(override);
		assert.equal("engineVerdict" in override, false);
		assert.equal("engineReason" in override, false);
		assert.equal("purposeVersion" in override, false);
	});
});

describe("deleteReadlistFitOverride", () => {
	it("deletes the one choice by its id", async () => {
		const commands: Captured[] = [];
		const store = initStore([{}], commands);

		await store.deleteReadlistFitOverride({
			userId: USER,
			readlist: WORK,
			id: (await initStore([{}, { Items: [] }]).recordReadlistFitOverride({
				userId: USER,
				readlist: WORK,
				override: ENGINE_OVERRIDE,
			})),
		});

		assert.deepEqual(commands[0]?.input.Key, { userId: USER, url: OVERRIDE_KEY });
	});
});

describe("purgeReadlistFitOverrides", () => {
	it("pages through the readlist's choices and deletes every one", async () => {
		const commands: Captured[] = [];
		const store = initStore(
			[
				{ Items: [{ userId: USER, url: "readplace:queue-override/work/a" }], LastEvaluatedKey: { userId: USER, url: "a" } },
				{},
				{ Items: [{ userId: USER, url: "readplace:queue-override/work/b" }] },
				{},
			],
			commands,
		);

		await store.purgeReadlistFitOverrides({ userId: USER, readlist: WORK });

		const queries = commands.filter((c) => c.name === "QueryCommand");
		assert.equal(queries.length, 2);
		assert.deepEqual(queries[1]?.input.ExclusiveStartKey, { userId: USER, url: "a" });
		assert.deepEqual(queries[0]?.input.ExpressionAttributeValues, {
			":userId": USER,
			":prefix": "readplace:queue-override/work/",
		});
		assert.deepEqual(
			commands.filter((c) => c.name === "DeleteCommand").map((d) => d.input.Key),
			[
				{ userId: USER, url: "readplace:queue-override/work/a" },
				{ userId: USER, url: "readplace:queue-override/work/b" },
			],
		);
	});
});

describe("deleteReadlistArticleByUrl", () => {
	it("deletes the saved row in the readlist's partition", async () => {
		const commands: Captured[] = [];
		const store = initStore([{}], commands);

		const deleted = await store.deleteReadlistArticleByUrl({
			userId: USER,
			readlist: WORK,
			url: "https://example.com/post",
		});

		assert.equal(deleted, true);
		assert.deepEqual(commands[0]?.input.Key, { userId: `${USER}#queue/work`, url: "example.com/post" });
		assert.equal(commands[0]?.input.ConditionExpression, "attribute_exists(savedAt)");
	});

	it("answers false when the readlist no longer holds the article", async () => {
		const store = initStore([
			() => {
				throw conditionalCheckFailed();
			},
		]);

		assert.equal(
			await store.deleteReadlistArticleByUrl({ userId: USER, readlist: WORK, url: "https://example.com/post" }),
			false,
		);
	});

	it("passes on any other failure", async () => {
		const store = initStore([
			() => {
				throw new Error("throttled");
			},
		]);

		await assert.rejects(
			store.deleteReadlistArticleByUrl({ userId: USER, readlist: WORK, url: "https://example.com/post" }),
			/throttled/,
		);
	});
});
