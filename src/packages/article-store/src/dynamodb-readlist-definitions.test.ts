import {
	READLIST_MAX_PER_USER,
	ReadlistLimitReachedError,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	TransactionCanceledException,
	type DynamoDBDocumentClient,
} from "@packages/storage-client";
import { initDynamoDbReadlistDefinitions } from "./dynamodb-readlist-definitions";

/**
 * 1. The DocumentClient `send` is a heavily-overloaded generic the test fake
 *    cannot structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeDynamo(
	responses: (Record<string, unknown> | (() => Record<string, unknown>))[],
	capture: (command: { name: string; input: Record<string, unknown> }) => void,
): DynamoDBDocumentClient {
	let call = 0;
	const send = async (command: {
		constructor: { name: string };
		input: Record<string, unknown>;
	}) => {
		capture({ name: command.constructor.name, input: command.input });
		const response = responses[call] ?? {};
		call += 1;
		return typeof response === "function" ? response() : response;
	};
	return { send } as unknown as DynamoDBDocumentClient /* 1 */;
}

const TABLE = "user-articles";
const USER = "abc123" as UserId;
const WORK = ReadlistSlugSchema.parse("work");

function definitionItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		userId: USER,
		url: "readplace:queue-def/work",
		queueSlug: "work",
		queueLabel: "Work Reading",
		createdAt: "2026-08-19T10:00:00.000Z",
		...overrides,
	};
}

function conditionalCheckFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ message: "conditional", $metadata: {} });
}

describe("listReadlistDefinitions", () => {
	it("preserves a starter definition's campaign", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{ Items: [definitionItem({ starterCampaignId: "hn-starter-v1" })] }],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		const [definition] = await listReadlistDefinitions(USER);

		expect(definition?.starterCampaignId).toBe("hn-starter-v1");
	});

	it("reads when a readlist was pinned, and leaves an unpinned one without a pin", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{
						Items: [
							definitionItem({ pinnedAt: "2026-11-01T09:00:00.000Z" }),
							definitionItem({ url: "readplace:queue-def/home", queueSlug: "home", createdAt: "2026-08-20T10:00:00.000Z" }),
						],
					},
				],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		const [pinned, unpinned] = await listReadlistDefinitions(USER);

		expect(pinned?.pinnedAt).toEqual(new Date("2026-11-01T09:00:00.000Z"));
		expect(unpinned).not.toHaveProperty("pinnedAt");
	});

	it("reads a row that still holds a retired email delivery choice", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{ Items: [definitionItem({ queueEmailDelivery: "issue" })] }],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		const [definition] = await listReadlistDefinitions(USER);

		expect(definition).not.toHaveProperty("emailDelivery");
	});

	it("queries the user's partition by definition-key prefix and never scans", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{
						Items: [definitionItem({ queuePurpose: "Essays on how teams actually ship." })],
						Count: 1,
					},
				],
				(c) => commands.push(c),
			),
			userArticlesTableName: TABLE,
		});

		const definitions = await listReadlistDefinitions(USER);

		expect(definitions).toEqual([
			{
				slug: "work",
				label: "Work Reading",
				purpose: "Essays on how teams actually ship.",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			},
		]);
		expect(commands.map((c) => c.name)).toEqual(["QueryCommand"]);
		expect(commands[0]?.input).toMatchObject({
			TableName: TABLE,
			KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
			ExpressionAttributeValues: { ":userId": USER, ":prefix": "readplace:queue-def/" },
			ConsistentRead: true,
		});
	});

	it("pages until the index is exhausted", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{
						Items: [definitionItem()],
						Count: 1,
						LastEvaluatedKey: { userId: USER, url: "readplace:queue-def/work" },
					},
					{
						Items: [
							definitionItem({
								url: "readplace:queue-def/later",
								queueSlug: "later",
								queueLabel: "Later",
								createdAt: "2026-08-19T11:00:00.000Z",
							}),
						],
						Count: 1,
					},
				],
				(c) => commands.push(c),
			),
			userArticlesTableName: TABLE,
		});

		const definitions = await listReadlistDefinitions(USER);

		expect(definitions.map((d) => d.slug)).toEqual(["work", "later"]);
		expect(commands[1]?.input.ExclusiveStartKey).toEqual({
			userId: USER,
			url: "readplace:queue-def/work",
		});
	});

	it("orders by creation instant, and by slug when two readlists share one", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{
						Items: [
							definitionItem({ queueSlug: "later", createdAt: "2026-08-19T12:00:00.000Z" }),
							definitionItem({ queueSlug: "zebra", createdAt: "2026-08-19T10:00:00.000Z" }),
							definitionItem({ queueSlug: "alpha", createdAt: "2026-08-19T10:00:00.000Z" }),
						],
						Count: 3,
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect((await listReadlistDefinitions(USER)).map((d) => d.slug)).toEqual([
			"alpha",
			"zebra",
			"later",
		]);
	});
});

describe("createReadlistDefinition", () => {
	it("writes the definition row under its prefixed key, guarded against overwriting one", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{ Items: [], Count: 0 }, {}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		const result = await createReadlistDefinition({
			userId: USER,
			slug: WORK,
			label: "Work Reading",
			createdAt: new Date("2026-08-19T10:00:00.000Z"),
		});

		expect(result).toEqual({ created: true, ownedCount: 1 });
		const put = commands.find((c) => c.name === "PutCommand");
		expect(put?.input).toMatchObject({
			TableName: TABLE,
			Item: {
				userId: USER,
				url: "readplace:queue-def/work",
				queueSlug: "work",
				queueLabel: "Work Reading",
				createdAt: "2026-08-19T10:00:00.000Z",
			},
			ConditionExpression: "attribute_not_exists(#url)",
		});
	});

	it("answers created:false when the slug is already taken rather than replacing the readlist", async () => {
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{ Items: [definitionItem()], Count: 1 },
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(
			await createReadlistDefinition({
				userId: USER,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			}),
		).toEqual({ created: false, ownedCount: 1 });
	});

	it("reports the reader's readlist count after a create, so a caller can spot the cap approaching", async () => {
		const owned = READLIST_MAX_PER_USER - 2;
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{
						Items: Array.from({ length: owned }, (_, index) =>
							definitionItem({ queueSlug: `readlist${index}`, url: `readplace:queue-def/readlist${index}` }),
						),
						Count: owned,
					},
					{},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(
			await createReadlistDefinition({
				userId: USER,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			}),
		).toEqual({ created: true, ownedCount: owned + 1 });
	});

	it("raises the limit error at the per-user cap instead of writing", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{
						Items: Array.from({ length: READLIST_MAX_PER_USER }, (_, index) =>
							definitionItem({ queueSlug: `readlist${index}`, url: `readplace:queue-def/readlist${index}` }),
						),
						Count: READLIST_MAX_PER_USER,
					},
				],
				(c) => commands.push(c),
			),
			userArticlesTableName: TABLE,
		});

		await expect(
			createReadlistDefinition({
				userId: USER,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			}),
		).rejects.toThrow(ReadlistLimitReachedError);
		expect(commands.some((c) => c.name === "PutCommand")).toBe(false);
	});

	it("propagates a write failure that is not a lost condition", async () => {
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{ Items: [], Count: 0 },
					() => {
						throw new Error("throttled");
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		await expect(
			createReadlistDefinition({
				userId: USER,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			}),
		).rejects.toThrow("throttled");
	});
});

describe("renameReadlistDefinition", () => {
	it("writes only the label, on a row that must already exist", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { renameReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await renameReadlistDefinition({ userId: USER, slug: WORK, label: "Deep Work" })).toEqual({
			renamed: true,
		});
		expect(commands[0].name).toBe("UpdateCommand");
		expect(commands[0].input).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
			ExpressionAttributeValues: { ":label": "Deep Work" },
		});
		expect(String(commands[0].input.UpdateExpression)).toContain("SET #label = :label");
		expect(String(commands[0].input.ConditionExpression)).toContain("attribute_exists(#url)");
	});

	it("reports a readlist that no longer has a definition row", async () => {
		const { renameReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(await renameReadlistDefinition({ userId: USER, slug: WORK, label: "Deep Work" })).toEqual({
			renamed: false,
		});
	});

	it("lets an unexpected storage failure surface", async () => {
		const { renameReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw new Error("throttled");
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		await expect(
			renameReadlistDefinition({ userId: USER, slug: WORK, label: "Deep Work" }),
		).rejects.toThrow("throttled");
	});
});

describe("setReadlistDefinitionPurpose", () => {
	it("writes only the purpose, on a row that must already exist", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { setReadlistDefinitionPurpose } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(
			await setReadlistDefinitionPurpose({
				userId: USER,
				slug: WORK,
				purpose: "Essays on how teams actually ship.",
			}),
		).toEqual({ updated: true });
		expect(commands[0].name).toBe("UpdateCommand");
		expect(commands[0].input).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
			ExpressionAttributeValues: { ":purpose": "Essays on how teams actually ship." },
		});
		expect(String(commands[0].input.UpdateExpression)).toContain("SET #purpose = :purpose");
		expect(String(commands[0].input.ConditionExpression)).toContain("attribute_exists(#url)");
	});

	it("reports a readlist that no longer has a definition row", async () => {
		const { setReadlistDefinitionPurpose } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(
			await setReadlistDefinitionPurpose({ userId: USER, slug: WORK, purpose: "Anything" }),
		).toEqual({ updated: false });
	});

	it("lets an unexpected storage failure surface", async () => {
		const { setReadlistDefinitionPurpose } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw new Error("throttled");
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		await expect(
			setReadlistDefinitionPurpose({ userId: USER, slug: WORK, purpose: "Anything" }),
		).rejects.toThrow("throttled");
	});
});

describe("clearReadlistDefinitionPurpose", () => {
	it("removes only the purpose, on a row that must already exist", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { clearReadlistDefinitionPurpose } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await clearReadlistDefinitionPurpose({ userId: USER, slug: WORK })).toEqual({
			cleared: true,
		});
		expect(commands[0].name).toBe("UpdateCommand");
		expect(commands[0].input).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
			UpdateExpression: "REMOVE #purpose",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#purpose": "queuePurpose" },
		});
	});

	it("reports a readlist that no longer has a definition row", async () => {
		const { clearReadlistDefinitionPurpose } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(await clearReadlistDefinitionPurpose({ userId: USER, slug: WORK })).toEqual({
			cleared: false,
		});
	});

	it("lets an unexpected storage failure surface", async () => {
		const { clearReadlistDefinitionPurpose } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw new Error("throttled");
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		await expect(clearReadlistDefinitionPurpose({ userId: USER, slug: WORK })).rejects.toThrow(
			"throttled",
		);
	});
});

describe("pinReadlistDefinition", () => {
	it("records the first pin time only, on a row that must already exist", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { pinReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(
			await pinReadlistDefinition({ userId: USER, slug: WORK, pinnedAt: new Date("2026-11-01T09:00:00.000Z") }),
		).toEqual({ pinned: true });
		expect(commands[0].name).toBe("UpdateCommand");
		expect(commands[0].input).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
			UpdateExpression: "SET #pinnedAt = if_not_exists(#pinnedAt, :pinnedAt)",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#pinnedAt": "pinnedAt" },
			ExpressionAttributeValues: { ":pinnedAt": "2026-11-01T09:00:00.000Z" },
		});
	});

	it("reports a readlist that no longer has a definition row", async () => {
		const { pinReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(await pinReadlistDefinition({ userId: USER, slug: WORK, pinnedAt: new Date() })).toEqual({
			pinned: false,
		});
	});
});

describe("unpinReadlistDefinition", () => {
	it("removes only the pin, on a row that must already exist", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { unpinReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await unpinReadlistDefinition({ userId: USER, slug: WORK })).toEqual({ unpinned: true });
		expect(commands[0].input).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
			UpdateExpression: "REMOVE #pinnedAt",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#pinnedAt": "pinnedAt" },
		});
	});

	it("reports a readlist that no longer has a definition row", async () => {
		const { unpinReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(await unpinReadlistDefinition({ userId: USER, slug: WORK })).toEqual({ unpinned: false });
	});
});

describe("deleteReadlistDefinition", () => {
	it("drops the row, on a row that must already exist", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { deleteReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await deleteReadlistDefinition({ userId: USER, slug: WORK })).toEqual({
			deleted: true,
		});
		expect(commands[0].name).toBe("DeleteCommand");
		expect(commands[0].input).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
		});
		expect(String(commands[0].input.ConditionExpression)).toContain("attribute_exists(#url)");
	});

	it("reports a readlist that no longer has a definition row", async () => {
		const { deleteReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(await deleteReadlistDefinition({ userId: USER, slug: WORK })).toEqual({
			deleted: false,
		});
	});

	it("lets an unexpected storage failure surface", async () => {
		const { deleteReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw new Error("throttled");
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		await expect(deleteReadlistDefinition({ userId: USER, slug: WORK })).rejects.toThrow(
			"throttled",
		);
	});
});

describe("readlist own-saves choice", () => {
	const SINCE = new Date("2026-11-20T09:00:00.000Z");
	const homeItem = (overrides: Record<string, unknown> = {}) =>
		definitionItem({ url: "readplace:queue-def/home", queueSlug: "home", queueLabel: "Home", ...overrides });
	const cancelled = (codes: (string | undefined)[] | undefined) => () => {
		throw new TransactionCanceledException({
			message: "cancelled",
			$metadata: {},
			CancellationReasons: codes?.map((Code) => ({ Code })),
		});
	};

	it("reads when a readlist took the choice, and leaves one without it unmarked", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{ Items: [definitionItem({ ownSavesSince: SINCE.toISOString() }), homeItem()] }],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		const definitions = await listReadlistDefinitions(USER);

		expect(definitions.find((d) => d.slug === WORK)?.ownSavesSince).toEqual(SINCE);
		expect(definitions.find((d) => d.slug !== WORK)).not.toHaveProperty("ownSavesSince");
	});

	it("sets the choice on the named readlist while checking that no other readlist of the reader holds it", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { setReadlistOwnSaves } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{ Items: [definitionItem(), homeItem()] }, {}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await setReadlistOwnSaves({ userId: USER, slug: WORK, since: SINCE })).toEqual({ outcome: "set" });
		expect(commands[1]?.name).toBe("TransactWriteCommand");
		expect(commands[1]?.input).toEqual({
			TransactItems: [
				{
					Update: {
						TableName: TABLE,
						Key: { userId: USER, url: "readplace:queue-def/work" },
						UpdateExpression: "SET #ownSavesSince = if_not_exists(#ownSavesSince, :since)",
						ConditionExpression: "attribute_exists(#url)",
						ExpressionAttributeNames: { "#url": "url", "#ownSavesSince": "ownSavesSince" },
						ExpressionAttributeValues: { ":since": SINCE.toISOString() },
					},
				},
				{
					ConditionCheck: {
						TableName: TABLE,
						Key: { userId: USER, url: "readplace:queue-def/home" },
						ConditionExpression: "attribute_not_exists(#ownSavesSince)",
						ExpressionAttributeNames: { "#ownSavesSince": "ownSavesSince" },
					},
				},
			],
		});
	});

	it.each([
		["a readlist the reader no longer has", [homeItem()], "readlist-gone"],
		["a starter readlist", [definitionItem({ starterCampaignId: "hn-starter-v1" })], "starter-readlist"],
		["a reader whose other readlist holds the choice", [definitionItem(), homeItem({ ownSavesSince: SINCE.toISOString() })], "held-by-another"],
	])("refuses %s without writing", async (_name, items, outcome) => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { setReadlistOwnSaves } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{ Items: items }], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await setReadlistOwnSaves({ userId: USER, slug: WORK, since: SINCE })).toEqual({ outcome });
		expect(commands.map((c) => c.name)).toEqual(["QueryCommand"]);
	});

	it.each([
		["the readlist's own row, deleted since the read", ["ConditionalCheckFailed", "None"], "readlist-gone"],
		["another readlist, which took the choice since the read", ["None", "ConditionalCheckFailed"], "held-by-another"],
	])("answers from a failed check on %s", async (_name, codes, outcome) => {
		const { setReadlistOwnSaves } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{ Items: [definitionItem(), homeItem()] }, cancelled(codes)], () => undefined),
			userArticlesTableName: TABLE,
		});

		expect(await setReadlistOwnSaves({ userId: USER, slug: WORK, since: SINCE })).toEqual({ outcome });
	});

	it.each([
		["a transaction conflict", ["TransactionConflict", "None"]],
		["a cancellation naming no reasons", undefined],
	])("rethrows %s", async (_name, codes) => {
		const { setReadlistOwnSaves } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{ Items: [definitionItem(), homeItem()] }, cancelled(codes)], () => undefined),
			userArticlesTableName: TABLE,
		});

		await expect(setReadlistOwnSaves({ userId: USER, slug: WORK, since: SINCE })).rejects.toBeInstanceOf(
			TransactionCanceledException,
		);
	});

	it("rethrows a failure that is not a cancellation", async () => {
		const { setReadlistOwnSaves } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{ Items: [definitionItem()] },
					() => {
						throw new Error("throttled");
					},
				],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		await expect(setReadlistOwnSaves({ userId: USER, slug: WORK, since: SINCE })).rejects.toThrow("throttled");
	});

	it("clears the choice, on a row that must already exist", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { clearReadlistOwnSaves } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await clearReadlistOwnSaves({ userId: USER, slug: WORK })).toEqual({ cleared: true });
		expect(commands[0]?.name).toBe("UpdateCommand");
		expect(commands[0]?.input).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
			UpdateExpression: "REMOVE #ownSavesSince",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#ownSavesSince": "ownSavesSince" },
		});
	});

	it("reports a cleared choice on a readlist that no longer has a definition row", async () => {
		const { clearReadlistOwnSaves } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		expect(await clearReadlistOwnSaves({ userId: USER, slug: WORK })).toEqual({ cleared: false });
	});
});
