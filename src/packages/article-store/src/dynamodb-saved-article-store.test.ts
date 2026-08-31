import assert from "node:assert/strict";
import { z } from "zod";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { SaveProvenance } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initDynamoDbSavedArticleStore } from "./dynamodb-saved-article-store";

const USER = "abc123" as UserId;
const URL = "https://example.com/article";
const RESOURCE_ID = "example.com/article";
const ROUTE_ID = ReaderArticleHashId.from(URL).value;
const TWO_MINUTES = MinutesSchema.parse(2);
const provenance: SaveProvenance = { kind: "client", clientName: "chrome" };

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

type CommandResponse = Record<string, unknown> | (() => Record<string, unknown>);

/** Records every command sent and replays canned responses keyed by command
 * type, so a test can assert the exact UpdateExpression / ConditionExpression /
 * IndexName the store builds. Each command type can be given a FIFO readlist of
 * responses (to drive the store's `do/while` pagination loops over
 * `LastEvaluatedKey`) plus a default for any further calls. A function response
 * is invoked so a test can throw to simulate a failed conditional write. */
function createFakeClient(
	responses: Partial<Record<string, { readlist?: CommandResponse[]; default?: CommandResponse }>> = {},
): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const readlists = new Map<string, CommandResponse[]>();
	for (const [name, spec] of Object.entries(responses)) {
		readlists.set(name, [...(spec?.readlist ?? [])]);
	}
	const resolve = (value: CommandResponse): Record<string, unknown> =>
		typeof value === "function" ? value() : value;
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			const readlist = readlists.get(name);
			if (readlist && readlist.length > 0) return resolve(readlist.shift() as CommandResponse);
			const fallback = responses[name]?.default;
			return fallback ? resolve(fallback) : {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

const BatchGetArticleKeys = z.object({
	RequestItems: z.object({ articles: z.object({ Keys: z.array(z.object({ url: z.string() })) }) }),
});

function queryCommands(commands: CapturedCommand[]): CapturedCommand[] {
	return commands.filter((c) => c.name === "QueryCommand");
}

function countQueries(commands: CapturedCommand[]): CapturedCommand[] {
	return commands.filter((c) => c.input.Select === "COUNT");
}

function batchGetKeys(commands: CapturedCommand[]): { url: string }[] {
	const batchGet = commands.find((c) => c.name === "BatchGetCommand");
	assert(batchGet, "the store must have sent a BatchGetCommand");
	return BatchGetArticleKeys.parse(batchGet.input).RequestItems.articles.Keys;
}

const STORE_NOW = new Date("2026-05-30T12:00:00.000Z");
const OPERATION_SAVED_AT = new Date("2026-05-30T11:30:00.000Z");

function initStore(client: DynamoDBDocumentClient, logger: HutchLogger = HutchLogger.from(noopLogger)) {
	return initDynamoDbSavedArticleStore({
		client,
		tableName: "articles",
		userArticlesTableName: "user-articles",
		logger,
		now: () => STORE_NOW,
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

describe("initDynamoDbSavedArticleStore reader-ready columns", () => {
	it("markArticleViewed stamps viewedAt only on a row that still exists so a delete race cannot resurrect it", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markArticleViewed({ userId: USER, url: URL, at: new Date("2026-05-30T10:00:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toContain("SET viewedAt = :at");
		expect(update?.input.ConditionExpression).toBe("attribute_exists(savedAt)");
		expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":at"]).toBe(
			"2026-05-30T10:00:00.000Z",
		);
	});

	it("markSummaryToggled with state=open overwrites lastSummaryOpenedAt (last-write-wins) on a still-saved row", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markSummaryToggled({ userId: USER, url: URL, state: "open", at: new Date("2026-05-30T10:00:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe("SET lastSummaryOpenedAt = :at");
		expect(update?.input.ConditionExpression).toBe("attribute_exists(savedAt)");
		expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":at"]).toBe(
			"2026-05-30T10:00:00.000Z",
		);
	});

	it("markSummaryToggled with state=closed overwrites lastSummaryClosedAt", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markSummaryToggled({ userId: USER, url: URL, state: "closed", at: new Date("2026-05-30T10:01:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe("SET lastSummaryClosedAt = :at");
	});

	it("markLinkShared stamps sharedAt (last-write-wins) only on a row that still exists", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markLinkShared({ userId: USER, url: URL, at: new Date("2026-05-30T10:03:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe("SET sharedAt = :at");
		expect(update?.input.ConditionExpression).toBe("attribute_exists(savedAt)");
		expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":at"]).toBe(
			"2026-05-30T10:03:00.000Z",
		);
	});

	it("markRelatedDismissed records the suggestion that was waved away, so a later render can tell a snooze from a permanent dismissal", async () => {
		const { client, commands } = createFakeClient();
		const suggestionId = ReaderArticleHashId.fromHash("0123456789abcdef0123456789abcdef");
		await initStore(client).markRelatedDismissed({ userId: USER, url: URL, at: new Date("2026-05-30T10:02:00.000Z"), suggestionId });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe(
			"SET relatedDismissedAt = :at, relatedDismissedSuggestionId = :suggestionId",
		);
		expect(update?.input.ConditionExpression).toBe("attribute_exists(savedAt)");
		expect(update?.input.ExpressionAttributeValues).toEqual({
			":at": "2026-05-30T10:02:00.000Z",
			":suggestionId": suggestionId.value,
		});
	});

	it("markRelatedDismissed clears any previously recorded suggestion when the dismissal names none", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markRelatedDismissed({ userId: USER, url: URL, at: new Date("2026-05-30T10:02:00.000Z"), suggestionId: undefined });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe(
			"SET relatedDismissedAt = :at REMOVE relatedDismissedSuggestionId",
		);
		expect(update?.input.ExpressionAttributeValues).toEqual({
			":at": "2026-05-30T10:02:00.000Z",
		});
	});

	it("mark stamps swallow ConditionalCheckFailedException so a concurrent delete makes the stamp a no-op", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "row deleted" });
				},
			},
		});

		await expect(
			initStore(client).markArticleViewed({ userId: USER, url: URL, at: new Date() }),
		).resolves.toBeUndefined();
	});

	it("mark stamps rethrow non-conditional errors", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new Error("throttled");
				},
			},
		});

		await expect(
			initStore(client).markArticleViewed({ userId: USER, url: URL, at: new Date() }),
		).rejects.toThrow("throttled");
	});

	it("markReaderReadyEmailSent guards on row existence and attribute_not_exists(emailSentAt) so it is set-once and cannot resurrect a deleted row", async () => {
		const { client, commands } = createFakeClient();
		await initStore(client).markReaderReadyEmailSent({ userId: USER, url: URL, at: new Date("2026-05-30T10:05:00.000Z") });

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.ConditionExpression).toBe("attribute_exists(savedAt) AND attribute_not_exists(emailSentAt)");
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
				readlist: [
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

describe("initDynamoDbSavedArticleStore share records (listSharedArticles)", () => {
	const METADATA_PROJECTION =
		"#url, #routeId, #originalUrl, #displayUrl, #title, #siteName, #excerpt, #wordCount, #imageUrl, #estimatedReadTime, #savedAt, #contentSourceTier, #purgedAt, #readerAvailableAt";

	it("queries the savedAt index filtered to shared rows, projects metadata only, and returns newest-shared first", async () => {
		const sharedEarlier = userArticleItem({ url: "a", sharedAt: "2026-05-30T10:00:00.000Z" });
		const sharedLater = userArticleItem({ url: "b", sharedAt: "2026-05-30T11:00:00.000Z" });
		const articleA = articleItem({ url: "a", originalUrl: "https://example.com/a", routeId: ReaderArticleHashId.from("https://example.com/a").value });
		const articleB = articleItem({ url: "b", originalUrl: "https://example.com/b", routeId: ReaderArticleHashId.from("https://example.com/b").value });
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [sharedEarlier, sharedLater], Count: 2 } },
			BatchGetCommand: { default: { Responses: { articles: [articleA, articleB] } } },
		});

		const result = await initStore(client).listSharedArticles({ userId: USER });

		const query = commands.find((c) => c.name === "QueryCommand");
		expect(query?.input.IndexName).toBe("userId-savedAt-index");
		expect(query?.input.FilterExpression).toBe("attribute_exists(sharedAt)");
		expect((query?.input.ExpressionAttributeValues as Record<string, unknown>)[":userId"]).toBe(USER);

		const batch = commands.find((c) => c.name === "BatchGetCommand");
		const requestItems = batch?.input.RequestItems as Record<string, { ProjectionExpression?: string }>;
		expect(requestItems.articles.ProjectionExpression).toBe(METADATA_PROJECTION);

		expect(result.map((a) => a.url)).toEqual(["https://example.com/b", "https://example.com/a"]);
		expect(result[0]?.sharedAt).toEqual(new Date("2026-05-30T11:00:00.000Z"));
	});

	it("returns an empty list when the user has shared nothing", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [], Count: 0 } },
		});

		const result = await initStore(client).listSharedArticles({ userId: USER });

		expect(result).toEqual([]);
	});

	it("skips a shared row whose article metadata is missing so a half-deleted row cannot crash the list", async () => {
		const shared = userArticleItem({ url: "a", sharedAt: "2026-05-30T10:00:00.000Z" });
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [shared], Count: 1 } },
			BatchGetCommand: { default: { Responses: { articles: [] } } },
		});

		const result = await initStore(client).listSharedArticles({ userId: USER });

		expect(result).toEqual([]);
	});
});

describe("initDynamoDbSavedArticleStore global writes", () => {
	it("saveArticleGlobally reports created=true on a fresh conditional put", async () => {
		const { client, commands } = createFakeClient();
		const result = await initStore(client).saveArticleGlobally({
			url: URL,
			metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1, imageUrl: "https://x/i.jpg" },
			estimatedReadTime: TWO_MINUTES,
			savedAt: new Date("2026-05-30T09:00:00.000Z"),
		});

		const put = commands.find((c) => c.name === "PutCommand");
		// The put succeeds on an absent row OR a tombstoned one, so re-saving a
		// purged URL revives it (the full put drops purgedAt); a live row still
		// fails the condition and stays a no-op upsert.
		expect(put?.input.ConditionExpression).toBe("attribute_not_exists(#url) OR attribute_exists(purgedAt)");
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
				readlist: [{ Item: articleItem() }, { Item: userArticleItem({ readAt: "2026-05-30T11:00:00.000Z", status: "read" }) }],
			},
		});

		const { saved, createdUserArticle } = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250, imageUrl: "https://example.com/image.jpg" },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		expect(commands.some((c) => c.name === "PutCommand")).toBe(true);
		// Read-back-after-write must be strongly consistent, otherwise an
		// eventually-consistent miss trips the "must exist immediately after save"
		// asserts and 500s a healthy save (the readplace save-failure RCA).
		const reads = commands.filter((c) => c.name === "GetCommand");
		expect(reads).toHaveLength(2);
		expect(reads.every((c) => c.input.ConsistentRead === true)).toBe(true);
		expect(saved.id).toBeInstanceOf(ReaderArticleHashId);
		expect(saved.url).toBe(URL);
		expect(saved.status).toBe("read");
		expect(saved.readAt).toEqual(new Date("2026-05-30T11:00:00.000Z"));
		expect(createdUserArticle).toBe(true);
	});

	it("saveArticle stamps provenance on the user row and reads it back onto the saved article", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem({ provenance }) }],
			},
		});

		const { saved } = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		const userRowUpdate = commands.find(
			(c) => c.name === "UpdateCommand" && c.input.ReturnValues === "ALL_OLD",
		);
		expect(userRowUpdate?.input.UpdateExpression).toBe(
			"SET savedAt = :savedAt, provenance = :provenance, #status = if_not_exists(#status, :unread)",
		);
		expect(
			(userRowUpdate?.input.ExpressionAttributeValues as Record<string, unknown>)[":provenance"],
		).toEqual(provenance);
		expect(saved.provenance).toEqual(provenance);
	});

	it("reads a row saved before provenance was captured without one, so the reader can leave the tag off", async () => {
		const { client } = createFakeClient({
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		const { saved } = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		expect(saved.provenance).toBeUndefined();
	});

	it("saveArticle reports the user row as created when the update returned no prior item", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		const { createdUserArticle } = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		const userRowUpdate = commands.find(
			(c) => c.name === "UpdateCommand" && c.input.UpdateExpression !== "SET savedAt = :savedAt",
		);
		expect(userRowUpdate?.input.ReturnValues).toBe("ALL_OLD");
		expect(createdUserArticle).toBe(true);
	});

	it("saveArticle reports the user row as pre-existing when the update returned the prior item", async () => {
		const { client } = createFakeClient({
			UpdateCommand: { default: { Attributes: userArticleItem() } },
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		const { createdUserArticle } = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		expect(createdUserArticle).toBe(false);
	});

	it("saveArticle bumps savedAt when the global row already exists", async () => {
		const { client, commands } = createFakeClient({
			PutCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
				},
			},
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		const { saved } = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250, imageUrl: "https://example.com/image.jpg" },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		const bump = commands.find((c) => c.name === "UpdateCommand" && c.input.UpdateExpression === "SET savedAt = :savedAt");
		expect(bump).toBeDefined();
		expect(saved.readAt).toBeUndefined();
	});

	it("saveArticle stamps the user row with the caller's savedAt and the global row with its own clock", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		const globalPut = commands.find((c) => c.name === "PutCommand");
		assert(globalPut, "the store must put the global article row");
		expect((globalPut.input.Item as Record<string, unknown>).savedAt).toBe(STORE_NOW.toISOString());
		const userRowUpdate = commands.find(
			(c) => c.name === "UpdateCommand" && c.input.ReturnValues === "ALL_OLD",
		);
		assert(userRowUpdate, "the store must update the user row");
		expect(
			(userRowUpdate.input.ExpressionAttributeValues as Record<string, unknown>)[":savedAt"],
		).toBe(OPERATION_SAVED_AT.toISOString());
	});

	it("saveArticle only overwrites a user row whose savedAt is older, so a slow save cannot demote a newer one", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		const userRowUpdate = commands.find(
			(c) => c.name === "UpdateCommand" && c.input.ReturnValues === "ALL_OLD",
		);
		assert(userRowUpdate, "the store must update the user row");
		expect(userRowUpdate.input.ConditionExpression).toBe(
			"attribute_not_exists(savedAt) OR savedAt < :savedAt",
		);
	});

	it("saveArticle treats a lost savedAt race as pre-existing and returns the newer row it read back", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "newer save won" });
				},
			},
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem({ savedAt: "2026-05-30T11:45:00.000Z" }) }],
			},
		});

		const { saved, createdUserArticle } = await initStore(client).saveArticle({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		expect(createdUserArticle).toBe(false);
		expect(saved.savedAt).toEqual(new Date("2026-05-30T11:45:00.000Z"));
	});

	it("saveArticle reports whether the user-row write applied, so a losing save never flips the winner's status", async () => {
		const winning = createFakeClient({
			GetCommand: { readlist: [{ Item: articleItem() }, { Item: userArticleItem() }] },
		});
		const losing = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "newer save won" });
				},
			},
			GetCommand: { readlist: [{ Item: articleItem() }, { Item: userArticleItem() }] },
		});
		const params = {
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		};

		const won = await initStore(winning.client).saveArticle(params);
		const lost = await initStore(losing.client).saveArticle(params);

		expect(won.wroteUserArticle).toBe(true);
		expect(lost.wroteUserArticle).toBe(false);
	});

	it("allocateSavedAt advances the per-user cursor to wall clock with a compare-and-set the fast path", async () => {
		const { client, commands } = createFakeClient();

		const allocated = await initStore(client).allocateSavedAt({ userId: USER });

		expect(allocated).toEqual(STORE_NOW);
		const cas = commands.find((c) => c.name === "UpdateCommand");
		assert(cas, "the allocator must write the cursor row");
		expect(cas.input.Key).toEqual({ userId: USER, url: `readplace:save-cursor/${USER}` });
		expect(cas.input.UpdateExpression).toBe("SET savedAtCursorMs = :endMs");
		expect(cas.input.ConditionExpression).toBe(
			"attribute_not_exists(savedAtCursorMs) OR savedAtCursorMs < :nowMs",
		);
		expect(cas.input.ExpressionAttributeValues).toEqual({
			":endMs": STORE_NOW.getTime(),
			":nowMs": STORE_NOW.getTime(),
		});
		expect(cas.input.ReturnValues).toBe("UPDATED_NEW");
	});

	it("allocateSavedAt increments past a cursor at or ahead of wall clock, so same-millisecond saves stay distinct", async () => {
		const cursorAheadMs = STORE_NOW.getTime() + 5;
		let updates = 0;
		const { client, commands } = createFakeClient({
			UpdateCommand: {
				readlist: [
					() => {
						updates += 1;
						throw new ConditionalCheckFailedException({ $metadata: {}, message: "cursor ahead" });
					},
					() => {
						updates += 1;
						return { Attributes: { savedAtCursorMs: cursorAheadMs + 1 } };
					},
				],
			},
		});

		const allocated = await initStore(client).allocateSavedAt({ userId: USER });

		expect(updates).toBe(2);
		expect(allocated).toEqual(new Date(cursorAheadMs + 1));
		const increment = commands[1];
		expect(increment.input.UpdateExpression).toBe("ADD savedAtCursorMs :count");
		expect(increment.input.ConditionExpression).toBe("attribute_exists(savedAtCursorMs)");
		expect(increment.input.ExpressionAttributeValues).toEqual({ ":count": 1 });
	});

	it("allocateSavedAt re-seeds from wall clock when the sentinel vanished between the two writes", async () => {
		const ccfe = () => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "gone" });
		};
		const { client, commands } = createFakeClient({
			UpdateCommand: { readlist: [ccfe, ccfe, {}] },
		});

		const allocated = await initStore(client).allocateSavedAt({ userId: USER });

		expect(allocated).toEqual(STORE_NOW);
		expect(commands.filter((c) => c.name === "UpdateCommand")).toHaveLength(3);
		expect(commands[2].input.UpdateExpression).toBe("SET savedAtCursorMs = :endMs");
	});

	it("allocateSavedAtSequence claims a wall-clock span in one compare-and-set and returns ascending instants", async () => {
		const { client, commands } = createFakeClient();

		const allocated = await initStore(client).allocateSavedAtSequence({ userId: USER, count: 3 });

		expect(allocated).toEqual([
			STORE_NOW,
			new Date(STORE_NOW.getTime() + 1),
			new Date(STORE_NOW.getTime() + 2),
		]);
		const cas = commands.find((c) => c.name === "UpdateCommand");
		assert(cas, "the allocator must write the cursor row");
		expect(cas.input.UpdateExpression).toBe("SET savedAtCursorMs = :endMs");
		expect(cas.input.ExpressionAttributeValues).toEqual({
			":endMs": STORE_NOW.getTime() + 2,
			":nowMs": STORE_NOW.getTime(),
		});
	});

	it("allocateSavedAtSequence advances a cursor already ahead of wall clock in one atomic step, returning the trailing span", async () => {
		const cursorAheadMs = STORE_NOW.getTime() + 5;
		const { client, commands } = createFakeClient({
			UpdateCommand: {
				readlist: [
					() => {
						throw new ConditionalCheckFailedException({ $metadata: {}, message: "cursor ahead" });
					},
					{ Attributes: { savedAtCursorMs: cursorAheadMs + 3 } },
				],
			},
		});

		const allocated = await initStore(client).allocateSavedAtSequence({ userId: USER, count: 3 });

		expect(allocated).toEqual([
			new Date(cursorAheadMs + 1),
			new Date(cursorAheadMs + 2),
			new Date(cursorAheadMs + 3),
		]);
		expect(commands[1].input.UpdateExpression).toBe("ADD savedAtCursorMs :count");
		expect(commands[1].input.ExpressionAttributeValues).toEqual({ ":count": 3 });
	});

	it("allocateSavedAtSequence re-seeds the span from wall clock when the sentinel vanished between the two writes", async () => {
		const ccfe = () => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "gone" });
		};
		const { client, commands } = createFakeClient({
			UpdateCommand: { readlist: [ccfe, ccfe, {}] },
		});

		const allocated = await initStore(client).allocateSavedAtSequence({ userId: USER, count: 2 });

		expect(allocated).toEqual([STORE_NOW, new Date(STORE_NOW.getTime() + 1)]);
		expect(commands.filter((c) => c.name === "UpdateCommand")).toHaveLength(3);
		expect(commands[2].input.ExpressionAttributeValues).toEqual({
			":endMs": STORE_NOW.getTime() + 1,
			":nowMs": STORE_NOW.getTime(),
		});
	});

	it("findSavedUrls reports back only the URLs the user already has, keyed on the resource id", async () => {
		const { client, commands } = createFakeClient({
			BatchGetCommand: {
				default: { Responses: { "user-articles": [userArticleItem()] } },
			},
		});

		const saved = await initStore(client).findSavedUrls({
			userId: USER,
			urls: [URL, "https://example.com/never-saved"],
		});

		expect(saved).toEqual([URL]);
		const batchGet = commands.find((c) => c.name === "BatchGetCommand");
		assert(batchGet, "the store must have sent a BatchGetCommand");
		expect(batchGet.input).toEqual({
			RequestItems: {
				"user-articles": {
					Keys: [
						{ userId: USER, url: RESOURCE_ID },
						{ userId: USER, url: "example.com/never-saved" },
					],
					ProjectionExpression: "#url",
					ExpressionAttributeNames: { "#url": "url" },
				},
			},
		});
	});

	it("findSavedUrls collapses URLs that share one resource id, which DynamoDB rejects as duplicate keys", async () => {
		const { client, commands } = createFakeClient({
			BatchGetCommand: {
				default: { Responses: { "user-articles": [userArticleItem()] } },
			},
		});

		const saved = await initStore(client).findSavedUrls({
			userId: USER,
			urls: [URL, `${URL}#section`],
		});

		expect(saved).toEqual([URL, `${URL}#section`]);
		const batchGet = commands.find((c) => c.name === "BatchGetCommand");
		assert(batchGet, "the store must have sent a BatchGetCommand");
		expect(batchGet.input).toEqual({
			RequestItems: {
				"user-articles": {
					Keys: [{ userId: USER, url: RESOURCE_ID }],
					ProjectionExpression: "#url",
					ExpressionAttributeNames: { "#url": "url" },
				},
			},
		});
	});

	it("allocateSavedAt rethrows a non-conditional error from either cursor write", async () => {
		const throttled = () => {
			throw new Error("throttled");
		};
		const first = createFakeClient({ UpdateCommand: { readlist: [throttled] } });
		await expect(initStore(first.client).allocateSavedAt({ userId: USER })).rejects.toThrow("throttled");

		const ccfe = () => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "cursor ahead" });
		};
		const second = createFakeClient({ UpdateCommand: { readlist: [ccfe, throttled] } });
		await expect(initStore(second.client).allocateSavedAt({ userId: USER })).rejects.toThrow("throttled");
	});

	it("saveArticleKeepingPosition only writes the user row when it does not exist yet, so a content upload never repositions", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		await initStore(client).saveArticleKeepingPosition({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		const userRowUpdate = commands.find(
			(c) => c.name === "UpdateCommand" && c.input.ReturnValues === "ALL_OLD",
		);
		assert(userRowUpdate, "the store must attempt the user-row write");
		expect(userRowUpdate.input.ConditionExpression).toBe("attribute_not_exists(savedAt)");
	});

	it("saveArticleKeepingPosition reports an existing row untouched and returns it as read back", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "row exists" });
				},
			},
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem({ savedAt: "2026-05-30T08:00:00.000Z", status: "read" }) }],
			},
		});

		const { saved, createdUserArticle, wroteUserArticle } = await initStore(client).saveArticleKeepingPosition({
			userId: USER,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		expect(createdUserArticle).toBe(false);
		expect(wroteUserArticle).toBe(false);
		expect(saved.savedAt).toEqual(new Date("2026-05-30T08:00:00.000Z"));
		expect(saved.status).toBe("read");
	});

	it("saveArticle rethrows a non-conditional user-row write error", async () => {
		const { client } = createFakeClient({
			UpdateCommand: {
				default: () => {
					throw new Error("throttled");
				},
			},
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem() }],
			},
		});

		await expect(
			initStore(client).saveArticle({
				userId: USER,
				url: URL,
				metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
				estimatedReadTime: TWO_MINUTES,
				provenance,
				savedAt: OPERATION_SAVED_AT,
			}),
		).rejects.toThrow("throttled");
	});
});

describe("initDynamoDbSavedArticleStore reads by id", () => {
	it("findArticleById joins the global row with the user row", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: userArticleItem() } },
		});

		const article = await initStore(client).findArticleById(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		expect(article?.url).toBe(URL);
		expect(article?.status).toBe("unread");
	});

	it("findArticleById surfaces the stored dismissal pin, so a dismissal keeps its snooze-or-permanent meaning after a round trip", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: {
				default: {
					Item: userArticleItem({
						relatedDismissedAt: "2026-05-30T10:02:00.000Z",
						relatedDismissedSuggestionId: "0123456789abcdef0123456789abcdef",
					}),
				},
			},
		});

		const article = await initStore(client).findArticleById(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		assert(article);
		expect({
			at: article.relatedDismissedAt,
			suggestion: article.relatedDismissedSuggestionId?.value,
		}).toEqual({
			at: new Date("2026-05-30T10:02:00.000Z"),
			suggestion: "0123456789abcdef0123456789abcdef",
		});
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

describe("initDynamoDbSavedArticleStore findArticlesByUser", () => {
	it("uses the savedAt index with no filter by default and joins each user row to its article", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 1 },
					{ Items: [userArticleItem()], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem()] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER, includeTotal: true });

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
				readlist: [
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

		const pageQuery = commands.find((c) => c.name === "QueryCommand");
		expect(pageQuery?.input.IndexName).toBe("userId-readAt-index");
		expect(pageQuery?.input.FilterExpression).toBe("#status = :status");
		expect((pageQuery?.input.ExpressionAttributeValues as Record<string, unknown>)[":status"]).toBe("read");
		expect(pageQuery?.input.ScanIndexForward).toBe(true);
		expect(result.articles[0]?.readAt).toEqual(new Date("2026-05-30T11:00:00.000Z"));
	});

	it("passes a metadata-only projection to BatchGet when excludeContent is set", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [{ Items: [userArticleItem()], Count: 1 }],
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem({ content: undefined })] } } },
		});

		await initStore(client).findArticlesByUser({ userId: USER, excludeContent: true });

		const batch = commands.find((c) => c.name === "BatchGetCommand");
		const requestItems = batch?.input.RequestItems as Record<string, { ProjectionExpression?: string }>;
		expect(requestItems.articles.ProjectionExpression).toBe(
			"#url, #routeId, #originalUrl, #displayUrl, #title, #siteName, #excerpt, #wordCount, #imageUrl, #estimatedReadTime, #savedAt, #contentSourceTier, #purgedAt, #readerAvailableAt",
		);
	});

	it("sums COUNT pages and walks item pages, skipping earlier pages to reach the requested page", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 1, LastEvaluatedKey: { url: "p1" } },
					{ Items: [], Count: 2 },
					{ Items: [userArticleItem({ url: "a" })], Count: 1, LastEvaluatedKey: { url: "a" } },
					{ Items: [userArticleItem({ url: "b" })], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem({ url: "b", originalUrl: "https://example.com/b" })] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER, page: 2, pageSize: 1, includeTotal: true });

		expect(commands.filter((c) => c.name === "QueryCommand")).toHaveLength(4);
		expect(result.total).toBe(3);
		expect(result.articles).toHaveLength(1);
		expect(result.articles[0]?.url).toBe("https://example.com/b");
	});

	it("returns an empty page when no user rows match", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 0 },
					{ Items: [], Count: 0 },
				],
			},
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER, includeTotal: true });

		expect(commands.some((c) => c.name === "BatchGetCommand")).toBe(false);
		expect(result).toEqual({ articles: [], total: 0, hasMore: false, page: 1, pageSize: 20 });
	});

	it("drops a user row whose article was deleted from the global table between query and batch-get", async () => {
		const { client } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 1 },
					{ Items: [userArticleItem({ url: "orphan" })], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER, includeTotal: true });

		expect(result.total).toBe(1);
		expect(result.articles).toEqual([]);
	});

	it("issues no COUNT query and leaves total undefined when includeTotal is not requested", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { readlist: [{ Items: [userArticleItem()], Count: 1 }] },
			BatchGetCommand: { default: { Responses: { articles: [articleItem()] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER });

		expect(countQueries(commands)).toHaveLength(0);
		expect(result.total).toBeUndefined();
		expect(result.articles).toHaveLength(1);
	});

	it("sums every COUNT page into total when includeTotal is requested", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 4, LastEvaluatedKey: { url: "p1" } },
					{ Items: [], Count: 3 },
					{ Items: [userArticleItem()], Count: 1 },
				],
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem()] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER, includeTotal: true });

		const counts = countQueries(commands);
		expect(counts).toHaveLength(2);
		expect(counts[1]?.input.ExclusiveStartKey).toEqual({ url: "p1" });
		expect(result.total).toBe(7);
		expect(result.articles).toHaveLength(1);
	});

	it("reports hasMore and truncates to the page when a row exists beyond it, in a single query", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [{ Items: [userArticleItem({ url: "a" }), userArticleItem({ url: "b" })], Count: 2 }],
			},
			BatchGetCommand: {
				default: { Responses: { articles: [articleItem({ url: "a", originalUrl: "https://example.com/a" })] } },
			},
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER, pageSize: 1 });

		const queries = queryCommands(commands);
		expect(queries).toHaveLength(1);
		expect(queries[0]?.input.Limit).toBe(2);
		expect(batchGetKeys(commands)).toEqual([{ url: "a" }]);
		expect(result.hasMore).toBe(true);
		expect(result.articles).toHaveLength(1);
		expect(result.articles[0]?.url).toBe("https://example.com/a");
	});

	it("asks for one row beyond the default page size so a full page needs no second query", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { readlist: [{ Items: [userArticleItem()], Count: 1 }] },
			BatchGetCommand: { default: { Responses: { articles: [articleItem()] } } },
		});

		await initStore(client).findArticlesByUser({ userId: USER });

		const queries = queryCommands(commands);
		expect(queries).toHaveLength(1);
		expect(queries[0]?.input.Limit).toBe(21);
	});

	it("reports hasMore false on the last page", async () => {
		const { client } = createFakeClient({
			QueryCommand: { readlist: [{ Items: [userArticleItem()], Count: 1 }] },
			BatchGetCommand: { default: { Responses: { articles: [articleItem()] } } },
		});

		const result = await initStore(client).findArticlesByUser({ userId: USER, pageSize: 1 });

		expect(result.hasMore).toBe(false);
		expect(result.articles).toHaveLength(1);
	});
});

describe("initDynamoDbSavedArticleStore countArticlesByUser", () => {
	it("sums COUNT pages without fetching rows", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 5, LastEvaluatedKey: { url: "p1" } },
					{ Items: [], Count: 3 },
				],
			},
		});

		const total = await initStore(client).countArticlesByUser({ userId: USER });

		expect(countQueries(commands)).toHaveLength(2);
		expect(queryCommands(commands)).toHaveLength(2);
		expect(total).toBe(8);
	});

	it("applies a status FilterExpression when counting by status", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { readlist: [{ Items: [], Count: 2 }] },
		});

		const total = await initStore(client).countArticlesByUser({ userId: USER, status: "unread" });

		const query = commands.find((c) => c.name === "QueryCommand");
		expect(query?.input.FilterExpression).toBe("#status = :status");
		expect(total).toBe(2);
	});

	it("stops paging once countLimit rows have been counted", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 5, LastEvaluatedKey: { url: "p1" } },
					{ Items: [], Count: 3 },
				],
			},
		});

		const total = await initStore(client).countArticlesByUser({ userId: USER, countLimit: 5 });

		expect(queryCommands(commands)).toHaveLength(1);
		expect(total).toBe(5);
	});

	it("keeps paging while the count is still short of countLimit", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 2, LastEvaluatedKey: { url: "p1" } },
					{ Items: [], Count: 1, LastEvaluatedKey: { url: "p2" } },
					{ Items: [], Count: 1 },
				],
			},
		});

		const total = await initStore(client).countArticlesByUser({ userId: USER, countLimit: 5 });

		expect(queryCommands(commands)).toHaveLength(3);
		expect(total).toBe(4);
	});

	it("clamps the reported total to countLimit when the last page overshoots it", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 3, LastEvaluatedKey: { url: "p1" } },
					{ Items: [], Count: 4, LastEvaluatedKey: { url: "p2" } },
				],
			},
		});

		const total = await initStore(client).countArticlesByUser({ userId: USER, countLimit: 5 });

		expect(queryCommands(commands)).toHaveLength(2);
		expect(total).toBe(5);
	});
});

describe("initDynamoDbSavedArticleStore deleteArticle", () => {
	it("deletes the user row and reports success", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
		});

		const deleted = await initStore(client).deleteArticle(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		const del = commands.find((c) => c.name === "DeleteCommand");
		expect(del?.input.ConditionExpression).toBe("attribute_exists(savedAt)");
		expect(commands.some((c) => c.name === "GetCommand")).toBe(false);
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
			DeleteCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "row deleted" });
				},
			},
		});

		const deleted = await initStore(client).deleteArticle(ReaderArticleHashId.fromHash(ROUTE_ID), USER);

		expect(deleted).toBe(false);
	});

	it("rethrows non-conditional errors", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			DeleteCommand: {
				default: () => {
					throw new Error("throttled");
				},
			},
		});

		await expect(
			initStore(client).deleteArticle(ReaderArticleHashId.fromHash(ROUTE_ID), USER),
		).rejects.toThrow("throttled");
	});
});

describe("initDynamoDbSavedArticleStore deleteAllUserArticles", () => {
	it("pages the userId-savedAt-index and deletes every userArticles row by its (userId, url) key across pages", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [userArticleItem({ url: "a" })], Count: 1, LastEvaluatedKey: { userId: USER, url: "a" } },
					{ Items: [userArticleItem({ url: "b" })], Count: 1 },
				],
			},
		});

		await initStore(client).deleteAllUserArticles(USER);

		const queries = commands.filter((c) => c.name === "QueryCommand");
		expect(queries).toHaveLength(3);
		expect(queries[0]?.input.IndexName).toBe("userId-savedAt-index");
		expect(queries[0]?.input.KeyConditionExpression).toBe("userId = :userId");
		expect((queries[0]?.input.ExpressionAttributeValues as Record<string, unknown>)[":userId"]).toBe(USER);
		expect(queries[1]?.input.ExclusiveStartKey).toEqual({ userId: USER, url: "a" });
		expect(queries[2]?.input.KeyConditionExpression).toBe(
			"userId = :userId AND begins_with(#url, :prefix)",
		);

		const deletes = commands.filter((c) => c.name === "DeleteCommand");
		expect(deletes.map((d) => d.input.Key)).toEqual([
			{ userId: USER, url: "a" },
			{ userId: USER, url: "b" },
			{ userId: USER, url: `readplace:save-cursor/${USER}` },
		]);
	});

	it("still deletes the cursor sentinel when the user has no saved rows", async () => {
		const { client, commands } = createFakeClient({ QueryCommand: { default: { Items: [], Count: 0 } } });

		await initStore(client).deleteAllUserArticles(USER);

		const deletes = commands.filter((c) => c.name === "DeleteCommand");
		expect(deletes.map((d) => d.input.Key)).toEqual([
			{ userId: USER, url: `readplace:save-cursor/${USER}` },
		]);
	});
});

describe("initDynamoDbSavedArticleStore listUserArticleUrls", () => {
	it("pages the user's rows and resolves each to its global original URL via a batch get", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [userArticleItem({ url: "example.com/one" })], Count: 1, LastEvaluatedKey: { userId: USER, url: "example.com/one" } },
					{ Items: [userArticleItem({ url: "example.com/two" })], Count: 1 },
				],
			},
			BatchGetCommand: {
				default: {
					Responses: {
						articles: [
							{ originalUrl: "https://example.com/one" },
							{ originalUrl: "https://example.com/two" },
						],
					},
				},
			},
		});

		const urls = await initStore(client).listUserArticleUrls(USER);

		expect(urls.sort()).toEqual(["https://example.com/one", "https://example.com/two"]);
		const query = commands.find((c) => c.name === "QueryCommand");
		expect(query?.input.IndexName).toBe("userId-savedAt-index");
		const batchGet = commands.find((c) => c.name === "BatchGetCommand");
		const requested = (batchGet?.input.RequestItems as Record<string, { Keys: { url: string }[] }>)
			.articles.Keys;
		expect(requested).toEqual([{ url: "example.com/one" }, { url: "example.com/two" }]);
	});

	it("returns an empty list (and issues no batch get) when the user has no saved rows", async () => {
		const { client, commands } = createFakeClient({ QueryCommand: { default: { Items: [], Count: 0 } } });

		expect(await initStore(client).listUserArticleUrls(USER)).toEqual([]);
		expect(commands.some((c) => c.name === "BatchGetCommand")).toBe(false);
	});

	it("skips a normalized row whose global original URL is missing (legacy row)", async () => {
		const { client } = createFakeClient({
			QueryCommand: {
				readlist: [{ Items: [userArticleItem({ url: "example.com/legacy" })], Count: 1 }],
			},
			BatchGetCommand: { default: { Responses: { articles: [{}] } } },
		});

		expect(await initStore(client).listUserArticleUrls(USER)).toEqual([]);
	});
});

describe("initDynamoDbSavedArticleStore updateArticleStatus", () => {
	it("stamps readAt when marking an article read and answers with the row it wrote", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			UpdateCommand: {
				default: {
					Attributes: userArticleItem({ status: "read", readAt: "2026-05-30T12:00:00.000Z" }),
				},
			},
		});

		const updated = await initStore(client).updateArticleStatus(ReaderArticleHashId.fromHash(ROUTE_ID), USER, "read");

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe("SET #status = :status, readAt = :readAt");
		expect(update?.input.ConditionExpression).toBe("attribute_exists(savedAt)");
		expect(update?.input.ReturnValues).toBe("ALL_NEW");
		expect(commands.some((c) => c.name === "GetCommand")).toBe(false);
		expect(updated).toMatchObject({ status: "read", readAt: new Date("2026-05-30T12:00:00.000Z") });
	});

	it("removes readAt when marking an article unread and answers with the cleared row", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			UpdateCommand: { default: { Attributes: userArticleItem({ status: "unread" }) } },
		});

		const updated = await initStore(client).updateArticleStatus(
			ReaderArticleHashId.fromHash(ROUTE_ID),
			USER,
			"unread",
		);

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.UpdateExpression).toBe("SET #status = :status REMOVE readAt");
		expect(updated).toMatchObject({ status: "unread" });
		expect(updated?.readAt).toBeUndefined();
	});

	it("reports null when the article does not exist", async () => {
		const { client } = createFakeClient({ QueryCommand: { default: { Items: [], Count: 0 } } });

		const updated = await initStore(client).updateArticleStatus(ReaderArticleHashId.fromHash(ROUTE_ID), USER, "read");

		expect(updated).toBeNull();
	});

	it("reports null when the user never saved the article", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			UpdateCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "row deleted" });
				},
			},
		});

		const updated = await initStore(client).updateArticleStatus(ReaderArticleHashId.fromHash(ROUTE_ID), USER, "read");

		expect(updated).toBeNull();
	});

	it("rethrows non-conditional errors", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			UpdateCommand: {
				default: () => {
					throw new Error("throttled");
				},
			},
		});

		await expect(
			initStore(client).updateArticleStatus(ReaderArticleHashId.fromHash(ROUTE_ID), USER, "read"),
		).rejects.toThrow("throttled");
	});
});

describe("initDynamoDbSavedArticleStore freshness, notification state, content and url lookup", () => {
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

	it("findArticleCrawlVersions maps the stored minute-id log to crawl versions, newest first", async () => {
		const { client } = createFakeClient({
			GetCommand: {
				default: {
					Item: { crawlVersions: ["2026-07-10T09:41Z", "2026-06-28T22:01Z", "2026-03-26T14:32Z"] },
				},
			},
		});

		const versions = await initStore(client).findArticleCrawlVersions(URL);

		expect(versions).toEqual([
			{ crawledAtMinute: "2026-07-10T09:41Z" },
			{ crawledAtMinute: "2026-06-28T22:01Z" },
			{ crawledAtMinute: "2026-03-26T14:32Z" },
		]);
	});

	it("findArticleCrawlVersions carries each attributed entry's author through a mixed legacy/attributed log", async () => {
		const { client } = createFakeClient({
			GetCommand: {
				default: {
					Item: {
						crawlVersions: [
							{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" },
							{ minuteId: "2026-06-28T22:01Z" },
							"2026-03-26T14:32Z",
						],
					},
				},
			},
		});

		const versions = await initStore(client).findArticleCrawlVersions(URL);

		expect(versions).toEqual([
			{ crawledAtMinute: "2026-07-10T09:41Z", authorUserId: "user-1" },
			{ crawledAtMinute: "2026-06-28T22:01Z" },
			{ crawledAtMinute: "2026-03-26T14:32Z" },
		]);
	});

	it("findArticleCrawlVersions returns an empty list for a pre-feature row with no log", async () => {
		const { client } = createFakeClient({ GetCommand: { default: { Item: undefined } } });

		const versions = await initStore(client).findArticleCrawlVersions(URL);

		expect(versions).toEqual([]);
	});

	it("findUserArticleNotificationState hydrates every timestamp the gate reads", async () => {
		const { client } = createFakeClient({
			GetCommand: {
				default: {
					Item: userArticleItem({
						status: "read",
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

	it("findArticleByUrl hydrates readerAvailableAt, the instant the digest gate measures presence against", async () => {
		const { client } = createFakeClient({
			GetCommand: {
				default: { Item: articleItem({ readerAvailableAt: "2026-05-30T09:02:00.000Z", content: undefined }) },
			},
		});

		const data = await initStore(client).findArticleByUrl(URL);

		expect(data?.readerAvailableAt).toEqual(new Date("2026-05-30T09:02:00.000Z"));
	});

	it("findArticleByUrl leaves readerAvailableAt undefined on a row that never recorded one", async () => {
		const { client } = createFakeClient({
			GetCommand: { default: { Item: articleItem({ content: undefined }) } },
		});

		const data = await initStore(client).findArticleByUrl(URL);

		expect(data?.readerAvailableAt).toBeUndefined();
	});

	it("findArticleByUrl surfaces the redirect destination for a merged row", async () => {
		const { client } = createFakeClient({
			GetCommand: { default: { Item: articleItem({ displayUrl: "https://example.com/dest", content: undefined }) } },
		});

		const data = await initStore(client).findArticleByUrl(URL);

		expect(data?.displayUrl).toBe("https://example.com/dest");
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

	it("findArticleByUrl reads a row missing both reader identity columns as absent and warns, instead of throwing (the canonical stub a crawl re-key creates has no routeId/originalUrl)", async () => {
		const { client } = createFakeClient({
			GetCommand: {
				default: { Item: articleItem({ routeId: undefined, originalUrl: undefined, savedAt: undefined, content: undefined }) },
			},
		});
		const warnings: unknown[] = [];
		const store = initStore(client, { ...noopLogger, warn: (...args: unknown[]) => warnings.push(args[0]) });

		const data = await store.findArticleByUrl(URL);

		expect(data).toBeNull();
		expect(warnings).toEqual([
			`[article-store] article row "${RESOURCE_ID}" is missing reader identity columns (routeId/originalUrl); treating it as not found`,
		]);
	});

	it("findArticleByUrl reads a row that has a routeId but no originalUrl as absent", async () => {
		const { client } = createFakeClient({
			GetCommand: { default: { Item: articleItem({ originalUrl: undefined, content: undefined }) } },
		});

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

const WORK = ReadlistSlugSchema.parse("work");
const WORK_PARTITION = `${USER}#queue/work`;
const LATER = ReadlistSlugSchema.parse("later");
const LATER_PARTITION = `${USER}#queue/later`;

function queueDefinitionItem(slug = "work"): Record<string, unknown> {
	return { userId: USER, url: `readplace:queue-def/${slug}`, queueSlug: slug };
}

describe("initDynamoDbSavedArticleStore readlist-scoped writes", () => {
	it("saveReadlistArticle keys the copy on the readlist partition and answers with the base user id", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: {
				readlist: [{ Item: articleItem() }, { Item: userArticleItem({ userId: WORK_PARTITION }) }],
			},
		});

		const { saved } = await initStore(client).saveReadlistArticle({
			userId: USER,
			readlist: WORK,
			url: URL,
			metadata: { title: "Title", siteName: "Example", excerpt: "Excerpt", wordCount: 250 },
			estimatedReadTime: TWO_MINUTES,
			provenance,
			savedAt: OPERATION_SAVED_AT,
		});

		const userRowUpdate = commands.find(
			(c) => c.name === "UpdateCommand" && c.input.ReturnValues === "ALL_OLD",
		);
		expect(userRowUpdate?.input.Key).toEqual({ userId: WORK_PARTITION, url: RESOURCE_ID });
		expect(userRowUpdate?.input.ConditionExpression).toBe(
			"attribute_not_exists(savedAt) OR savedAt < :savedAt",
		);
		expect(saved.userId).toBe(USER);
	});

	it("updateArticleStatusAcrossReadlists writes the addressed copy and every other copy of the same URL", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [articleItem()], Count: 1 },
					{ Items: [queueDefinitionItem()], Count: 1 },
				],
				default: { Items: [articleItem()], Count: 1 },
			},
			UpdateCommand: {
				default: {
					Attributes: userArticleItem({
						userId: WORK_PARTITION,
						status: "read",
						readAt: "2026-05-30T12:00:00.000Z",
					}),
				},
			},
			BatchGetCommand: {
				default: {
					Responses: { "user-articles": [{ userId: USER }, { userId: WORK_PARTITION }] },
				},
			},
		});

		const saved = await initStore(client).updateArticleStatusAcrossReadlists({
			id: ReaderArticleHashId.fromHash(ROUTE_ID),
			userId: USER,
			addressed: WORK,
			status: "read",
		});

		expect(
			commands.filter((c) => c.name === "UpdateCommand").map((c) => c.input.Key),
		).toEqual([
			{ userId: WORK_PARTITION, url: RESOURCE_ID },
			{ userId: USER, url: RESOURCE_ID },
		]);
		expect(saved?.userId).toBe(USER);
		expect(saved?.status).toBe("read");
	});

	it("updateArticleStatusAcrossReadlists addressing the default readlist writes the base partition first", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [articleItem()], Count: 1 },
					{ Items: [queueDefinitionItem()], Count: 1 },
				],
				default: { Items: [articleItem()], Count: 1 },
			},
			UpdateCommand: { default: { Attributes: userArticleItem({ status: "read" }) } },
			BatchGetCommand: {
				default: {
					Responses: { "user-articles": [{ userId: USER }, { userId: WORK_PARTITION }] },
				},
			},
		});

		await initStore(client).updateArticleStatusAcrossReadlists({
			id: ReaderArticleHashId.fromHash(ROUTE_ID),
			userId: USER,
			addressed: DEFAULT_READLIST_SLUG,
			status: "unread",
		});

		expect(
			commands.filter((c) => c.name === "UpdateCommand").map((c) => c.input.Key),
		).toEqual([
			{ userId: USER, url: RESOURCE_ID },
			{ userId: WORK_PARTITION, url: RESOURCE_ID },
		]);
	});

	it("updateArticleStatusAcrossReadlists writes nothing further when the addressed readlist does not hold the article", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			UpdateCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "gone" });
				},
			},
		});

		const saved = await initStore(client).updateArticleStatusAcrossReadlists({
			id: ReaderArticleHashId.fromHash(ROUTE_ID),
			userId: USER,
			addressed: WORK,
			status: "read",
		});

		expect(saved).toBeNull();
		expect(commands.filter((c) => c.name === "UpdateCommand")).toHaveLength(1);
		expect(commands.filter((c) => c.name === "BatchGetCommand")).toHaveLength(0);
	});

	it("deleteReadlistArticle removes only the copy's row", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
		});

		expect(
			await initStore(client).deleteReadlistArticle({
				id: ReaderArticleHashId.fromHash(ROUTE_ID),
				userId: USER,
				readlist: WORK,
			}),
		).toBe(true);
		expect(commands.find((c) => c.name === "DeleteCommand")?.input.Key).toEqual({
			userId: WORK_PARTITION,
			url: RESOURCE_ID,
		});
	});

	it("markReadlistArticleViewed stamps the copy's row", async () => {
		const { client, commands } = createFakeClient();

		await initStore(client).markReadlistArticleViewed({
			userId: USER,
			readlist: WORK,
			url: URL,
			at: new Date("2026-05-30T12:00:00.000Z"),
		});

		const update = commands.find((c) => c.name === "UpdateCommand");
		expect(update?.input.Key).toEqual({ userId: WORK_PARTITION, url: RESOURCE_ID });
		expect(update?.input.UpdateExpression).toBe("SET viewedAt = :at");
	});
});

describe("initDynamoDbSavedArticleStore readlist-scoped reads", () => {
	it("findReadlistArticles queries the readlist partition on the existing savedAt index", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				default: { Items: [userArticleItem({ userId: WORK_PARTITION })], Count: 1 },
			},
			BatchGetCommand: { default: { Responses: { articles: [articleItem()] } } },
		});

		const result = await initStore(client).findReadlistArticles({
			userId: USER,
			readlist: WORK,
			pageSize: 20,
		});

		const query = commands.find((c) => c.name === "QueryCommand");
		expect(query?.input.IndexName).toBe("userId-savedAt-index");
		expect((query?.input.ExpressionAttributeValues as Record<string, unknown>)[":userId"]).toBe(
			WORK_PARTITION,
		);
		expect(result.articles.map((a) => a.userId)).toEqual([USER]);
	});

	it("countReadlistArticles counts the readlist partition", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [], Count: 4 } },
		});

		expect(await initStore(client).countReadlistArticles({ userId: USER, readlist: WORK })).toBe(4);
		expect(
			(countQueries(commands)[0]?.input.ExpressionAttributeValues as Record<string, unknown>)[
				":userId"
			],
		).toBe(WORK_PARTITION);
	});

	it("findReadlistArticleById reads the copy's row and reports the base user id", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
			GetCommand: { default: { Item: userArticleItem({ userId: WORK_PARTITION }) } },
		});

		const found = await initStore(client).findReadlistArticleById({
			id: ReaderArticleHashId.fromHash(ROUTE_ID),
			userId: USER,
			readlist: WORK,
		});

		expect(commands.find((c) => c.name === "GetCommand")?.input.Key).toEqual({
			userId: WORK_PARTITION,
			url: RESOURCE_ID,
		});
		expect(found?.userId).toBe(USER);
	});

	it("findReadlistArticleById answers null when the readlist holds no copy of the article", async () => {
		const { client } = createFakeClient({
			QueryCommand: { default: { Items: [articleItem()], Count: 1 } },
		});

		expect(
			await initStore(client).findReadlistArticleById({
				id: ReaderArticleHashId.fromHash(ROUTE_ID),
				userId: USER,
				readlist: WORK,
			}),
		).toBeNull();
	});
});

describe("initDynamoDbSavedArticleStore cross-readlist bookkeeping", () => {
	it("findUserArticlesByUrl reports the savers of the default readlist and skips readlist copies", async () => {
		const { client } = createFakeClient({
			QueryCommand: {
				default: {
					Items: [
						userArticleItem({ viewedAt: "2026-05-30T09:30:00.000Z" }),
						userArticleItem({ userId: WORK_PARTITION }),
						userArticleItem({ userId: "other-user" }),
					],
					Count: 3,
				},
			},
		});

		expect(await initStore(client).findUserArticlesByUrl(URL)).toEqual([
			{ userId: USER, viewedAt: new Date("2026-05-30T09:30:00.000Z") },
			{ userId: "other-user", viewedAt: undefined },
		]);
	});

	it("assignSavedArticleToReadlist copies the default row's state into the readlist partition at the given savedAt", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: {
				default: {
					Item: userArticleItem({
						status: "read",
						readAt: "2026-06-01T08:00:00.000Z",
						provenance: { kind: "client", clientName: "chrome" },
					}),
				},
			},
		});

		const result = await initStore(client).assignSavedArticleToReadlist({
			userId: USER,
			readlist: ReadlistSlugSchema.parse("work"),
			url: URL,
			savedAt: new Date("2026-08-24T10:00:00.000Z"),
		});

		expect(result).toEqual({ assigned: true });
		const put = commands.find((c) => c.name === "PutCommand");
		assert(put, "the copy must be written with a Put");
		expect(put.input.Item).toEqual({
			userId: WORK_PARTITION,
			url: RESOURCE_ID,
			status: "read",
			savedAt: "2026-08-24T10:00:00.000Z",
			readAt: "2026-06-01T08:00:00.000Z",
			provenance: { kind: "client", clientName: "chrome" },
		});
		expect(put.input.ConditionExpression).toContain("attribute_not_exists");
	});

	it("assignSavedArticleToReadlist writes no readAt or provenance the default row does not carry", async () => {
		const { client, commands } = createFakeClient({
			GetCommand: { default: { Item: userArticleItem() } },
		});

		const result = await initStore(client).assignSavedArticleToReadlist({
			userId: USER,
			readlist: ReadlistSlugSchema.parse("work"),
			url: URL,
			savedAt: new Date("2026-08-24T10:00:00.000Z"),
		});

		expect(result).toEqual({ assigned: true });
		const put = commands.find((c) => c.name === "PutCommand");
		assert(put, "the copy must be written with a Put");
		expect(put.input.Item).toEqual({
			userId: WORK_PARTITION,
			url: RESOURCE_ID,
			status: "unread",
			savedAt: "2026-08-24T10:00:00.000Z",
		});
	});

	it("assignSavedArticleToReadlist writes nothing when the default row is gone", async () => {
		const { client, commands } = createFakeClient();

		const result = await initStore(client).assignSavedArticleToReadlist({
			userId: USER,
			readlist: ReadlistSlugSchema.parse("work"),
			url: URL,
			savedAt: new Date("2026-08-24T10:00:00.000Z"),
		});

		expect(result).toEqual({ assigned: false });
		expect(commands.filter((c) => c.name === "PutCommand")).toEqual([]);
	});

	it("assignSavedArticleToReadlist surfaces a write failure that is not the copy already existing", async () => {
		const { client } = createFakeClient({
			GetCommand: { default: { Item: userArticleItem() } },
			PutCommand: {
				default: () => {
					throw new Error("throughput exceeded");
				},
			},
		});

		await expect(
			initStore(client).assignSavedArticleToReadlist({
				userId: USER,
				readlist: ReadlistSlugSchema.parse("work"),
				url: URL,
				savedAt: new Date("2026-08-24T10:00:00.000Z"),
			}),
		).rejects.toThrow("throughput exceeded");
	});

	it("assignSavedArticleToReadlist reports an already-filed article without rewriting it", async () => {
		const { client } = createFakeClient({
			GetCommand: { default: { Item: userArticleItem() } },
			PutCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
				},
			},
		});

		const result = await initStore(client).assignSavedArticleToReadlist({
			userId: USER,
			readlist: ReadlistSlugSchema.parse("work"),
			url: URL,
			savedAt: new Date("2026-08-24T10:00:00.000Z"),
		});

		expect(result).toEqual({ assigned: false });
	});

	it("moveReadlistArticles hands each row to the destination partition carrying the state it had in the source", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				default: {
					Items: [
						userArticleItem({
							userId: WORK_PARTITION,
							status: "read",
							readAt: "2026-06-01T08:00:00.000Z",
							viewedAt: "2026-06-01T07:00:00.000Z",
							provenance: { kind: "client", clientName: "chrome" },
						}),
					],
					Count: 1,
				},
			},
		});

		const result = await initStore(client).moveReadlistArticles({
			userId: USER,
			from: WORK,
			to: LATER,
		});

		expect(result).toEqual({ moved: 1 });
		const put = commands.find((c) => c.name === "PutCommand");
		assert(put, "the row must be written into the destination partition");
		expect(put.input.Item).toEqual({
			userId: LATER_PARTITION,
			url: RESOURCE_ID,
			status: "read",
			savedAt: "2026-05-30T09:00:00.000Z",
			readAt: "2026-06-01T08:00:00.000Z",
			viewedAt: "2026-06-01T07:00:00.000Z",
			provenance: { kind: "client", clientName: "chrome" },
		});
		expect(put.input.ConditionExpression).toContain("attribute_not_exists");
		const remove = commands.find((c) => c.name === "DeleteCommand");
		assert(remove, "the source row must be taken out of the readlist being emptied");
		expect(remove.input.Key).toEqual({ userId: WORK_PARTITION, url: RESOURCE_ID });
	});

	it("moveReadlistArticles drains a row the destination already holds without counting it as moved", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				default: { Items: [userArticleItem({ userId: WORK_PARTITION })], Count: 1 },
			},
			PutCommand: {
				default: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
				},
			},
		});

		const result = await initStore(client).moveReadlistArticles({
			userId: USER,
			from: WORK,
			to: LATER,
		});

		expect(result).toEqual({ moved: 0 });
		const remove = commands.find((c) => c.name === "DeleteCommand");
		assert(remove, "the source row goes either way — the destination already holds the article");
		expect(remove.input.Key).toEqual({ userId: WORK_PARTITION, url: RESOURCE_ID });
	});

	it("moveReadlistArticles walks every page the source partition answers with", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{
						Items: [userArticleItem({ userId: WORK_PARTITION })],
						Count: 1,
						LastEvaluatedKey: { userId: WORK_PARTITION, url: RESOURCE_ID },
					},
					{
						Items: [
							userArticleItem({ userId: WORK_PARTITION, url: "example.com/second" }),
						],
						Count: 1,
					},
				],
			},
		});

		expect(
			await initStore(client).moveReadlistArticles({ userId: USER, from: WORK, to: LATER }),
		).toEqual({ moved: 2 });
		expect(commands.filter((c) => c.name === "DeleteCommand")).toHaveLength(2);
	});

	it("moveReadlistArticles surfaces a write failure that is not the destination already holding the row", async () => {
		const { client } = createFakeClient({
			QueryCommand: {
				default: { Items: [userArticleItem({ userId: WORK_PARTITION })], Count: 1 },
			},
			PutCommand: {
				default: () => {
					throw new Error("throughput exceeded");
				},
			},
		});

		await expect(
			initStore(client).moveReadlistArticles({ userId: USER, from: WORK, to: LATER }),
		).rejects.toThrow("throughput exceeded");
	});

	it("listUserSavesForUrl reads the default row and one key per readlist the user owns", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [queueDefinitionItem()], Count: 1 } },
			BatchGetCommand: {
				default: {
					Responses: { "user-articles": [{ userId: USER }, { userId: WORK_PARTITION }] },
				},
			},
		});

		const saves = await initStore(client).listUserSavesForUrl({ userId: USER, url: URL });

		expect(saves).toEqual([{}, { readlist: "work" }]);
		const batchGet = commands.find((c) => c.name === "BatchGetCommand");
		expect(
			(batchGet?.input.RequestItems as Record<string, { Keys: Record<string, string>[] }>)[
				"user-articles"
			]?.Keys,
		).toEqual([
			{ userId: USER, url: RESOURCE_ID },
			{ userId: WORK_PARTITION, url: RESOURCE_ID },
		]);
	});

	it("listUserSavesForUrls groups one batched read back onto the URLs it was asked about", async () => {
		const otherUrl = "https://example.com/other";
		const { client, commands } = createFakeClient({
			QueryCommand: { default: { Items: [queueDefinitionItem()], Count: 1 } },
			BatchGetCommand: {
				default: {
					Responses: {
						"user-articles": [
							{ userId: USER, url: RESOURCE_ID },
							{ userId: WORK_PARTITION, url: RESOURCE_ID },
						],
					},
				},
			},
		});

		const saves = await initStore(client).listUserSavesForUrls({
			userId: USER,
			urls: [URL, otherUrl],
		});

		expect(saves.get(URL)).toEqual([{}, { readlist: "work" }]);
		expect(saves.get(otherUrl)).toEqual([]);
		const batchGet = commands.find((c) => c.name === "BatchGetCommand");
		expect(
			(batchGet?.input.RequestItems as Record<string, { Keys: Record<string, string>[] }>)[
				"user-articles"
			]?.Keys,
		).toEqual([
			{ userId: USER, url: RESOURCE_ID },
			{ userId: WORK_PARTITION, url: RESOURCE_ID },
			{ userId: USER, url: "example.com/other" },
			{ userId: WORK_PARTITION, url: "example.com/other" },
		]);
	});

	it("deleteAllUserArticles sweeps every readlist partition and removes the definition rows", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [userArticleItem({ url: "a" })], Count: 1 },
					{ Items: [queueDefinitionItem()], Count: 1 },
					{ Items: [userArticleItem({ userId: WORK_PARTITION, url: "b" })], Count: 1 },
				],
			},
		});

		await initStore(client).deleteAllUserArticles(USER);

		expect(commands.filter((c) => c.name === "DeleteCommand").map((d) => d.input.Key)).toEqual([
			{ userId: USER, url: "a" },
			{ userId: WORK_PARTITION, url: "b" },
			{ userId: USER, url: "readplace:queue-def/work" },
			{ userId: USER, url: `readplace:save-cursor/${USER}` },
		]);
	});

	it("listUserArticleUrls covers a URL the user only ever saved into a readlist", async () => {
		const { client, commands } = createFakeClient({
			QueryCommand: {
				readlist: [
					{ Items: [], Count: 0 },
					{ Items: [queueDefinitionItem()], Count: 1 },
					{ Items: [userArticleItem({ userId: WORK_PARTITION, url: "example.com/only" })], Count: 1 },
				],
			},
			BatchGetCommand: {
				default: { Responses: { articles: [{ originalUrl: "https://example.com/only" }] } },
			},
		});

		expect(await initStore(client).listUserArticleUrls(USER)).toEqual([
			"https://example.com/only",
		]);
		expect(batchGetKeys(commands)).toEqual([{ url: "example.com/only" }]);
	});
});
