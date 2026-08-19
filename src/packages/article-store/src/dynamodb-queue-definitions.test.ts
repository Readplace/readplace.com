import {
	QUEUE_MAX_PER_USER,
	QueueLimitReachedError,
	QueueSlugSchema,
} from "@packages/domain/queue";
import type { UserId } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbQueueDefinitions } from "./dynamodb-queue-definitions";

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
const WORK = QueueSlugSchema.parse("work");

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

describe("listQueueDefinitions", () => {
	it("queries the user's partition by definition-key prefix and never scans", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { listQueueDefinitions } = initDynamoDbQueueDefinitions({
			client: createFakeDynamo([{ Items: [definitionItem()], Count: 1 }], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		const definitions = await listQueueDefinitions(USER);

		expect(definitions).toEqual([
			{ slug: "work", label: "Work Reading", createdAt: new Date("2026-08-19T10:00:00.000Z") },
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
		const { listQueueDefinitions } = initDynamoDbQueueDefinitions({
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

		const definitions = await listQueueDefinitions(USER);

		expect(definitions.map((d) => d.slug)).toEqual(["work", "later"]);
		expect(commands[1]?.input.ExclusiveStartKey).toEqual({
			userId: USER,
			url: "readplace:queue-def/work",
		});
	});

	it("orders by creation instant, and by slug when two queues share one", async () => {
		const { listQueueDefinitions } = initDynamoDbQueueDefinitions({
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

		expect((await listQueueDefinitions(USER)).map((d) => d.slug)).toEqual([
			"alpha",
			"zebra",
			"later",
		]);
	});
});

describe("createQueueDefinition", () => {
	it("writes the definition row under its prefixed key, guarded against overwriting one", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { createQueueDefinition } = initDynamoDbQueueDefinitions({
			client: createFakeDynamo([{ Items: [], Count: 0 }, {}], (c) => commands.push(c)),
			userArticlesTableName: TABLE,
		});

		const result = await createQueueDefinition({
			userId: USER,
			slug: WORK,
			label: "Work Reading",
			createdAt: new Date("2026-08-19T10:00:00.000Z"),
		});

		expect(result).toEqual({ created: true });
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

	it("answers created:false when the slug is already taken rather than replacing the queue", async () => {
		const { createQueueDefinition } = initDynamoDbQueueDefinitions({
			client: createFakeDynamo(
				[
					{ Items: [], Count: 0 },
					() => {
						throw conditionalCheckFailed();
					},
				],
				() => {},
			),
			userArticlesTableName: TABLE,
		});

		expect(
			await createQueueDefinition({
				userId: USER,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			}),
		).toEqual({ created: false });
	});

	it("raises the limit error at the per-user cap instead of writing", async () => {
		const commands: { name: string; input: Record<string, unknown> }[] = [];
		const { createQueueDefinition } = initDynamoDbQueueDefinitions({
			client: createFakeDynamo(
				[
					{
						Items: Array.from({ length: QUEUE_MAX_PER_USER }, (_, index) =>
							definitionItem({ queueSlug: `queue${index}`, url: `readplace:queue-def/queue${index}` }),
						),
						Count: QUEUE_MAX_PER_USER,
					},
				],
				(c) => commands.push(c),
			),
			userArticlesTableName: TABLE,
		});

		await expect(
			createQueueDefinition({
				userId: USER,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			}),
		).rejects.toThrow(QueueLimitReachedError);
		expect(commands.some((c) => c.name === "PutCommand")).toBe(false);
	});

	it("propagates a write failure that is not a lost condition", async () => {
		const { createQueueDefinition } = initDynamoDbQueueDefinitions({
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
			createQueueDefinition({
				userId: USER,
				slug: WORK,
				label: "Work Reading",
				createdAt: new Date("2026-08-19T10:00:00.000Z"),
			}),
		).rejects.toThrow("throttled");
	});
});
