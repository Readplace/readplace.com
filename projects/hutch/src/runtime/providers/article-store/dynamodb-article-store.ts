import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	assertItem,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import type { SavedArticle } from "@packages/domain/article";
import { MinutesSchema, ArticleStatusSchema } from "@packages/domain/article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { StoredCrawlVersionSchema, normalizeCrawlVersion } from "@packages/article-store";
import { ReaderArticleHashId, ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import type {
	BumpArticleSavedAt,
	CountArticlesByUser,
	DeleteAllUserArticles,
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesByUser,
	FindUserArticleNotificationState,
	FindUserArticlesByUrl,
	MarkArticleViewed,
	MarkReaderReadyEmailSent,
	MarkReaderViewSucceeded,
	MarkSummaryToggled,
	SaveArticle,
	SaveArticleGlobally,
	UpdateArticleStatus,
} from "@packages/provider-contracts/article-store";
import type { ContentProvider } from "@packages/provider-contracts/article-store";

const ArticleContentRow = z.object({
	content: dynamoField(z.string()),
});

const ArticleFreshnessRow = z.object({
	etag: dynamoField(z.string()),
	lastModified: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
});

const ArticleCrawlVersionsRow = z.object({
	crawlVersions: dynamoField(z.array(StoredCrawlVersionSchema)),
});

/** `routeId` column holds the `ReaderArticleHashId.value` (32-char hex). The Zod schema rehydrates it into a `ReaderArticleHashId` instance on read.
 *
 * `savedAt` is the public-row freshness anchor: when the row is first created
 * it records the original save; on every re-save the domain bumps it via
 * `bumpArticleSavedAt` so downstream consumers (expiry counter, freshness
 * policies) can compute time-based behaviour from a single timestamp. Stored
 * as ISO-8601 to match the column convention used by `UserArticleRow`. */
const ArticleRow = z.object({
	url: z.string(),
	routeId: ReaderArticleHashIdSchema,
	originalUrl: z.string(),
	/** The redirect destination this article was adopted onto, stamped by the
	 * adopt hook. Optional: only redirect-merged articles carry it. Read-only
	 * here — it drives display, never identity. */
	displayUrl: dynamoField(z.string()),
	title: z.string(),
	siteName: z.string(),
	excerpt: z.string(),
	wordCount: z.number(),
	imageUrl: dynamoField(z.string()),
	content: dynamoField(z.string()),
	estimatedReadTime: MinutesSchema,
	savedAt: dynamoField(z.string()),
	contentSourceTier: dynamoField(z.enum(["tier-0", "tier-1"])),
});
/** Every ArticleRow attribute except `content`, derived so the list stays in sync with the schema. */
const ArticleMetadataFields = ArticleRow.omit({ content: true }).keyof().options;

const UnverifiedArticleRow = ArticleRow.extend({
	routeId: dynamoField(ReaderArticleHashIdSchema),
	originalUrl: dynamoField(z.string()),
});

const UserArticleRow = z.object({
	userId: UserIdSchema,
	url: z.string(),
	status: ArticleStatusSchema,
	savedAt: z.string(),
	readAt: dynamoField(z.string()),
	/* Reader-ready notification columns. All optional via dynamoField: legacy
	 * rows and never-opened/never-succeeded rows simply lack them. */
	succeededAt: dynamoField(z.string()),
	viewedAt: dynamoField(z.string()),
	emailSentAt: dynamoField(z.string()),
	/* Latest TL;DR open/close toggle, last-write-wins. Optional via dynamoField:
	 * legacy rows and never-toggled rows simply lack them. */
	lastSummaryOpenedAt: dynamoField(z.string()),
	lastSummaryClosedAt: dynamoField(z.string()),
});

function toSavedArticle(
	article: z.infer<typeof ArticleRow>,
	userArticle: z.infer<typeof UserArticleRow>,
): SavedArticle {
	return {
		id: article.routeId,
		userId: userArticle.userId,
		url: article.originalUrl,
		displayUrl: article.displayUrl,
		metadata: {
			title: article.title,
			siteName: article.siteName,
			excerpt: article.excerpt,
			wordCount: article.wordCount,
			imageUrl: article.imageUrl,
		},
		content: article.content,
		estimatedReadTime: article.estimatedReadTime,
		status: userArticle.status,
		savedAt: new Date(userArticle.savedAt),
		readAt: userArticle.readAt ? new Date(userArticle.readAt) : undefined,
	};
}

export function initDynamoDbArticleStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	userArticlesTableName: string;
	logger: HutchLogger;
}): {
	saveArticle: SaveArticle;
	saveArticleGlobally: SaveArticleGlobally;
	bumpArticleSavedAt: BumpArticleSavedAt;
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	deleteArticle: DeleteArticle;
	deleteAllUserArticles: DeleteAllUserArticles;
	updateArticleStatus: UpdateArticleStatus;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	markArticleViewed: MarkArticleViewed;
	markSummaryToggled: MarkSummaryToggled;
	markReaderViewSucceeded: MarkReaderViewSucceeded;
	findUserArticlesByUrl: FindUserArticlesByUrl;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	findUserArticleNotificationState: FindUserArticleNotificationState;
	readContent: ContentProvider;
} {
	const { client, tableName, userArticlesTableName, logger } = deps;

	const articles = defineDynamoTable({ client, tableName, schema: ArticleRow });
	const unverifiedArticles = defineDynamoTable({ client, tableName, schema: UnverifiedArticleRow });
	const articleContent = defineDynamoTable({ client, tableName, schema: ArticleContentRow });
	const articleFreshness = defineDynamoTable({ client, tableName, schema: ArticleFreshnessRow });
	const articleCrawlVersions = defineDynamoTable({ client, tableName, schema: ArticleCrawlVersionsRow });
	const userArticles = defineDynamoTable({
		client,
		tableName: userArticlesTableName,
		schema: UserArticleRow,
	});

	async function findArticleByRouteId(routeId: ReaderArticleHashId): Promise<z.infer<typeof ArticleRow> | null> {
		const { items } = await articles.query({
			IndexName: "routeId-index",
			KeyConditionExpression: "routeId = :routeId",
			ExpressionAttributeValues: { ":routeId": routeId.value },
			Limit: 1,
		});
		return items[0] ?? null;
	}

	async function findUserArticle(userId: UserId, url: string): Promise<z.infer<typeof UserArticleRow> | null> {
		const row = await userArticles.get({ userId, url });
		return row ?? null;
	}

	const saveArticleGlobally: SaveArticleGlobally = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const routeId = ReaderArticleHashId.from(params.url);

		try {
			await articles.put({
				Item: {
					url: articleResourceUniqueId.value,
					routeId: routeId.value,
					originalUrl: params.url,
					title: params.metadata.title,
					siteName: params.metadata.siteName,
					excerpt: params.metadata.excerpt,
					wordCount: params.metadata.wordCount,
					imageUrl: params.metadata.imageUrl,
					estimatedReadTime: params.estimatedReadTime,
					savedAt: params.savedAt.toISOString(),
				},
				ConditionExpression: "attribute_not_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
			});
			return { created: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { created: false };
			}
			throw error;
		}
	};

	const bumpArticleSavedAt: BumpArticleSavedAt = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		try {
			await articles.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: "SET savedAt = :savedAt",
				ConditionExpression: "attribute_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":savedAt": params.savedAt.toISOString(),
				},
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	const saveArticle: SaveArticle = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const now = new Date();

		const upsertGlobal = async () => {
			const { created } = await saveArticleGlobally({
				url: params.url,
				metadata: params.metadata,
				estimatedReadTime: params.estimatedReadTime,
				savedAt: now,
			});
			if (!created) {
				await bumpArticleSavedAt({ url: params.url, savedAt: now });
			}
		};

		await Promise.all([
			upsertGlobal(),
			userArticles.update({
				Key: { userId: params.userId, url: articleResourceUniqueId.value },
				UpdateExpression:
					"SET savedAt = :savedAt, #status = if_not_exists(#status, :unread)",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					":savedAt": now.toISOString(),
					":unread": "unread",
				},
			}),
		]);

		// Strongly-consistent read-your-writes: a default eventually-consistent read
		// can miss the row we just wrote and trip the asserts below on an otherwise
		// successful save. ConsistentRead makes both reflect the writes above.
		const [article, userArticle] = await Promise.all([
			articles.get({ url: articleResourceUniqueId.value }, { consistentRead: true }),
			userArticles.get({ userId: params.userId, url: articleResourceUniqueId.value }, { consistentRead: true }),
		]);
		assertItem(article, "article must exist immediately after save");
		assertItem(userArticle, "user article must exist immediately after save");

		return toSavedArticle(article, userArticle);
	};

	const findArticleById: FindArticleById = async (routeId, userId) => {
		const article = await findArticleByRouteId(routeId);
		if (!article) return null;

		const userArticle = await findUserArticle(userId, article.url);
		if (!userArticle) return null;

		return toSavedArticle(article, userArticle);
	};

	const findArticlesByUser: FindArticlesByUser = async (query) => {
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;
		const order = query.order ?? "desc";
		const sort = query.sort ?? "savedAt";
		const indexName = sort === "readAt" ? "userId-readAt-index" : "userId-savedAt-index";

		const expressionValues: Record<string, unknown> = {
			":userId": query.userId,
		};
		let filterExpression: string | undefined;
		let expressionAttributeNames: Record<string, string> | undefined;

		if (query.status) {
			filterExpression = "#status = :status";
			expressionValues[":status"] = query.status;
			expressionAttributeNames = { "#status": "status" };
		}

		let total = 0;
		let countStartKey: Record<string, unknown> | undefined;
		do {
			const { count, lastEvaluatedKey } = await userArticles.query({
				IndexName: indexName,
				KeyConditionExpression: "userId = :userId",
				FilterExpression: filterExpression,
				ExpressionAttributeValues: expressionValues,
				ExpressionAttributeNames: expressionAttributeNames,
				Select: "COUNT",
				ExclusiveStartKey: countStartKey,
			});
			total += count;
			countStartKey = lastEvaluatedKey;
		} while (countStartKey);

		const itemsToSkip = (page - 1) * pageSize;
		const userArts: z.infer<typeof UserArticleRow>[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;
		let skippedCount = 0;

		do {
			const { items, lastEvaluatedKey } = await userArticles.query({
				IndexName: indexName,
				KeyConditionExpression: "userId = :userId",
				FilterExpression: filterExpression,
				ExpressionAttributeValues: expressionValues,
				ExpressionAttributeNames: expressionAttributeNames,
				ScanIndexForward: order === "asc",
				Limit: pageSize,
				ExclusiveStartKey: exclusiveStartKey,
			});

			for (const item of items) {
				if (skippedCount < itemsToSkip) {
					skippedCount++;
				} else if (userArts.length < pageSize) {
					userArts.push(item);
				}
			}

			exclusiveStartKey = lastEvaluatedKey;

			if (userArts.length >= pageSize && !exclusiveStartKey) {
				break;
			}
		} while (
			exclusiveStartKey &&
			(skippedCount < itemsToSkip || userArts.length < pageSize)
		);

		if (userArts.length === 0) {
			return { articles: [], total, page, pageSize };
		}

		const urls = userArts.map((ua) => ({ url: ua.url }));
		const batchedArticles = await batchGetFromTable({
			client,
			tableName,
			schema: ArticleRow,
			keys: urls,
			projection: query.excludeContent ? ArticleMetadataFields : undefined,
		});

		const articlesByUrl = new Map<string, z.infer<typeof ArticleRow>>();
		for (const article of batchedArticles) {
			articlesByUrl.set(article.url, article);
		}

		const result: SavedArticle[] = [];
		for (const ua of userArts) {
			const article = articlesByUrl.get(ua.url);
			if (article) {
				result.push(toSavedArticle(article, ua));
			}
		}

		return { articles: result, total, page, pageSize };
	};

	const countArticlesByUser: CountArticlesByUser = async (query) => {
		const expressionValues: Record<string, unknown> = { ":userId": query.userId };
		let filterExpression: string | undefined;
		let expressionAttributeNames: Record<string, string> | undefined;
		if (query.status) {
			filterExpression = "#status = :status";
			expressionValues[":status"] = query.status;
			expressionAttributeNames = { "#status": "status" };
		}

		let total = 0;
		let startKey: Record<string, unknown> | undefined;
		do {
			const { count, lastEvaluatedKey } = await userArticles.query({
				IndexName: "userId-savedAt-index",
				KeyConditionExpression: "userId = :userId",
				FilterExpression: filterExpression,
				ExpressionAttributeValues: expressionValues,
				ExpressionAttributeNames: expressionAttributeNames,
				Select: "COUNT",
				ExclusiveStartKey: startKey,
			});
			total += count;
			startKey = lastEvaluatedKey;
		} while (startKey);
		return total;
	};

	const deleteArticle: DeleteArticle = async (routeId, userId) => {
		const article = await findArticleByRouteId(routeId);
		if (!article) return false;

		const ua = await findUserArticle(userId, article.url);
		if (!ua) return false;

		await userArticles.delete({ Key: { userId, url: article.url } });
		return true;
	};

	const deleteAllUserArticles: DeleteAllUserArticles = async (userId) => {
		await forEachQueryPage(
			userArticles,
			{
				IndexName: "userId-savedAt-index",
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": userId },
			},
			async (rows) => {
				await Promise.all(
					rows.map((row) => userArticles.delete({ Key: { userId: row.userId, url: row.url } })),
				);
			},
		);
	};

	const updateArticleStatus: UpdateArticleStatus = async (routeId, userId, status) => {
		const article = await findArticleByRouteId(routeId);
		if (!article) return false;

		const ua = await findUserArticle(userId, article.url);
		if (!ua) return false;

		if (status === "read") {
			await userArticles.update({
				Key: { userId, url: article.url },
				UpdateExpression: "SET #status = :status, readAt = :readAt",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					":status": status,
					":readAt": new Date().toISOString(),
				},
			});
		} else {
			await userArticles.update({
				Key: { userId, url: article.url },
				UpdateExpression: "SET #status = :status REMOVE readAt",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: { ":status": status },
			});
		}

		return true;
	};

	const findArticleFreshness: FindArticleFreshness = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await articleFreshness.get(
			{ url: articleResourceUniqueId.value },
			{ projection: ["etag", "lastModified", "contentFetchedAt"] },
		);
		if (!row) return null;
		return {
			etag: row.etag,
			lastModified: row.lastModified,
			contentFetchedAt: row.contentFetchedAt,
		};
	};

	async function stampUserArticleIfStillSaved(stamp: {
		userId: UserId;
		url: string;
		updateExpression: string;
		at: Date;
	}): Promise<void> {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(stamp.url);
		try {
			await userArticles.update({
				Key: { userId: stamp.userId, url: articleResourceUniqueId.value },
				UpdateExpression: stamp.updateExpression,
				ConditionExpression: "attribute_exists(savedAt)",
				ExpressionAttributeValues: { ":at": stamp.at.toISOString() },
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	}

	const findArticleCrawlVersions: FindArticleCrawlVersions = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await articleCrawlVersions.get(
			{ url: articleResourceUniqueId.value },
			{ projection: ["crawlVersions"] },
		);
		return (row?.crawlVersions ?? []).map(normalizeCrawlVersion).map((entry) => ({
			crawledAtMinute: entry.minuteId,
			...(entry.authorUserId === undefined
				? {}
				: { authorUserId: UserIdSchema.parse(entry.authorUserId) }),
		}));
	};

	const markArticleViewed: MarkArticleViewed = async ({ userId, url, at }) => {
		await stampUserArticleIfStillSaved({ userId, url, at, updateExpression: "SET viewedAt = :at" });
	};

	const markSummaryToggled: MarkSummaryToggled = async ({ userId, url, state, at }) => {
		const attribute = state === "open" ? "lastSummaryOpenedAt" : "lastSummaryClosedAt";
		await stampUserArticleIfStillSaved({ userId, url, at, updateExpression: `SET ${attribute} = :at` });
	};

	const markReaderViewSucceeded: MarkReaderViewSucceeded = async ({ userId, url, at }) => {
		await stampUserArticleIfStillSaved({
			userId,
			url,
			at,
			updateExpression: "SET succeededAt = if_not_exists(succeededAt, :at)",
		});
	};

	const findUserArticlesByUrl: FindUserArticlesByUrl = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const rows: z.infer<typeof UserArticleRow>[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const { items, lastEvaluatedKey } = await userArticles.query({
				IndexName: "url-index",
				KeyConditionExpression: "#url = :url",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: { ":url": articleResourceUniqueId.value },
				ExclusiveStartKey: exclusiveStartKey,
			});
			rows.push(...items);
			exclusiveStartKey = lastEvaluatedKey;
		} while (exclusiveStartKey);

		return rows.map((row) => ({
			userId: row.userId,
			viewedAt: row.viewedAt ? new Date(row.viewedAt) : undefined,
		}));
	};

	const markReaderReadyEmailSent: MarkReaderReadyEmailSent = async ({ userId, url, at }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		try {
			await userArticles.update({
				Key: { userId, url: articleResourceUniqueId.value },
				UpdateExpression: "SET emailSentAt = :at",
				ConditionExpression: "attribute_exists(savedAt) AND attribute_not_exists(emailSentAt)",
				ExpressionAttributeValues: { ":at": at.toISOString() },
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	const findUserArticleNotificationState: FindUserArticleNotificationState = async ({ userId, url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await userArticles.get({ userId, url: articleResourceUniqueId.value });
		if (!row) return null;
		return {
			savedAt: new Date(row.savedAt),
			status: row.status,
			succeededAt: row.succeededAt ? new Date(row.succeededAt) : undefined,
			viewedAt: row.viewedAt ? new Date(row.viewedAt) : undefined,
			emailSentAt: row.emailSentAt ? new Date(row.emailSentAt) : undefined,
		};
	};

	const findArticleUrlById: FindArticleUrlById = async (id) => {
		const article = await findArticleByRouteId(id);
		return article ? article.originalUrl : null;
	};

	const findArticleByUrl: FindArticleByUrl = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await unverifiedArticles.get(
			{ url: articleResourceUniqueId.value },
			{
				projection: [
					"url",
					"routeId",
					"originalUrl",
					"displayUrl",
					"title",
					"siteName",
					"excerpt",
					"wordCount",
					"imageUrl",
					"estimatedReadTime",
					"savedAt",
					"contentSourceTier",
				],
			},
		);
		if (!row) return null;
		if (row.routeId === undefined || row.originalUrl === undefined) {
			logger.warn(
				`[article-store] article row "${articleResourceUniqueId.value}" is missing reader identity columns (routeId/originalUrl); treating it as not found`,
			);
			return null;
		}
		return {
			id: row.routeId,
			url: row.originalUrl,
			displayUrl: row.displayUrl,
			metadata: {
				title: row.title,
				siteName: row.siteName,
				excerpt: row.excerpt,
				wordCount: row.wordCount,
				imageUrl: row.imageUrl,
			},
			estimatedReadTime: row.estimatedReadTime,
			savedAt: row.savedAt ? new Date(row.savedAt) : new Date(0),
			contentSourceTier: row.contentSourceTier,
		};
	};

	/** Legacy fallback for articles saved before S3 migration. S3 is the primary content store. */
	const readContent: ContentProvider = async (articleResourceUniqueId) => {
		const row = await articleContent.get(
			{ url: articleResourceUniqueId.value },
			{ projection: ["content"] },
		);
		return row?.content;
	};

	return {
		saveArticle,
		saveArticleGlobally,
		bumpArticleSavedAt,
		findArticleById,
		findArticleByUrl,
		findArticleUrlById,
		findArticlesByUser,
		countArticlesByUser,
		deleteArticle,
		deleteAllUserArticles,
		updateArticleStatus,
		findArticleFreshness,
		findArticleCrawlVersions,
		markArticleViewed,
		markSummaryToggled,
		markReaderViewSucceeded,
		findUserArticlesByUrl,
		markReaderReadyEmailSent,
		findUserArticleNotificationState,
		readContent,
	};
}
