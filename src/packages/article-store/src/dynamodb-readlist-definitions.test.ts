import {
	READLIST_MAX_PER_USER,
	ReadlistLimitReachedError,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/storage-client";
import { z } from "zod";
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
						Items: [definitionItem()],
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

describe("listReadlistDefinitions filing", () => {
	it("leaves a row written before filing modes existed without a filing", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{ Items: [definitionItem()] }], () => undefined),
			userArticlesTableName: TABLE,
		});

		const [definition] = await listReadlistDefinitions(USER);

		expect(definition).not.toHaveProperty("filing");
	});

	it("reads a row with no filing mode as a regular readlist, ignoring a purpose left on it", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{ Items: [definitionItem({ queuePurpose: "Essays on how teams actually ship." })] }],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		expect(await listReadlistDefinitions(USER)).toEqual([
			{
				slug: "work",
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			},
		]);
	});

	it("reads a manual row that still holds a purpose as a regular readlist without one", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{ Items: [definitionItem({ filingMode: "manual", queuePurpose: "Essays on how teams actually ship." })] }],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		const [definition] = await listReadlistDefinitions(USER);

		expect(definition?.filing).toEqual({ mode: "manual" });
	});

	it("reads a manual row as manual, ignoring any revision left from an earlier rule", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{ Items: [definitionItem({ filingMode: "manual", filingRuleRevision: 2 })] }],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		const [definition] = await listReadlistDefinitions(USER);

		expect(definition?.filing).toEqual({ mode: "manual" });
	});

	it("reads a smart row's purpose, rule revision and effective instant inside its filing", async () => {
		const { listReadlistDefinitions } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{
						Items: [
							definitionItem({
								filingMode: "smart",
								queuePurpose: "Essays on how teams actually ship.",
								filingRuleRevision: 3,
								filingRuleEffectiveAt: "2026-11-20T08:00:00.000Z",
							}),
						],
					},
				],
				() => undefined,
			),
			userArticlesTableName: TABLE,
		});

		expect(await listReadlistDefinitions(USER)).toEqual([
			{
				slug: "work",
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
				filing: {
					mode: "smart",
					purpose: "Essays on how teams actually ship.",
					revision: 3,
					effectiveAt: new Date("2026-11-20T08:00:00.000Z"),
				},
			},
		]);
	});
});

describe("setSmartReadlistRule", () => {
	it("stores the purpose as the rule and reads back the revision the write produced", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { setSmartReadlistRule } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{ Attributes: { filingRuleRevision: 1 } }, { Attributes: { filingRuleRevision: 2 } }],
				(c) => commands.push(c),
			),
			userArticlesTableName: TABLE,
		});
		const params = {
			userId: USER,
			slug: WORK,
			purpose: "Essays on how teams actually ship.",
			effectiveAt: new Date("2026-11-20T08:00:00.000Z"),
		};

		expect(await setSmartReadlistRule(params)).toEqual({ kind: "set", revision: 1 });
		expect(await setSmartReadlistRule(params)).toEqual({ kind: "set", revision: 2 });
		expect(commands[0].name).toBe("UpdateCommand");
		expect(commands[0].input).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
			ConditionExpression: "attribute_exists(#url)",
			ReturnValues: "UPDATED_NEW",
			ExpressionAttributeValues: {
				":smart": "smart",
				":purpose": "Essays on how teams actually ship.",
				":zero": 0,
				":one": 1,
				":effectiveAt": "2026-11-20T08:00:00.000Z",
			},
		});
		expect(String(commands[0].input.UpdateExpression)).toContain(
			"#revision = if_not_exists(#revision, :zero) + :one",
		);
	});

	it("reports a readlist that no longer has a definition row", async () => {
		const { setSmartReadlistRule } = initDynamoDbReadlistDefinitions({
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
			await setSmartReadlistRule({
				userId: USER,
				slug: WORK,
				purpose: "Anything",
				effectiveAt: new Date("2026-11-20T08:00:00.000Z"),
			}),
		).toEqual({ kind: "readlist-gone" });
	});
});

describe("turnOffSmartReadlistMatching", () => {
	it("returns a smart readlist to manual filing, bumping the revision and removing the purpose", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { turnOffSmartReadlistMatching } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await turnOffSmartReadlistMatching({ userId: USER, slug: WORK })).toEqual({ turnedOff: true });
		expect(commands[0].input).toMatchObject({
			Key: { userId: USER, url: "readplace:queue-def/work" },
			ExpressionAttributeNames: {
				"#mode": "filingMode",
				"#revision": "filingRuleRevision",
				"#effectiveAt": "filingRuleEffectiveAt",
				"#purpose": "queuePurpose",
			},
			UpdateExpression: "SET #mode = :manual, #revision = #revision + :one REMOVE #effectiveAt, #purpose",
			ConditionExpression: "#mode = :smart",
			ExpressionAttributeValues: { ":manual": "manual", ":smart": "smart", ":one": 1 },
		});
	});

	it("answers turnedOff:false for a readlist that is not smart", async () => {
		const { turnOffSmartReadlistMatching } = initDynamoDbReadlistDefinitions({
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

		expect(await turnOffSmartReadlistMatching({ userId: USER, slug: WORK })).toEqual({ turnedOff: false });
	});
});

const CREATED_AT = new Date("2026-08-19T10:00:00.000Z");

function ownedDefinitions(count: number) {
	return {
		Items: Array.from({ length: count }, (_, index) =>
			definitionItem({ queueSlug: `readlist${index}`, url: `readplace:queue-def/readlist${index}` }),
		),
		Count: count,
	};
}

function transactionCanceled(): TransactionCanceledException {
	return new TransactionCanceledException({
		message: "cancelled",
		$metadata: {},
		CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
	});
}

function transactItems(command: { input: Record<string, unknown> } | undefined) {
	return z.object({ TransactItems: z.array(z.record(z.string(), z.record(z.string(), z.unknown()))) })
		.parse(command?.input).TransactItems;
}

describe("createReadlistDefinition", () => {
	it("writes the definition row and the reader's first definition revision in one transaction", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}, { Items: [], Count: 0 }, {}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		const result = await createReadlistDefinition({ userId: USER, slug: WORK, label: "Work Reading", createdAt: CREATED_AT });

		expect(result).toEqual({ created: true, ownedCount: 1 });
		expect(commands.map((c) => c.name)).toEqual(["GetCommand", "QueryCommand", "TransactWriteCommand"]);
		expect(commands[0]?.input).toMatchObject({ Key: { userId: USER, url: "readplace:queue-revision" }, ConsistentRead: true });
		const [put, revision] = transactItems(commands[2]);
		expect(put?.Put).toMatchObject({
			TableName: TABLE,
			Item: {
				userId: USER,
				url: "readplace:queue-def/work",
				queueSlug: "work",
				queueLabel: "Work Reading",
				createdAt: "2026-08-19T10:00:00.000Z",
				filingMode: "manual",
			},
			ConditionExpression: "attribute_not_exists(#url)",
		});
		expect(revision?.Update).toMatchObject({
			Key: { userId: USER, url: "readplace:queue-revision" },
			UpdateExpression: "SET #revision = :next",
			ConditionExpression: "attribute_not_exists(#revision)",
			ExpressionAttributeValues: { ":next": 1 },
		});
	});

	it("conditions the revision increment on the revision it observed before counting", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{ Item: { definitionRevision: 4 } }, ownedDefinitions(2), {}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await createReadlistDefinition({ userId: USER, slug: WORK, label: "Work Reading", createdAt: CREATED_AT }))
			.toEqual({ created: true, ownedCount: 3 });
		expect(transactItems(commands[2])[1]?.Update).toMatchObject({
			ConditionExpression: "#revision = :observed",
			ExpressionAttributeValues: { ":observed": 4, ":next": 5 },
		});
	});

	it("answers created:false when the slug is already taken rather than replacing the readlist", async () => {
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{}, ownedDefinitions(1), () => { throw transactionCanceled(); }, { Item: definitionItem() }],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(await createReadlistDefinition({ userId: USER, slug: WORK, label: "Work Reading", createdAt: CREATED_AT }))
			.toEqual({ created: false, ownedCount: 1 });
	});

	it("recounts under a fresh revision when another create wins, and refuses once that create reaches the cap", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[
					{ Item: { definitionRevision: 7 } },
					ownedDefinitions(READLIST_MAX_PER_USER - 1),
					() => { throw transactionCanceled(); },
					{},
					{ Item: { definitionRevision: 8 } },
					ownedDefinitions(READLIST_MAX_PER_USER),
				],
				(c) => commands.push(c),
			),
			userArticlesTableName: TABLE,
		});

		await expect(createReadlistDefinition({ userId: USER, slug: WORK, label: "Work Reading", createdAt: CREATED_AT }))
			.rejects.toThrow(ReadlistLimitReachedError);
		expect(commands.filter((c) => c.name === "TransactWriteCommand")).toHaveLength(1);
	});

	it("creates on the retry when the competing write changed only the revision", async () => {
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(
				[{}, ownedDefinitions(0), () => { throw transactionCanceled(); }, {}, { Item: { definitionRevision: 1 } }, ownedDefinitions(1), {}],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(await createReadlistDefinition({ userId: USER, slug: WORK, label: "Work Reading", createdAt: CREATED_AT }))
			.toEqual({ created: true, ownedCount: 2 });
	});

	it("gives up when the reader's readlists keep changing", async () => {
		const contended = Array.from({ length: 8 }, () => [{}, ownedDefinitions(0), () => { throw transactionCanceled(); }, {}]).flat();
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo(contended, () => {}),
			userArticlesTableName: TABLE,
		});

		await expect(createReadlistDefinition({ userId: USER, slug: WORK, label: "Work Reading", createdAt: CREATED_AT }))
			.rejects.toThrow("the reader's readlists kept changing during the create");
	});

	it("raises the limit error at the per-user cap instead of writing", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}, ownedDefinitions(READLIST_MAX_PER_USER)], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		await expect(createReadlistDefinition({ userId: USER, slug: WORK, label: "Work Reading", createdAt: CREATED_AT }))
			.rejects.toThrow(ReadlistLimitReachedError);
		expect(commands.some((c) => c.name === "TransactWriteCommand")).toBe(false);
	});

	it("propagates a write failure that is not a lost condition", async () => {
		const { createReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}, ownedDefinitions(0), () => { throw new Error("throttled"); }], () => {}),
			userArticlesTableName: TABLE,
		});

		await expect(createReadlistDefinition({ userId: USER, slug: WORK, label: "Work Reading", createdAt: CREATED_AT }))
			.rejects.toThrow("throttled");
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
	it("drops the row and increments the reader's definition revision in one transaction", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { deleteReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([{}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		expect(await deleteReadlistDefinition({ userId: USER, slug: WORK })).toEqual({ deleted: true });
		expect(commands.map((c) => c.name)).toEqual(["TransactWriteCommand"]);
		const [removal, revision] = transactItems(commands[0]);
		expect(removal?.Delete).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-def/work" },
			ConditionExpression: "attribute_exists(#url)",
		});
		expect(revision?.Update).toMatchObject({
			TableName: TABLE,
			Key: { userId: USER, url: "readplace:queue-revision" },
			UpdateExpression: "SET #revision = if_not_exists(#revision, :zero) + :one",
		});
	});

	it("reports a readlist that no longer has a definition row", async () => {
		const { deleteReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([() => { throw transactionCanceled(); }], () => {}),
			userArticlesTableName: TABLE,
		});

		expect(await deleteReadlistDefinition({ userId: USER, slug: WORK })).toEqual({ deleted: false });
	});

	it("lets an unexpected storage failure surface", async () => {
		const { deleteReadlistDefinition } = initDynamoDbReadlistDefinitions({
			client: createFakeDynamo([() => { throw new Error("throttled"); }], () => {}),
			userArticlesTableName: TABLE,
		});

		await expect(deleteReadlistDefinition({ userId: USER, slug: WORK })).rejects.toThrow("throttled");
	});
});
