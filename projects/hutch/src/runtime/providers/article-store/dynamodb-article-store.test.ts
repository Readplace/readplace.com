import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { initDynamoDbArticleStore } from "./dynamodb-article-store";

const USER = "abc123" as UserId;
const URL = "https://example.com/article";
const RESOURCE_ID = "example.com/article";
const ROUTE_ID = ReaderArticleHashId.from(URL).value;
const TWO_MINUTES = MinutesSchema.parse(2);

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

type CommandResponse = Record<string, unknown> | (() => Record<string, unknown>);

/** Records every command sent and replays canned responses keyed by command
 * type, so a test can assert the exact UpdateExpression / ConditionExpression /
 * IndexName the store builds. Each command type can be given a FIFO queue of
 * responses (to drive the store's `do/while` pagination loops over
 * `LastEvaluatedKey`) plus a default for any further calls. A function response
 * is invoked so a test can throw to simulate a failed conditional write. */
function createFakeClient(
	responses: Partial<Record<string, { queue?: CommandResponse[]; default?: CommandResponse }>> = {},
): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const queues = new Map<string, CommandResponse[]>();
	for (const [name, spec] of Object.entries(responses)) {
		queues.set(name, [...(spec?.queue ?? [])]);
	}
	const resolve = (value: CommandResponse): Record<string, unknown> =>
		typeof value === "function" ? value() : value;
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			const queue = queues.get(name);
			if (queue && queue.length > 0) return resolve(queue.shift() as CommandResponse);
			const fallback = responses[name]?.default;
			return fallback ? resolve(fallback) : {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

function initStore(client: DynamoDBDocumentClient) {
	return initDynamoDbArticleStore({
		client,
		tableName: "articles",
		userArticlesTableName: "user-articles",
	});
}

function articleItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		url: RESOURCE_ID,
		routeId: ROUTE_ID,
		originalUrl: URL,
		title: "Title",
		siteName: "Example",
		excerpt: "Excerpt",
		wordCount: 250,
		imageUrl: "https://example.com/image.jpg",
		content: "<p>body</p>",
		estimatedReadTime: 2,
		savedAt: "2026-05-30T09:00:00.000Z",
		...overrides,
	};
}

function userArticleItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		userId: USER,
		url: RESOURCE_ID,
		status: "unread",
		savedAt: "2026-05-30T09:00:00.000Z",
		...overrides,
	};
}

describe("initDynamoDbArticleStore reader-ready columns", () => {
	it("markArticleViewed sets viewedAt unconditionally so a tracking write never errors the reader", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markArticleViewed({ userId: USER, url: URL, at: new Date("2026-05-30T10:00:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toContain("SET viewedAt = :at");
		expect(update?.input.ConditionExpression).toBeUndefined();
		expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":at"]).toBe(
			"2026-05-30T10:00:00.000Z",
		);
	});

	it("markReaderViewSucceeded writes succeededAt set-once via if_not_exists", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markReaderViewSucceeded({ userId: USER, url: URL, at: new Date("2026-05-30T10:00:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toContain("if_not_exists(succeededAt, :at)");
	});

	it("markReaderReadyEmailSent guards on attribute_not_exists(emailSentAt) so it is set-once", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markReaderReadyEmailSent({ userId: USER, url: URL, at: new Date("2026-05-30T10:05:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.ConditionExpression).toBe("attribute_not_exists(emailSentAt)");
	});

	it("markReaderReadyEmailSent swallows ConditionalCheckFailedException so a duplicate stamp is a no-op", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
				},
			},
		});

		await expect(
			initStore(client).markReaderReadyEmailSent({ userId: USER, url: URL, at: new Date() }),
		).resolves.toBeUndefined();
	});

	it("markReaderReadyEmailSent rethrows non-conditional errors", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new Error("throttled");
				},
			},
		});

		await expect(
			initStore(client).markReaderReadyEmailSent({ userId: USER, url: URL, at: new Date() }),
		).rejects.toThrow("throttled");
	});

	it("findUserArticlesByUrl queries the url-index (never a Scan) and maps savers with their viewedAt", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				default: {
					Items: [
						{ userId: "abc123", url: "x", status: "unread", savedAt: "2026-05-30T09:00:00.000Z", viewedAt: "2026-05-30T09:30:00.000Z" },
						{ userId: "def456", url: "x", status: "unread", savedAt: "2026-05-30T09:00:00.000Z" },
					],
					Count: 2,
				},
			},
		});

		const savers = await initStore(client).findUserArticlesByUrl(URL);

		const query = commands.find((c) => c.name === "QueryCommand");
		expect(query?.input.IndexName).toBe("url-index");
		expect(commands.some((c) => c.name === "ScanCommand")).toBe(false);
		expect(savers).toEqual([
			{ userId: "abc123", viewedAt: new Date("2026-05-30T09:30:00.000Z") },
			{ userId: "def456", viewedAt: undefined },
		]);
	});

	it("findUserArticlesByUrl follows LastEvaluatedKey across pages before returning every saver", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				queue: [
					{ Items: [{ userId: "abc123", url: "x", status: "unread", savedAt: "2026-05-30T09:00:00.000Z" }], Count: 1, LastEvaluatedKey: { url: "x", userId: "abc123" } },
					{ Items: [{ userId: "def456", url: "x", status: "unread", savedAt: "2026-05-30T09:00:00.000Z" }], Count: 1 },
				],
			},
		});

		const savers = await initStore(client).findUserArticlesByUrl(URL);

		expect(commands.filter((c) => c.name === "QueryCommand")).toHaveLength(2);
		expect(savers).toEqual([
			{ userId: "abc123", viewedAt: undefined },
			{ userId: "def456", viewedAt: undefined },
		]);
	});
});

describe("initDynamoDbArticleStore global writes", () => {
	it("saveArticleGlobally reports created=true on a fresh conditional put", async () => {
		const { client, commands } = createFakeClient();
		const result = await initStore(client).saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1, imageUrl: "https://x/i.jpg" },
			estimatedReadTime: TWO_MINUTES,
			savedAt: new Date("2026-05-30T09:00:00.000Z"),
		});

		const put = commands.find((c) => c.name === "PutCommand");
		expect(put?.input.ConditionExpression).toBe("attribute_not_exists(#url)");
		expect(result).toEqual({ created: true });
	});

	it("saveArticleGlobally reports created=false when the row already exists", async () => {
		const { client } = createFakeClient({
			PutCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
				},
			},
		});

		const result = await initStore(client).saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1, imageUrl: "https://x/i.jpg" },
			estimatedReadTime: TWO_MINUTES,
			savedAt: new Date("2026-05-30T09:00:00.000Z"),
		});

		expect(result).toEqual({ created: false });
	});

	it("saveArticleGlobally rethrows a non-conditional put error", async () => {
		const { client } = createFakeClient({
			PutCommand: {
				default: () => {
					throw new Error("throttled");
				},
			},
		});

		await expect(
			initStore(client).saveArticleGlobally({
				url: URL,
				metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1, imageUrl: "https://x/i.jpg" },
				estimatedReadTime: TWO_MINUTES,
				savedAt: new Date("2026-05-30T09:00:00.000Z"),
			}),
		).rejects.toThrow("throttled");
	});

	it("bumpArticleSavedAt writes savedAt guarded by attribute_exists", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).bumpArticleSavedAt({ url: URL, savedAt: new Date("2026-05-30T10:00:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe("SET savedAt = :savedAt");
		expect(update?.input.ConditionExpression).toBe("attribute_exists(#url)");
	});

	it("bumpArticleSavedAt is a no-op when the row no longer exists", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "gone" });
				},
			},
		});

		await expect(
			initStore(client).bumpArticleSavedAt({ url: URL, savedAt: new Date() }),
		).resolves.toBeUndefined();
	});

	it("bumpArticleSavedAt rethrows a non-conditional update error", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new Error("throttled");
				},
			},
		});

		await expect(
			initStore(client).bumpArticleSavedAt({ url: URL, savedAt: new Date() }),
		).rejects.toThrow("throttled");
	});

	it("saveArticle inserts the global row, upserts the user row, and returns the saved article", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: {
				queue: [{ Item: articleItem() }, { Item: userArticleItem({ readAt: "2026-05-30T11:00:00.000Z", status: "read" }) }],
			},
		});

		const saved = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250, imageUrl: "https://example.com/image.jpg" },
			estimatedReadTime: TWO_MINUTES,
		});

		expect(commands.some((c) => c.name === "PutCommand")).toBe(true);
		expect(saved.id).toBeInstanceOf(ReaderArticleHashId);
		expect(saved.url).toBe(URL);
		expect(saved.status).toBe("read");
		expect(saved.readAt).toEqual(new Date("2026-05-30T11:00:00.000Z"));
	});

	it("saveArticle bumps savedAt when the global row already exists", async () => {
		const { client, commands } = createFakeClient({
			PutCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
				},
			},
			GetCommand: {
				queue: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		const saved = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250, imageUrl: "https://example.com/image.jpg" },
			estimatedReadTime: TWO_MINUTES,
		});

		const bump = commands.find((c) => c.name === "UpdateCommand" && c.input.UpdateExpression === "SET savedAt = :savedAt");
		expect(bump).toBeDefined();
		expect(saved.readAt).toBeUndefined();
	});
});

describe("initDynamoDbArticleStore reads by id", () => {
	it("findArticleById joins the global row with the user row", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: userArticleItem() } },
		});

		const article = await initStore(client).findArticleById(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		expect(article?.url).toBe(URL);
		expect(article?.status).toBe("unread");
	});

	it("findArticleById returns null when the route id matches no article", async () => {
		const { client } = createFakeClient({ QueryCommand: { default: { Items: [], Count: 0 } } });

		const article = await initStore(client).findArticleById(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		expect(article).toBeNull();
	});

	it("findArticleById returns null when the user has not saved the matched article", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: undefined } },
		});

		const article = await initStore(client).findArticleById(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		expect(article).toBeNull();
	});

	it("findArticleUrlById resolves the original URL for a permalink", async () => {
		const { client } = createFakeClient({ QueryCommand: { default: { Items: [articleItem()], Count: 1 } } });

		const url = await initStore(client).findArticleUrlById(ReaderArticleHashId.fromHash(ROUTE_ID));

		expect(url).toBe(URL);
	});

	it("findArticleUrlById returns null for an unknown hash", async () => {
		const { client } = createFakeClient({ QueryCommand: { default: { Items: [], Count: 0 } } });

		const url = await initStore(client).findArticleUrlById(ReaderArticleHashId.fromHash(ROUTE_ID));

		expect(url).toBeNull();
	});
});

describe("initDynamoDbArticleStore findArticlesByUser", () => {
	it("uses the savedAt index with no filter by default and joins each user row to its article", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				queue: [
					{ Items: [], Count: 1 },
					{ Items: [userArticleItem()], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem()] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER });

		const firstQuery = commands.find((c) => c.name === "QueryCommand");
		expect(firstQuery?.input.IndexName).toBe("userId-savedAt-index");
		expect(firstQuery?.input.FilterExpression).toBeUndefined();
		expect(result.total).toBe(1);
		expect(result.articles).toHaveLength(1);
		expect(result.articles[0]?.url).toBe(URL);
	});

	it("applies a status FilterExpression and the readAt index when sorting by readAt", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				queue: [
					{ Items: [], Count: 1 },
					{ Items: [userArticleItem({ status: "read", readAt: "2026-05-30T11:00:00.000Z" })], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem()] } } },
		});

		const result = await initStore(client).findArticlesByUser({
			userId: USER,
			status: "read",
			sort: "readAt",
			order: "asc",
		});

		const firstQuery = commands.find((c) => c.name === "QueryCommand");
		expect(firstQuery?.input.IndexName).toBe("userId-readAt-index");
		expect(firstQuery?.input.FilterExpression).toBe("#status = :status");
		expect((firstQuery?.input.ExpressionAttributeValues as Record<string, unknown>)[":status"]).toBe("read");
		const pageQuery = commands.filter((c) => c.name === "QueryCommand")[1];
		expect(pageQuery?.input.ScanIndexForward).toBe(true);
		expect(result.articles[0]?.readAt).toEqual(new Date("2026-05-30T11:00:00.000Z"));
	});

	it("passes a metadata-only projection to BatchGet when excludeContent is set", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				queue: [
					{ Items: [], Count: 1 },
					{ Items: [userArticleItem()], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem({ content: undefined })] } } },
		});

		await initStore(client).findArticlesByUser({ userId: USER, excludeContent: true });

		const batch = commands.find((c) => c.name === "BatchGetCommand");
		const requestItems = batch?.input.RequestItems as Record<string, { ProjectionExpression?: string }>;
		expect(requestItems.articles.ProjectionExpression).toBe(
			"#url, #routeId, #originalUrl, #title, #siteName, #excerpt, #wordCount, #imageUrl, #estimatedReadTime, #savedAt, #contentSourceTier",
		);
	});

	it("sums COUNT pages and walks item pages, skipping earlier pages to reach the requested page", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				queue: [
					{ Items: [], Count: 1, LastEvaluatedKey: { url: "p1" } },
					{ Items: [], Count: 2 },
					{ Items: [userArticleItem({ url: "a" })], Count: 1, LastEvaluatedKey: { url: "a" } },
					{ Items: [userArticleItem({ url: "b" })], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem({ url: "b", originalUrl: "https://example.com/b" })] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER, page: 2, pageSize: 1 });

		expect(commands.filter((c) => c.name === "QueryCommand")).toHaveLength(4);
		expect(result.total).toBe(3);
		expect(result.articles).toHaveLength(1);
		expect(result.articles[0]?.url).toBe("https://example.com/b");
	});

	it("returns an empty page when no user rows match", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				queue: [
					{ Items: [], Count: 0 },
					{ Items: [], Count: 0 },
				],
			},
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER });

		expect(commands.some((c) => c.name === "BatchGetCommand")).toBe(false);
		expect(result).toEqual({ articles: [], total: 0, page: 1, pageSize: 20 });
	});

	it("drops a user row whose article was deleted from the global table between query and batch-get", async () => {
		const { client } = createFakeClient({
			QueryCommand: {
				queue: [
					{ Items: [], Count: 1 },
					{ Items: [userArticleItem({ url: "orphan" })], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER });

		expect(result.total).toBe(1);
		expect(result.articles).toEqual([]);
	});
});

describe("initDynamoDbArticleStore countArticlesByUser", () => {
	it("sums COUNT pages without fetching rows", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				queue: [
					{ Items: [], Count: 5, LastEvaluatedKey: { url: "p1" } },
					{ Items: [], Count: 3 },
				],
			},
		});

		const total = await initStore(client).countArticlesByUser({ userId: USER });

		expect(commands.every((c) => (c.input as { Select?: string }).Select === "COUNT")).toBe(true);
		expect(total).toBe(8);
	});

	it("applies a status FilterExpression when counting by status", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { queue: [{ Items: [], Count: 2 }] },
		});

		const total = await initStore(client).countArticlesByUser({ userId: USER, status: "unread" });

		const query = commands.find((c) => c.name === "QueryCommand");
		expect(query?.input.FilterExpression).toBe("#status = :status");
		expect(total).toBe(2);
	});
});

describe("initDynamoDbArticleStore deleteArticle", () => {
	it("deletes the user row and reports success", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: userArticleItem() } },
		});

		const deleted = await initStore(client).deleteArticle(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		expect(commands.some((c) => c.name === "DeleteCommand")).toBe(true);
		expect(deleted).toBe(true);
	});

	it("reports false when the article does not exist", async () => {
		const { client } = createFakeClient({ QueryCommand: { default: { Items: [], Count: 0 } } });

		const deleted = await initStore(client).deleteArticle(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		expect(deleted).toBe(false);
	});

	it("reports false when the user never saved the article", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: undefined } },
		});

		const deleted = await initStore(client).deleteArticle(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		expect(deleted).toBe(false);
	});
});

describe("initDynamoDbArticleStore updateArticleStatus", () => {
	it("stamps readAt when marking an article read", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: userArticleItem() } },
		});

		const updated = await initStore(client).updateArticleStatus(ReaderArticleHashId.fromHash(ROUTE_ID), USER, "read");

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe("SET #status = :status, readAt = :readAt");
		expect(updated).toBe(true);
	});

	it("removes readAt when marking an article unread", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: userArticleItem({ status: "read", readAt: "2026-05-30T11:00:00.000Z" }) } },
		});

		const updated = await initStore(client).updateArticleStatus(ReaderArticleHashId.fromHash(ROUTE_ID), USER, "unread");

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe("SET #status = :status REMOVE readAt");
		expect(updated).toBe(true);
	});

	it("reports false when the article does not exist", async () => {
		const { client } = createFakeClient({ QueryCommand: { default: { Items: [], Count: 0 } } });

		const updated = await initStore(client).updateArticleStatus(ReaderArticleHashId.fromHash(ROUTE_ID), USER, "read");

		expect(updated).toBe(false);
	});

	it("reports false when the user never saved the article", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: undefined } },
		});

		const updated = await initStore(client).updateArticleStatus(ReaderArticleHashId.fromHash(ROUTE_ID), USER, "read");

		expect(updated).toBe(false);
	});
});

describe("initDynamoDbArticleStore freshness, notification state, content and url lookup", () => {
	it("findArticleFreshness returns the etag, lastModified and contentFetchedAt", async () => {
		const { client } = createFakeClient({
			GetCommand: {
				default: { Item: { etag: '"e"', lastModified: "Sun, 10 May 2026 12:00:00 GMT", contentFetchedAt: "2026-05-10T12:00:00.000Z" } },
			},
		});

		const freshness = await initStore(client).findArticleFreshness(URL);

		expect(freshness).toEqual({
			etag: '"e"',
			lastModified: "Sun, 10 May 2026 12:00:00 GMT",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
		});
	});

	it("findArticleFreshness returns null when the row is absent", async () => {
		const { client } = createFakeClient({ GetCommand: { default: { Item: undefined } } });

		const freshness = await initStore(client).findArticleFreshness(URL);

		expect(freshness).toBeNull();
	});

	it("findUserArticleNotificationState hydrates every timestamp the gate reads", async () => {
		const { client } = createFakeClient({
			GetCommand: {
				default: {
					Item: userArticleItem({
						status: "read",
						succeededAt: "2026-05-30T09:30:00.000Z",
						viewedAt: "2026-05-30T09:20:00.000Z",
						emailSentAt: "2026-05-30T09:40:00.000Z",
					}),
				},
			},
		});

		const state = await initStore(client).findUserArticleNotificationState({ userId: USER, url: URL });

		expect(state).toEqual({
			savedAt: new Date("2026-05-30T09:00:00.000Z"),
			status: "read",
			succeededAt: new Date("2026-05-30T09:30:00.000Z"),
			viewedAt: new Date("2026-05-30T09:20:00.000Z"),
			emailSentAt: new Date("2026-05-30T09:40:00.000Z"),
		});
	});

	it("findUserArticleNotificationState leaves never-stamped timestamps undefined", async () => {
		const { client } = createFakeClient({ GetCommand: { default: { Item: userArticleItem() } } });

		const state = await initStore(client).findUserArticleNotificationState({ userId: USER, url: URL });

		expect(state).toEqual({
			savedAt: new Date("2026-05-30T09:00:00.000Z"),
			status: "unread",
			succeededAt: undefined,
			viewedAt: undefined,
			emailSentAt: undefined,
		});
	});

	it("findUserArticleNotificationState returns null when no row exists", async () => {
		const { client } = createFakeClient({ GetCommand: { default: { Item: undefined } } });

		const state = await initStore(client).findUserArticleNotificationState({ userId: USER, url: URL });

		expect(state).toBeNull();
	});

	it("findArticleByUrl maps the global row including savedAt and contentSourceTier", async () => {
		const { client } = createFakeClient({
			GetCommand: { default: { Item: articleItem({ contentSourceTier: "tier-1", content: undefined }) } },
		});

		const data = await initStore(client).findArticleByUrl(URL);

		expect(data?.id).toBeInstanceOf(ReaderArticleHashId);
		expect(data?.url).toBe(URL);
		expect(data?.savedAt).toEqual(new Date("2026-05-30T09:00:00.000Z"));
		expect(data?.contentSourceTier).toBe("tier-1");
	});

	it("findArticleByUrl falls back to the epoch savedAt for legacy rows missing the column", async () => {
		const { client } = createFakeClient({
			GetCommand: { default: { Item: articleItem({ savedAt: undefined, content: undefined }) } },
		});

		const data = await initStore(client).findArticleByUrl(URL);

		expect(data?.savedAt).toEqual(new Date(0));
	});

	it("findArticleByUrl returns null when the global row is absent", async () => {
		const { client } = createFakeClient({ GetCommand: { default: { Item: undefined } } });

		const data = await initStore(client).findArticleByUrl(URL);

		expect(data).toBeNull();
	});

	it("readContent returns the legacy content body when present", async () => {
		const { client } = createFakeClient({ GetCommand: { default: { Item: { content: "<p>legacy</p>" } } } });

		const content = await initStore(client).readContent(ArticleResourceUniqueId.parse(URL));

		expect(content).toBe("<p>legacy</p>");
	});

	it("readContent returns undefined when no legacy content row exists", async () => {
		const { client } = createFakeClient({ GetCommand: { default: { Item: undefined } } });

		const content = await initStore(client).readContent(ArticleResourceUniqueId.parse(URL));

		expect(content).toBeUndefined();
	});
});
