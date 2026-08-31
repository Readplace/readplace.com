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
import type { ArticleStatus, SavedArticle } from "@packages/domain/article";
import { MinutesSchema, ArticleStatusSchema, SaveProvenanceSchema } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { StoredCrawlVersionSchema, normalizeCrawlVersion } from "./crawl-version-log";
import { ReaderArticleHashId, ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import assert from "node:assert";
import type {
	AllocateSavedAt,
	AllocateSavedAtSequence,
	AssignSavedArticleToReadlist,
	MoveReadlistArticles,
	BumpArticleSavedAt,
	FindSavedUrls,
	CountArticlesByUser,
	CountReadlistArticles,
	DeleteAllUserArticles,
	DeleteArticle,
	DeleteReadlistArticle,
	ListUserArticleUrls,
	ListUserSavesForUrl,
	ListUserSavesForUrls,
	FindArticleById,
	FindArticleByUrl,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesByUser,
	FindArticlesQuery,
	FindArticlesResult,
	FindReadlistArticleById,
	FindReadlistArticles,
	FindUserArticleNotificationState,
	FindUserArticlesByUrl,
	ListSharedArticles,
	MarkArticleViewed,
	MarkLinkShared,
	MarkReadlistArticleViewed,
	MarkReaderReadyEmailSent,
	MarkRelatedDismissed,
	MarkSummaryToggled,
	SaveArticle,
	SaveArticleGlobally,
	SaveArticleParams,
	SaveReadlistArticle,
	UpdateArticleStatus,
	UpdateArticleStatusAcrossReadlists,
} from "@packages/provider-contracts/article-store";
import type { ContentProvider } from "@packages/provider-contracts/article-store";
import {
	READLIST_DEFINITION_KEY_PREFIX,
	decodeUserArticlePartition,
	partitionFor,
	readlistDefinitionKey,
	readlistPartitionValue,
} from "./user-readlist-partition";

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
	purgedAt: dynamoField(z.string()),
	readerAvailableAt: dynamoField(z.string()),
});
/** Every ArticleRow attribute except `content`, derived so the list stays in sync with the schema. */
const ArticleMetadataFields = ArticleRow.omit({ content: true }).keyof().options;

const UnverifiedArticleRow = ArticleRow.extend({
	routeId: dynamoField(ReaderArticleHashIdSchema),
	originalUrl: dynamoField(z.string()),
});

/** Keyed per user so every user's cursor lands on its own url-index partition,
 * and shaped so no normalized article id can collide: ArticleResourceUniqueId
 * only keeps a colon inside a numeric host:port, never before a path. */
function saveCursorUrl(userId: UserId): string {
	return `readplace:save-cursor/${userId}`;
}

const SaveCursorRow = z.object({
	savedAtCursorMs: z.number(),
});

const SavedUrlRow = z.looseObject({ url: z.string() });

const UserArticleRow = z.object({
	userId: UserIdSchema,
	url: z.string(),
	status: ArticleStatusSchema,
	savedAt: z.string(),
	readAt: dynamoField(z.string()),
	/* Reader-ready notification columns. All optional via dynamoField: legacy
	 * rows and never-opened rows simply lack them. */
	viewedAt: dynamoField(z.string()),
	emailSentAt: dynamoField(z.string()),
	/* Latest TL;DR open/close toggle, last-write-wins. Optional via dynamoField:
	 * legacy rows and never-toggled rows simply lack them. */
	lastSummaryOpenedAt: dynamoField(z.string()),
	lastSummaryClosedAt: dynamoField(z.string()),
	sharedAt: dynamoField(z.string()),
	provenance: dynamoField(SaveProvenanceSchema),
	relatedDismissedAt: dynamoField(z.string()),
	relatedDismissedSuggestionId: dynamoField(ReaderArticleHashIdSchema),
});

function toOptionalDate(value: string | undefined): Date | undefined {
	return value ? new Date(value) : undefined;
}

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
		readAt: toOptionalDate(userArticle.readAt),
		sharedAt: toOptionalDate(userArticle.sharedAt),
		provenance: userArticle.provenance,
		relatedDismissedAt: toOptionalDate(userArticle.relatedDismissedAt),
		relatedDismissedSuggestionId: userArticle.relatedDismissedSuggestionId,
	};
}

export function initDynamoDbSavedArticleStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	userArticlesTableName: string;
	logger: HutchLogger;
	now: () => Date;
}): {
	saveArticle: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
	allocateSavedAt: AllocateSavedAt;
	allocateSavedAtSequence: AllocateSavedAtSequence;
	findSavedUrls: FindSavedUrls;
	saveArticleGlobally: SaveArticleGlobally;
	bumpArticleSavedAt: BumpArticleSavedAt;
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	deleteArticle: DeleteArticle;
	deleteAllUserArticles: DeleteAllUserArticles;
	listUserArticleUrls: ListUserArticleUrls;
	updateArticleStatus: UpdateArticleStatus;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	markArticleViewed: MarkArticleViewed;
	markSummaryToggled: MarkSummaryToggled;
	markLinkShared: MarkLinkShared;
	listSharedArticles: ListSharedArticles;
	markRelatedDismissed: MarkRelatedDismissed;
	findUserArticlesByUrl: FindUserArticlesByUrl;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	findUserArticleNotificationState: FindUserArticleNotificationState;
	readContent: ContentProvider;
	saveReadlistArticle: SaveReadlistArticle;
	findReadlistArticles: FindReadlistArticles;
	countReadlistArticles: CountReadlistArticles;
	findReadlistArticleById: FindReadlistArticleById;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
	deleteReadlistArticle: DeleteReadlistArticle;
	markReadlistArticleViewed: MarkReadlistArticleViewed;
	listUserSavesForUrl: ListUserSavesForUrl;
	listUserSavesForUrls: ListUserSavesForUrls;
	assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
	moveReadlistArticles: MoveReadlistArticles;
} {
	const { client, tableName, userArticlesTableName, logger, now } = deps;

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
	const saveCursors = defineDynamoTable({
		client,
		tableName: userArticlesTableName,
		schema: SaveCursorRow,
	});
	const readlistSlugRows = defineDynamoTable({
		client,
		tableName: userArticlesTableName,
		schema: z.object({ queueSlug: ReadlistSlugSchema }),
	});

	const claimWallClockSpan = async (userId: UserId, span: { nowMs: number; endMs: number }): Promise<{ Attributes?: z.infer<typeof SaveCursorRow> }> =>
		saveCursors.update({
			Key: { userId, url: saveCursorUrl(userId) },
			UpdateExpression: "SET savedAtCursorMs = :endMs",
			ConditionExpression: "attribute_not_exists(savedAtCursorMs) OR savedAtCursorMs < :nowMs",
			ExpressionAttributeValues: { ":endMs": span.endMs, ":nowMs": span.nowMs },
			ReturnValues: "UPDATED_NEW",
		});

	const allocateSavedAtSequence: AllocateSavedAtSequence = async ({ userId, count }) => {
		assert(count > 0, "a savedAt sequence allocates at least one instant");
		const nowMs = now().getTime();
		const endMs = nowMs + count - 1;
		const ascendingFrom = (end: number): Date[] =>
			Array.from({ length: count }, (_, i) => new Date(end - count + 1 + i));
		try {
			await claimWallClockSpan(userId, { nowMs, endMs });
			return ascendingFrom(endMs);
		} catch (error) {
			if (!(error instanceof ConditionalCheckFailedException)) throw error;
		}
		try {
			const { Attributes } = await saveCursors.update({
				Key: { userId, url: saveCursorUrl(userId) },
				UpdateExpression: "ADD savedAtCursorMs :count",
				ConditionExpression: "attribute_exists(savedAtCursorMs)",
				ExpressionAttributeValues: { ":count": count },
				ReturnValues: "UPDATED_NEW",
			});
			assertItem(Attributes, "cursor advance must return the advanced cursor");
			return ascendingFrom(Attributes.savedAtCursorMs);
		} catch (error) {
			if (!(error instanceof ConditionalCheckFailedException)) throw error;
			await claimWallClockSpan(userId, { nowMs, endMs });
			return ascendingFrom(endMs);
		}
	};

	const allocateSavedAt: AllocateSavedAt = async ({ userId }) => {
		const [instant] = await allocateSavedAtSequence({ userId, count: 1 });
		assert(instant, "a one-instant sequence yields exactly one instant");
		return instant;
	};

	const findSavedUrls: FindSavedUrls = async ({ userId, urls }) => {
		const identified = urls.map((url) => ({ url, resourceId: ArticleResourceUniqueId.parse(url).value }));
		const rows = await batchGetFromTable({
			client,
			tableName: userArticlesTableName,
			schema: SavedUrlRow,
			keys: [...new Set(identified.map((entry) => entry.resourceId))].map((url) => ({ userId, url })),
			projection: ["url"],
		});
		const savedResourceIds = new Set(rows.map((row) => row.url));
		return identified.filter((entry) => savedResourceIds.has(entry.resourceId)).map((entry) => entry.url);
	};

	async function findArticleByRouteId(routeId: ReaderArticleHashId): Promise<z.infer<typeof ArticleRow> | null> {
		const { items } = await articles.query({
			IndexName: "routeId-index",
			KeyConditionExpression: "routeId = :routeId",
			ExpressionAttributeValues: { ":routeId": routeId.value },
			Limit: 1,
		});
		return items[0] ?? null;
	}

	async function findUserArticle(partition: string, url: string): Promise<z.infer<typeof UserArticleRow> | null> {
		const row = await userArticles.get({ userId: partition, url });
		return row ?? null;
	}

	const saveArticleGlobally: SaveArticleGlobally = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const routeId = ReaderArticleHashId.from(params.url);

		try {
			// A full put replaces the item, so a tombstoned row is revived clean —
			// purgedAt and every content column drop away. Allowed when the row is
			// absent OR tombstoned; a live (non-purged) row still fails the
			// condition so an ordinary re-save stays a no-op upsert (savedAt bump).
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
				ConditionExpression: "attribute_not_exists(#url) OR attribute_exists(purgedAt)",
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

	const initSaveWrite = (userRowCondition: string) => async (
		partition: string,
		params: SaveArticleParams,
	) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const globallySavedAt = now();

		const upsertGlobal = async () => {
			const { created } = await saveArticleGlobally({
				url: params.url,
				metadata: params.metadata,
				estimatedReadTime: params.estimatedReadTime,
				savedAt: globallySavedAt,
			});
			if (!created) {
				await bumpArticleSavedAt({ url: params.url, savedAt: globallySavedAt });
			}
		};

		const writeUserArticleUnlessConditionLost = async (): Promise<{
			createdUserArticle: boolean;
			wroteUserArticle: boolean;
		}> => {
			try {
				const priorUserArticle = await userArticles.update({
					Key: { userId: partition, url: articleResourceUniqueId.value },
					UpdateExpression:
						"SET savedAt = :savedAt, provenance = :provenance, #status = if_not_exists(#status, :unread)",
					ConditionExpression: userRowCondition,
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: {
						":savedAt": params.savedAt.toISOString(),
						":provenance": params.provenance,
						":unread": "unread",
					},
					ReturnValues: "ALL_OLD",
				});
				return { createdUserArticle: priorUserArticle.Attributes === undefined, wroteUserArticle: true };
			} catch (error) {
				if (error instanceof ConditionalCheckFailedException) {
					return { createdUserArticle: false, wroteUserArticle: false };
				}
				throw error;
			}
		};

		const [, { createdUserArticle, wroteUserArticle }] = await Promise.all([
			upsertGlobal(),
			writeUserArticleUnlessConditionLost(),
		]);

		// Strongly-consistent read-your-writes: a default eventually-consistent read
		// can miss the row we just wrote and trip the asserts below on an otherwise
		// successful save. ConsistentRead makes both reflect the writes above.
		const [article, userArticle] = await Promise.all([
			articles.get({ url: articleResourceUniqueId.value }, { consistentRead: true }),
			userArticles.get({ userId: partition, url: articleResourceUniqueId.value }, { consistentRead: true }),
		]);
		assertItem(article, "article must exist immediately after save");
		assertItem(userArticle, "user article must exist immediately after save");

		return {
			saved: toSavedArticle(article, { ...userArticle, userId: params.userId }),
			createdUserArticle,
			wroteUserArticle,
		};
	};

	const writeSave = initSaveWrite("attribute_not_exists(savedAt) OR savedAt < :savedAt");
	const writeSaveKeepingPosition = initSaveWrite("attribute_not_exists(savedAt)");

	const saveArticle: SaveArticle = (params) => writeSave(params.userId, params);
	const saveArticleKeepingPosition: SaveArticle = (params) =>
		writeSaveKeepingPosition(params.userId, params);
	const saveReadlistArticle: SaveReadlistArticle = ({ readlist, ...params }) =>
		writeSave(readlistPartitionValue({ userId: params.userId, readlist }), params);

	const findInPartition = async (
		partition: string,
		userId: UserId,
		routeId: ReaderArticleHashId,
	): Promise<SavedArticle | null> => {
		const article = await findArticleByRouteId(routeId);
		if (!article) return null;

		const userArticle = await findUserArticle(partition, article.url);
		if (!userArticle) return null;

		return toSavedArticle(article, { ...userArticle, userId });
	};

	const findArticleById: FindArticleById = (routeId, userId) =>
		findInPartition(userId, userId, routeId);

	const findReadlistArticleById: FindReadlistArticleById = ({ id, userId, readlist }) =>
		findInPartition(readlistPartitionValue({ userId, readlist }), userId, id);

	const findArticlesInPartition = async (
		partition: string,
		query: FindArticlesQuery,
	): Promise<FindArticlesResult> => {
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;
		const order = query.order ?? "desc";
		const sort = query.sort ?? "savedAt";
		const indexName = sort === "readAt" ? "userId-readAt-index" : "userId-savedAt-index";

		const expressionValues: Record<string, unknown> = {
			":userId": partition,
		};
		let filterExpression: string | undefined;
		let expressionAttributeNames: Record<string, string> | undefined;

		if (query.status) {
			filterExpression = "#status = :status";
			expressionValues[":status"] = query.status;
			expressionAttributeNames = { "#status": "status" };
		}

		let total: number | undefined;
		if (query.includeTotal) {
			let counted = 0;
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
				counted += count;
				countStartKey = lastEvaluatedKey;
			} while (countStartKey);
			total = counted;
		}

		const itemsToSkip = (page - 1) * pageSize;
		const fetchTarget = pageSize + 1;
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
				Limit: fetchTarget,
				ExclusiveStartKey: exclusiveStartKey,
			});

			for (const item of items) {
				if (skippedCount < itemsToSkip) {
					skippedCount++;
				} else if (userArts.length < fetchTarget) {
					userArts.push(item);
				}
			}

			exclusiveStartKey = lastEvaluatedKey;

			if (userArts.length >= fetchTarget && !exclusiveStartKey) {
				break;
			}
		} while (
			exclusiveStartKey &&
			(skippedCount < itemsToSkip || userArts.length < fetchTarget)
		);

		const hasMore = userArts.length > pageSize;
		if (hasMore) {
			userArts.length = pageSize;
		}

		if (userArts.length === 0) {
			return { articles: [], total, hasMore, page, pageSize };
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
				result.push(toSavedArticle(article, { ...ua, userId: query.userId }));
			}
		}

		return { articles: result, total, hasMore, page, pageSize };
	};

	const findArticlesByUser: FindArticlesByUser = (query) =>
		findArticlesInPartition(query.userId, query);

	const findReadlistArticles: FindReadlistArticles = (query) =>
		findArticlesInPartition(readlistPartitionValue({ userId: query.userId, readlist: query.readlist }), query);

	const countArticlesInPartition = async (
		partition: string,
		query: { status?: ArticleStatus; countLimit?: number },
	): Promise<number> => {
		const expressionValues: Record<string, unknown> = { ":userId": partition };
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
		} while (startKey && (query.countLimit === undefined || total < query.countLimit));
		return Math.min(total, query.countLimit ?? total);
	};

	const countArticlesByUser: CountArticlesByUser = (query) =>
		countArticlesInPartition(query.userId, query);

	const countReadlistArticles: CountReadlistArticles = (query) =>
		countArticlesInPartition(readlistPartitionValue({ userId: query.userId, readlist: query.readlist }), query);

	const deleteInPartition = async (
		partition: string,
		routeId: ReaderArticleHashId,
	): Promise<boolean> => {
		const article = await findArticleByRouteId(routeId);
		if (!article) return false;

		try {
			await userArticles.delete({
				Key: { userId: partition, url: article.url },
				ConditionExpression: "attribute_exists(savedAt)",
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return false;
			throw error;
		}
		return true;
	};

	const deleteArticle: DeleteArticle = (routeId, userId) => deleteInPartition(userId, routeId);

	const deleteReadlistArticle: DeleteReadlistArticle = ({ id, userId, readlist }) =>
		deleteInPartition(readlistPartitionValue({ userId, readlist }), id);

	const forEachPartitionRow = (
		partition: string,
		onPage: (rows: z.infer<typeof UserArticleRow>[]) => Promise<void>,
	): Promise<void> =>
		forEachQueryPage(
			userArticles,
			{
				IndexName: "userId-savedAt-index",
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": partition },
			},
			onPage,
		);

	const listUserReadlistSlugs = async (userId: UserId): Promise<ReadlistSlug[]> => {
		const slugs: ReadlistSlug[] = [];
		await forEachQueryPage(
			readlistSlugRows,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":userId": userId,
					":prefix": READLIST_DEFINITION_KEY_PREFIX,
				},
			},
			async (rows) => {
				for (const row of rows) slugs.push(row.queueSlug);
			},
		);
		return slugs;
	};

	const deleteAllUserArticles: DeleteAllUserArticles = async (userId) => {
		const deletePage = async (rows: z.infer<typeof UserArticleRow>[]) => {
			await Promise.all(
				rows.map((row) => userArticles.delete({ Key: { userId: row.userId, url: row.url } })),
			);
		};
		await forEachPartitionRow(userId, deletePage);
		const slugs = await listUserReadlistSlugs(userId);
		for (const slug of slugs) {
			await forEachPartitionRow(readlistPartitionValue({ userId, readlist: slug }), deletePage);
		}
		await Promise.all(
			slugs.map((slug) => userArticles.delete({ Key: { userId, url: readlistDefinitionKey(slug) } })),
		);
		// The save-cursor sentinel carries no savedAt, so the userId-savedAt-index
		// sweep above can never see it; without this delete a userId-bearing row
		// would survive account deletion.
		await saveCursors.delete({ Key: { userId, url: saveCursorUrl(userId) } });
	};

	const listUserArticleUrls: ListUserArticleUrls = async (userId) => {
		const seen = new Set<string>();
		const collect = async (rows: z.infer<typeof UserArticleRow>[]) => {
			for (const row of rows) seen.add(row.url);
		};
		await forEachPartitionRow(userId, collect);
		for (const slug of await listUserReadlistSlugs(userId)) {
			await forEachPartitionRow(readlistPartitionValue({ userId, readlist: slug }), collect);
		}
		const normalizedUrls = [...seen];
		if (normalizedUrls.length === 0) return [];
		// The user-articles row keys the article by its normalized value, which
		// cannot be re-parsed as an absolute URL — resolve each to its stored
		// original via the global row so downstream content ops get a real URL.
		const globals = await batchGetFromTable({
			client,
			tableName,
			schema: z.object({ originalUrl: dynamoField(z.string()) }),
			keys: normalizedUrls.map((url) => ({ url })),
			projection: ["originalUrl"],
		});
		return globals
			.map((row) => row.originalUrl)
			.filter((url): url is string => url !== undefined);
	};

	const updateStatusInPartition = async (
		partition: string,
		userId: UserId,
		routeId: ReaderArticleHashId,
		status: ArticleStatus,
	): Promise<SavedArticle | null> => {
		const article = await findArticleByRouteId(routeId);
		if (!article) return null;

		const expression =
			status === "read"
				? {
						UpdateExpression: "SET #status = :status, readAt = :readAt",
						ExpressionAttributeValues: { ":status": status, ":readAt": new Date().toISOString() },
					}
				: {
						UpdateExpression: "SET #status = :status REMOVE readAt",
						ExpressionAttributeValues: { ":status": status },
					};

		try {
			const { Attributes } = await userArticles.update({
				Key: { userId: partition, url: article.url },
				ConditionExpression: "attribute_exists(savedAt)",
				ExpressionAttributeNames: { "#status": "status" },
				ReturnValues: "ALL_NEW",
				...expression,
			});
			assertItem(Attributes, "ReturnValues ALL_NEW must return the updated user-article row");
			return toSavedArticle(article, { ...Attributes, userId });
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return null;
			throw error;
		}
	};

	const updateArticleStatus: UpdateArticleStatus = (routeId, userId, status) =>
		updateStatusInPartition(userId, userId, routeId, status);

	const updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists = async ({
		id,
		userId,
		addressed,
		status,
	}) => {
		const updated = await updateStatusInPartition(
			partitionFor({ userId, readlist: addressed }),
			userId,
			id,
			status,
		);
		if (!updated) return null;
		const saves = await listUserSavesForUrl({ userId, url: updated.url });
		await Promise.all(
			saves
				.map((save) => save.readlist ?? DEFAULT_READLIST_SLUG)
				.filter((slug) => slug !== addressed)
				.map((slug) =>
					updateStatusInPartition(partitionFor({ userId, readlist: slug }), userId, id, status),
				),
		);
		return updated;
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
		partition: string;
		url: string;
		updateExpression: string;
		at: Date;
		values?: Record<string, string>;
	}): Promise<void> {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(stamp.url);
		try {
			await userArticles.update({
				Key: { userId: stamp.partition, url: articleResourceUniqueId.value },
				UpdateExpression: stamp.updateExpression,
				ConditionExpression: "attribute_exists(savedAt)",
				ExpressionAttributeValues: { ":at": stamp.at.toISOString(), ...stamp.values },
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
		await stampUserArticleIfStillSaved({ partition: userId, url, at, updateExpression: "SET viewedAt = :at" });
	};

	const markReadlistArticleViewed: MarkReadlistArticleViewed = async ({ userId, readlist, url, at }) => {
		await stampUserArticleIfStillSaved({
			partition: readlistPartitionValue({ userId, readlist }),
			url,
			at,
			updateExpression: "SET viewedAt = :at",
		});
	};

	const markSummaryToggled: MarkSummaryToggled = async ({ userId, url, state, at }) => {
		const attribute = state === "open" ? "lastSummaryOpenedAt" : "lastSummaryClosedAt";
		await stampUserArticleIfStillSaved({ partition: userId, url, at, updateExpression: `SET ${attribute} = :at` });
	};

	const markLinkShared: MarkLinkShared = async ({ userId, url, at }) => {
		await stampUserArticleIfStillSaved({ partition: userId, url, at, updateExpression: "SET sharedAt = :at" });
	};

	const listSharedArticles: ListSharedArticles = async ({ userId }) => {
		const sharedRows: z.infer<typeof UserArticleRow>[] = [];
		await forEachQueryPage(
			userArticles,
			{
				IndexName: "userId-savedAt-index",
				KeyConditionExpression: "userId = :userId",
				FilterExpression: "attribute_exists(sharedAt)",
				ExpressionAttributeValues: { ":userId": userId },
			},
			async (rows) => {
				for (const row of rows) sharedRows.push(row);
			},
		);
		if (sharedRows.length === 0) return [];

		const batchedArticles = await batchGetFromTable({
			client,
			tableName,
			schema: ArticleRow,
			keys: sharedRows.map((ua) => ({ url: ua.url })),
			projection: ArticleMetadataFields,
		});
		const articlesByUrl = new Map<string, z.infer<typeof ArticleRow>>();
		for (const article of batchedArticles) {
			articlesByUrl.set(article.url, article);
		}

		const result: SavedArticle[] = [];
		for (const ua of sharedRows) {
			const article = articlesByUrl.get(ua.url);
			if (article) {
				result.push(toSavedArticle(article, { ...ua, userId }));
			}
		}
		result.sort((a, b) => {
			assert(a.sharedAt, "a shared article must carry sharedAt");
			assert(b.sharedAt, "a shared article must carry sharedAt");
			return b.sharedAt.getTime() - a.sharedAt.getTime();
		});
		return result;
	};

	const markRelatedDismissed: MarkRelatedDismissed = async ({
		userId,
		url,
		at,
		suggestionId,
	}) => {
		const expression = suggestionId
			? {
					updateExpression:
						"SET relatedDismissedAt = :at, relatedDismissedSuggestionId = :suggestionId",
					values: { ":suggestionId": suggestionId.value },
				}
			: {
					updateExpression:
						"SET relatedDismissedAt = :at REMOVE relatedDismissedSuggestionId",
				};
		await stampUserArticleIfStillSaved({ partition: userId, url, at, ...expression });
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

		const savers: { userId: UserId; viewedAt?: Date }[] = [];
		for (const row of rows) {
			const { userId, readlist } = decodeUserArticlePartition(row.userId);
			if (readlist !== undefined) continue;
			savers.push({ userId, viewedAt: toOptionalDate(row.viewedAt) });
		}
		return savers;
	};

	const listUserSavesForUrl: ListUserSavesForUrl = async ({ userId, url }) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const slugs = await listUserReadlistSlugs(userId);
		const rows = await batchGetFromTable({
			client,
			tableName: userArticlesTableName,
			schema: z.object({ userId: z.string() }),
			keys: [
				{ userId, url: articleResourceUniqueId.value },
				...slugs.map((slug) => ({
					userId: readlistPartitionValue({ userId, readlist: slug }),
					url: articleResourceUniqueId.value,
				})),
			],
			projection: ["userId"],
		});
		return rows.map((row) => {
			const { readlist } = decodeUserArticlePartition(row.userId);
			return readlist === undefined ? {} : { readlist };
		});
	};

	const listUserSavesForUrls: ListUserSavesForUrls = async ({ userId, urls }) => {
		const slugs = await listUserReadlistSlugs(userId);
		const partitions = [
			userId,
			...slugs.map((slug) => readlistPartitionValue({ userId, readlist: slug })),
		];
		const normalizedUrls = [
			...new Set(urls.map((url) => ArticleResourceUniqueId.parse(url).value)),
		];
		const rows = await batchGetFromTable({
			client,
			tableName: userArticlesTableName,
			schema: z.object({ userId: z.string(), url: z.string() }),
			keys: normalizedUrls.flatMap((url) =>
				partitions.map((partition) => ({ userId: partition, url })),
			),
			projection: ["userId", "url"],
		});
		const byNormalizedUrl = new Map<string, { readlist?: ReadlistSlug }[]>();
		for (const row of rows) {
			const { readlist } = decodeUserArticlePartition(row.userId);
			const saves = byNormalizedUrl.get(row.url) ?? [];
			saves.push(readlist === undefined ? {} : { readlist });
			byNormalizedUrl.set(row.url, saves);
		}
		return new Map(
			urls.map((url) => [
				url,
				byNormalizedUrl.get(ArticleResourceUniqueId.parse(url).value) ?? [],
			]),
		);
	};

	const assignSavedArticleToReadlist: AssignSavedArticleToReadlist = async ({
		userId,
		readlist,
		url,
		savedAt,
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const source = await findUserArticle(userId, articleResourceUniqueId.value);
		if (!source) return { assigned: false };
		try {
			await userArticles.put({
				Item: {
					userId: readlistPartitionValue({ userId, readlist }),
					url: articleResourceUniqueId.value,
					status: source.status,
					savedAt: savedAt.toISOString(),
					...(source.readAt === undefined ? {} : { readAt: source.readAt }),
					...(source.provenance === undefined ? {} : { provenance: source.provenance }),
				},
				ConditionExpression: "attribute_not_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
			});
			return { assigned: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return { assigned: false };
			throw error;
		}
	};

	const copyRowInto = async (
		partition: string,
		row: z.infer<typeof UserArticleRow>,
	): Promise<boolean> => {
		const attributes = Object.fromEntries(
			Object.entries(row).filter(([, value]) => value !== undefined),
		);
		try {
			await userArticles.put({
				Item: { ...attributes, userId: partition },
				ConditionExpression: "attribute_not_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return false;
			throw error;
		}
		return true;
	};

	const moveReadlistArticles: MoveReadlistArticles = async ({ userId, from, to }) => {
		const source = readlistPartitionValue({ userId, readlist: from });
		const destination = readlistPartitionValue({ userId, readlist: to });
		let moved = 0;
		await forEachPartitionRow(source, async (rows) => {
			const copied = await Promise.all(
				rows.map(async (row) => {
					const landed = await copyRowInto(destination, row);
					await userArticles.delete({ Key: { userId: source, url: row.url } });
					return landed;
				}),
			);
			moved += copied.filter(Boolean).length;
		});
		return { moved };
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
			viewedAt: toOptionalDate(row.viewedAt),
			emailSentAt: toOptionalDate(row.emailSentAt),
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
					"purgedAt",
					"readerAvailableAt",
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
			purgedAt: toOptionalDate(row.purgedAt),
			readerAvailableAt: toOptionalDate(row.readerAvailableAt),
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
		saveArticleKeepingPosition,
		allocateSavedAt,
		allocateSavedAtSequence,
		findSavedUrls,
		saveArticleGlobally,
		bumpArticleSavedAt,
		findArticleById,
		findArticleByUrl,
		findArticleUrlById,
		findArticlesByUser,
		countArticlesByUser,
		deleteArticle,
		deleteAllUserArticles,
		listUserArticleUrls,
		updateArticleStatus,
		findArticleFreshness,
		findArticleCrawlVersions,
		markArticleViewed,
		markSummaryToggled,
		markLinkShared,
		listSharedArticles,
		markRelatedDismissed,
		findUserArticlesByUrl,
		markReaderReadyEmailSent,
		findUserArticleNotificationState,
		readContent,
		saveReadlistArticle,
		findReadlistArticles,
		countReadlistArticles,
		findReadlistArticleById,
		updateArticleStatusAcrossReadlists,
		deleteReadlistArticle,
		markReadlistArticleViewed,
		listUserSavesForUrl,
		listUserSavesForUrls,
		assignSavedArticleToReadlist,
		moveReadlistArticles,
	};
}
