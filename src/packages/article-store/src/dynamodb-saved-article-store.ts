import {
	type DynamoDBDocumentClient,
	assembleRowUpdate,
	assertItem,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
	writeIfCondition,
} from "@packages/storage-client";
import { EnclosureSchema } from "@packages/media-contracts";
import { z } from "zod";
import { VerificationFields, isUnverifiedWrapperContent } from "./verified-content";
import { ServedBodyFields, servedBodyOf } from "./served-body";
import type { ArticleDiscoveryQuery, ArticleStatus, SavedArticle } from "@packages/domain/article";
import {
	MinutesSchema,
	ArticleStatusSchema,
	SaveProvenanceSchema,
	SuggestionAttributionSchema,
	articleDestinationUrl,
	articleDisplayMetadata,
	discoveryCandidateOf,
	matchesArticleDiscovery,
	ANONYMOUS_VIEWER,
	viewerFor,
} from "@packages/domain/article";
import type { FindPersonalLibrary } from "@packages/provider-contracts/engagement-starter";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { StoredCrawlVersionSchema, normalizeCrawlVersion } from "./crawl-version-log";
import { CONTENT_BEARING_COLUMNS } from "./tombstone-article";
import { ItemMediaSchema, ReaderArticleHashId, ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { Logger } from "@packages/logger";
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
	FindArticlesAcrossReadlists,
	FindArticlesByUser,
	FindArticlesQuery,
	FindArticlesResult,
	FindReadlistArticleById,
	FindReadlistArticles,
	FindUnreadSavesForDigest,
	FindUserArticlesByUrl,
	MarkArticleViewed,
	MarkReadlistArticleViewed,
	MarkReaderReadyEmailSent,
	MarkRelatedDismissed,
	MarkSummaryToggled,
	SaveArticle,
	SaveArticleGlobally,
	SaveArticleParams,
	SaveReadlistArticle,
	SortField,
	SortOrder,
	UpdateArticleStatus,
	UpdateArticleStatusAcrossReadlists,
} from "@packages/provider-contracts/article-store";
import {
	ArticlePurgedAfterRequest,
	DigestPageCursorSchema,
	type ContentProvider,
	type HasSaveLandedSince,
	type SaveArticleAsRequested,
	type SaveReadlistArticleAsRequested,
} from "@packages/provider-contracts/article-store";
import {
	READLIST_DEFINITION_KEY_PREFIX,
	READLIST_FIT_OVERRIDE_KEY_PREFIX,
	decodeUserArticlePartition,
	partitionFor,
	readlistDefinitionKey,
	readlistPartitionValue,
} from "./user-readlist-partition";

const ArticleContentRow = z.object({
	content: dynamoField(z.string()),
	...VerificationFields,
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
	...ServedBodyFields,
	url: z.string(),
	routeId: ReaderArticleHashIdSchema,
	originalUrl: z.string(),
	title: z.string(),
	siteName: z.string(),
	excerpt: z.string(),
	wordCount: z.number(),
	imageUrl: dynamoField(z.string()),
	publishedOn: dynamoField(z.string()),
	content: dynamoField(z.string()),
	estimatedReadTime: MinutesSchema,
	savedAt: dynamoField(z.string()),
	readerAvailableAt: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
	ownerUserId: dynamoField(UserIdSchema),
	media: dynamoField(ItemMediaSchema),
	processingNotice: dynamoField(z.string()),
	enclosure: dynamoField(EnclosureSchema),
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

const DigestPageKey = z.record(z.string(), z.unknown());

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
	provenance: dynamoField(SaveProvenanceSchema),
	suggestionAttribution: dynamoField(SuggestionAttributionSchema),
	relatedDismissedAt: dynamoField(z.string()),
	relatedDismissedSuggestionId: dynamoField(ReaderArticleHashIdSchema),
});

function digestIndexKeyOfLast(rows: z.infer<typeof UserArticleRow>[]): Record<string, unknown> {
	const last = rows.at(-1);
	assert(last, "a digest page cut at its limit keeps at least one row");
	return { userId: last.userId, url: last.url, savedAt: last.savedAt };
}

function toOptionalDate(value: string | undefined): Date | undefined {
	return value ? new Date(value) : undefined;
}

const PERSONAL_PROVENANCE_FILTER =
	"(attribute_not_exists(provenance.#kind) OR (provenance.#kind <> :suggestion AND provenance.#kind <> :seed))";

function toSavedArticle(
	article: z.infer<typeof ArticleRow>,
	userArticle: z.infer<typeof UserArticleRow>,
): SavedArticle {
	const destinationUrl = articleDestinationUrl({ url: article.originalUrl, displayUrl: article.displayUrl });
	return {
		id: article.routeId,
		userId: userArticle.userId,
		url: article.originalUrl,
		destinationUrl,
		metadata: articleDisplayMetadata({
			url: article.originalUrl,
			destinationUrl,
			title: article.title,
			siteName: article.siteName,
			excerpt: article.excerpt,
			wordCount: article.wordCount,
			imageUrl: article.imageUrl,
			publishedOn: article.publishedOn,
			viewer: viewerFor(userArticle.userId),
			ownerUserId: article.ownerUserId,
		}),
		content: isUnverifiedWrapperContent(article) ? undefined : article.content,
		servedBody: servedBodyOf(article),
		estimatedReadTime: article.estimatedReadTime,
		status: userArticle.status,
		savedAt: new Date(userArticle.savedAt),
		readAt: toOptionalDate(userArticle.readAt),
		viewedAt: toOptionalDate(userArticle.viewedAt),
		contentFetchedAt: toOptionalDate(article.contentFetchedAt),
		provenance: userArticle.provenance,
		suggestionAttribution: userArticle.suggestionAttribution,
		relatedDismissedAt: toOptionalDate(userArticle.relatedDismissedAt),
		relatedDismissedSuggestionId: userArticle.relatedDismissedSuggestionId,
		media: article.media,
		processingNotice: article.processingNotice,
		ownerUserId: article.ownerUserId,
		enclosure: article.enclosure,
	};
}

export function initDynamoDbSavedArticleStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	userArticlesTableName: string;
	logger: Logger;
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
	findArticlesAcrossReadlists: FindArticlesAcrossReadlists;
	findPersonalLibrary: FindPersonalLibrary;
	countArticlesByUser: CountArticlesByUser;
	deleteArticle: DeleteArticle;
	deleteAllUserArticles: DeleteAllUserArticles;
	listUserArticleUrls: ListUserArticleUrls;
	updateArticleStatus: UpdateArticleStatus;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	markArticleViewed: MarkArticleViewed;
	markSummaryToggled: MarkSummaryToggled;
	markRelatedDismissed: MarkRelatedDismissed;
	findUserArticlesByUrl: FindUserArticlesByUrl;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	findUnreadSavesForDigest: FindUnreadSavesForDigest;
	readContent: ContentProvider;
	saveReadlistArticle: SaveReadlistArticle;
	saveArticleAsRequested: SaveArticleAsRequested;
	saveReadlistArticleAsRequested: SaveReadlistArticleAsRequested;
	hasSaveLandedSince: HasSaveLandedSince;
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
	const readlistFitOverrideRows = defineDynamoTable({
		client,
		tableName: userArticlesTableName,
		schema: z.object({ userId: z.string(), url: z.string() }),
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
		const claimed = await writeIfCondition(() => claimWallClockSpan(userId, { nowMs, endMs }));
		if (claimed.kind === "written") return ascendingFrom(endMs);
		const advanced = await writeIfCondition(() =>
			saveCursors.update({
				Key: { userId, url: saveCursorUrl(userId) },
				UpdateExpression: "ADD savedAtCursorMs :count",
				ConditionExpression: "attribute_exists(savedAtCursorMs)",
				ExpressionAttributeValues: { ":count": count },
				ReturnValues: "UPDATED_NEW",
			}),
		);
		if (advanced.kind === "condition-failed") {
			await claimWallClockSpan(userId, { nowMs, endMs });
			return ascendingFrom(endMs);
		}
		assertItem(advanced.result.Attributes, "cursor advance must return the advanced cursor");
		return ascendingFrom(advanced.result.Attributes.savedAtCursorMs);
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

	const upsertArticleRowWhen = async ({
		params,
		condition,
		conditionValues,
	}: {
		params: Parameters<SaveArticleGlobally>[0];
		condition: string;
		conditionValues: Record<string, string>;
	}): Promise<{ created: boolean }> => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const routeId = ReaderArticleHashId.from(params.url);

		const outcome = await writeIfCondition(() =>
			articles.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: `SET routeId = :routeId, originalUrl = :originalUrl, title = :title, siteName = :siteName, excerpt = :excerpt, wordCount = :wordCount, imageUrl = :imageUrl, publishedOn = :publishedOn, estimatedReadTime = :estimatedReadTime, savedAt = :savedAt ADD contentSelectionRevision :one REMOVE ${[...CONTENT_BEARING_COLUMNS.filter((column) => column !== "imageUrl" && column !== "publishedOn"), "purgedAt", "crawlStatus", "summaryStatus", "summarySkippedReason", "readerAvailableAt"].join(", ")}`,
				ExpressionAttributeValues: {
					":routeId": routeId.value,
					":originalUrl": params.url,
					":title": params.metadata.title,
					":siteName": params.metadata.siteName,
					":excerpt": params.metadata.excerpt,
					":wordCount": params.metadata.wordCount,
					":imageUrl": params.metadata.imageUrl ?? null,
					":publishedOn": params.metadata.publishedOn ?? null,
					":estimatedReadTime": params.estimatedReadTime,
					":savedAt": params.savedAt.toISOString(),
					":one": 1,
					...conditionValues,
				},
				ConditionExpression: condition,
				ExpressionAttributeNames: { "#url": "url" },
			}),
		);
		if (outcome.kind === "condition-failed") return { created: false };
		return { created: true };
	};

	const saveArticleGlobally: SaveArticleGlobally = (params) =>
		upsertArticleRowWhen({
			params,
			condition: "attribute_not_exists(#url) OR attribute_exists(purgedAt)",
			conditionValues: {},
		});

	const bumpArticleSavedAt: BumpArticleSavedAt = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		await writeIfCondition(() =>
			articles.update({
				Key: { url: articleResourceUniqueId.value },
				UpdateExpression: "SET savedAt = :savedAt",
				ConditionExpression: "attribute_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":savedAt": params.savedAt.toISOString(),
				},
			}),
		);
	};

	const writeUserArticleUnlessConditionLost = async ({
		partition,
		params,
		condition,
		conditionValues,
	}: {
		partition: string;
		params: SaveArticleParams;
		condition: string;
		conditionValues: Record<string, string>;
	}): Promise<{ createdUserArticle: boolean; wroteUserArticle: boolean }> => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const outcome = await writeIfCondition(() =>
			userArticles.update({
				Key: { userId: partition, url: articleResourceUniqueId.value },
				UpdateExpression: `SET savedAt = :savedAt, provenance = :provenance, #status = if_not_exists(#status, :unread)${
					params.suggestionAttribution === undefined
						? ""
						: ", suggestionAttribution = if_not_exists(suggestionAttribution, :attribution)"
				}`,
				ConditionExpression: condition,
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					":savedAt": params.savedAt.toISOString(),
					":provenance": params.provenance,
					":unread": "unread",
					...(params.suggestionAttribution === undefined
						? {}
						: { ":attribution": params.suggestionAttribution }),
					...conditionValues,
				},
				ReturnValues: "ALL_OLD",
			}),
		);
		if (outcome.kind === "condition-failed") return { createdUserArticle: false, wroteUserArticle: false };
		return { createdUserArticle: outcome.result.Attributes === undefined, wroteUserArticle: true };
	};

	const readBackSave = async ({
		partition,
		params,
		written,
	}: {
		partition: string;
		params: SaveArticleParams;
		written: { createdUserArticle: boolean; wroteUserArticle: boolean };
	}): ReturnType<SaveArticle> => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
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
			...written,
		};
	};

	const initSaveWrite = (userRowCondition: string) => async (
		partition: string,
		params: SaveArticleParams,
	) => {
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

		const [, written] = await Promise.all([
			upsertGlobal(),
			writeUserArticleUnlessConditionLost({ partition, params, condition: userRowCondition, conditionValues: {} }),
		]);

		return readBackSave({ partition, params, written });
	};

	const writeSaveAsRequested = async (
		partition: string,
		{ requestedAt, ...params }: SaveArticleParams & { requestedAt: Date },
	): ReturnType<SaveArticle> => {
		const requested = { ":requestedAt": requestedAt.toISOString() };
		const globallySavedAt = now();
		const { created } = await upsertArticleRowWhen({
			params: {
				url: params.url,
				metadata: params.metadata,
				estimatedReadTime: params.estimatedReadTime,
				savedAt: globallySavedAt,
			},
			condition: "attribute_not_exists(#url) OR purgedAt < :requestedAt",
			conditionValues: requested,
		});
		if (!created) {
			const bumped = await writeIfCondition(() =>
				articles.update({
					Key: { url: ArticleResourceUniqueId.parse(params.url).value },
					UpdateExpression: "SET savedAt = :savedAt",
					ConditionExpression: "attribute_exists(#url) AND attribute_not_exists(purgedAt)",
					ExpressionAttributeNames: { "#url": "url" },
					ExpressionAttributeValues: { ":savedAt": globallySavedAt.toISOString() },
				}),
			);
			if (bumped.kind === "condition-failed") throw new ArticlePurgedAfterRequest(params.url);
		}
		const written = await writeUserArticleUnlessConditionLost({
			partition,
			params,
			condition:
				"(attribute_not_exists(savedAt) OR savedAt < :requestedAt) AND (attribute_not_exists(readAt) OR readAt < :requestedAt)",
			conditionValues: requested,
		});
		return readBackSave({ partition, params, written });
	};

	const writeSave = initSaveWrite("attribute_not_exists(savedAt) OR savedAt < :savedAt");
	const writeSaveKeepingPosition = initSaveWrite("attribute_not_exists(savedAt)");

	const saveArticle: SaveArticle = (params) => writeSave(params.userId, params);
	const saveArticleKeepingPosition: SaveArticle = (params) =>
		writeSaveKeepingPosition(params.userId, params);
	const saveReadlistArticle: SaveReadlistArticle = ({ readlist, ...params }) =>
		writeSave(readlistPartitionValue({ userId: params.userId, readlist }), params);
	const saveArticleAsRequested: SaveArticleAsRequested = (params) => writeSaveAsRequested(params.userId, params);
	const saveReadlistArticleAsRequested: SaveReadlistArticleAsRequested = ({ readlist, ...params }) =>
		writeSaveAsRequested(readlistPartitionValue({ userId: params.userId, readlist }), params);

	const hasSaveLandedSince: HasSaveLandedSince = async ({ userId, url, requestedAt }) => {
		const row = await userArticles.get(
			{ userId, url: ArticleResourceUniqueId.parse(url).value },
			{ consistentRead: true },
		);
		return row !== undefined && new Date(row.savedAt) >= requestedAt;
	};

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

	const discoveredRowsInPartition = async (
		partition: string,
		query: {
			userId: UserId;
			status?: ArticleStatus;
			sort?: SortField;
			order?: SortOrder;
			discovery: ArticleDiscoveryQuery;
		},
	): Promise<SavedArticle[]> => {
		const startedAt = now();
		const statusFilter = query.status
			? {
					FilterExpression: "#status = :status",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":userId": partition, ":status": query.status },
				}
			: { ExpressionAttributeValues: { ":userId": partition } };
		const userArticleRows: z.infer<typeof UserArticleRow>[] = [];
		await forEachQueryPage(
			userArticles,
			{
				IndexName: query.sort === "readAt" ? "userId-readAt-index" : "userId-savedAt-index",
				KeyConditionExpression: "userId = :userId",
				ScanIndexForward: query.order === "asc",
				...statusFilter,
			},
			async (rows) => {
				userArticleRows.push(...rows);
			},
		);
		const globalRows = await batchGetFromTable({
			client,
			tableName,
			schema: ArticleRow,
			keys: userArticleRows.map((row) => ({ url: row.url })),
			projection: ArticleMetadataFields,
		});
		const globalRowsByUrl = new Map(globalRows.map((row) => [row.url, row]));
		const candidates: SavedArticle[] = [];
		for (const userArticle of userArticleRows) {
			const row = globalRowsByUrl.get(userArticle.url);
			if (row === undefined) continue;
			candidates.push(toSavedArticle(row, { ...userArticle, userId: query.userId }));
		}
		const matched = candidates.filter((article) =>
			matchesArticleDiscovery(discoveryCandidateOf(article), query.discovery),
		);
		logger.info(
			JSON.stringify({
				event: "article-store.discovery",
				partitionRows: userArticleRows.length,
				matched: matched.length,
				durationMs: now().getTime() - startedAt.getTime(),
			}),
		);
		return matched;
	};

	const findArticlesInPartition = async (
		partition: string,
		query: FindArticlesQuery,
	): Promise<FindArticlesResult> => {
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;
		if (query.discovery) {
			const matched = await discoveredRowsInPartition(partition, {
				...query,
				discovery: query.discovery,
			});
			const start = (page - 1) * pageSize;
			return {
				articles: matched.slice(start, start + pageSize),
				total: matched.length,
				hasMore: matched.length > start + pageSize,
				page,
				pageSize,
			};
		}
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

		const joined = await joinGlobalArticles({
			userArticleRows: userArts,
			projection: query.excludeContent ? ArticleMetadataFields : undefined,
		});
		const result = joined.map(({ article, userArticle }) =>
			toSavedArticle(article, { ...userArticle, userId: query.userId }),
		);

		return { articles: result, total, hasMore, page, pageSize };
	};

	const joinGlobalArticles = async (params: {
		userArticleRows: z.infer<typeof UserArticleRow>[];
		projection: readonly (keyof z.infer<typeof ArticleRow>)[] | undefined;
	}): Promise<{ article: z.infer<typeof ArticleRow>; userArticle: z.infer<typeof UserArticleRow> }[]> => {
		const batchedArticles = await batchGetFromTable({
			client,
			tableName,
			schema: ArticleRow,
			keys: params.userArticleRows.map((ua) => ({ url: ua.url })),
			projection: params.projection,
		});

		const articlesByUrl = new Map<string, z.infer<typeof ArticleRow>>();
		for (const article of batchedArticles) {
			articlesByUrl.set(article.url, article);
		}

		const joined: { article: z.infer<typeof ArticleRow>; userArticle: z.infer<typeof UserArticleRow> }[] = [];
		for (const userArticle of params.userArticleRows) {
			const article = articlesByUrl.get(userArticle.url);
			if (article) {
				joined.push({ article, userArticle });
			}
		}
		return joined;
	};

	const findUnreadSavesForDigest: FindUnreadSavesForDigest = async ({
		userId,
		savedAtOrBefore,
		emailFilter,
		limit,
		cursor,
	}) => {
		const emailSentAtFilter =
			emailFilter.kind === "not-emailed-before"
				? {
						expression: " AND (attribute_not_exists(emailSentAt) OR emailSentAt = :sendInstant)",
						values: { ":sendInstant": emailFilter.sendInstant.toISOString() },
					}
				: { expression: "", values: {} };

		const { items, lastEvaluatedKey } = await userArticles.query({
			IndexName: "userId-savedAt-index",
			KeyConditionExpression: "userId = :userId AND savedAt <= :cutoff",
			FilterExpression: `#status = :unread AND ${PERSONAL_PROVENANCE_FILTER}${emailSentAtFilter.expression}`,
			ExpressionAttributeNames: { "#status": "status", "#kind": "kind" },
			ExpressionAttributeValues: {
				":userId": userId,
				":cutoff": savedAtOrBefore.toISOString(),
				":unread": "unread",
				":suggestion": "hn-suggestion",
				":seed": "founder-seed",
				...emailSentAtFilter.values,
			},
			ScanIndexForward: false,
			ExclusiveStartKey: cursor === undefined ? undefined : DigestPageKey.parse(JSON.parse(cursor)),
		});
		const rows = items.slice(0, limit);
		const resumeAfter = items.length > limit ? digestIndexKeyOfLast(rows) : lastEvaluatedKey;

		const joined = await joinGlobalArticles({ userArticleRows: rows, projection: ArticleMetadataFields });
		return {
			candidates: joined.map(({ article, userArticle }) => ({
				article: toSavedArticle(article, userArticle),
				emailSentAt: toOptionalDate(userArticle.emailSentAt),
				readerAvailableAt: toOptionalDate(article.readerAvailableAt),
				purgedAt: toOptionalDate(article.purgedAt),
			})),
			nextCursor:
				resumeAfter === undefined ? undefined : DigestPageCursorSchema.parse(JSON.stringify(resumeAfter)),
		};
	};

	const findArticlesByUser: FindArticlesByUser = (query) =>
		findArticlesInPartition(query.userId, query);

	const findReadlistArticles: FindReadlistArticles = (query) =>
		findArticlesInPartition(readlistPartitionValue({ userId: query.userId, readlist: query.readlist }), query);

	const readlistDefinitionRows = defineDynamoTable({
		client,
		tableName: userArticlesTableName,
		schema: z.object({ queueSlug: ReadlistSlugSchema, createdAt: z.string() }),
	});

	const ownedReadlistSlugsInCreationOrder = async (userId: UserId): Promise<ReadlistSlug[]> => {
		const rows: { slug: ReadlistSlug; createdAt: string }[] = [];
		await forEachQueryPage(
			readlistDefinitionRows,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":userId": userId,
					":prefix": READLIST_DEFINITION_KEY_PREFIX,
				},
				ConsistentRead: true,
			},
			async (items) => {
				for (const item of items) rows.push({ slug: item.queueSlug, createdAt: item.createdAt });
			},
		);
		return rows
			.sort(
				(a, b) =>
					new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
					a.slug.localeCompare(b.slug),
			)
			.map((row) => row.slug);
	};

	const findArticlesAcrossReadlists: FindArticlesAcrossReadlists = async (query) => {
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? 20;
		const order = query.order ?? "desc";
		const sort = query.sort ?? "savedAt";

		const partitions = [
			query.userId,
			...(await ownedReadlistSlugsInCreationOrder(query.userId)).map((slug) =>
				readlistPartitionValue({ userId: query.userId, readlist: slug }),
			),
		];

		const byUrl = new Map<
			string,
			{ representative: z.infer<typeof UserArticleRow>; latestSavedAt: Date }
		>();
		for (const partition of partitions) {
			await forEachPartitionRow(partition, async (rows) => {
				for (const row of rows) {
					const savedAt = new Date(row.savedAt);
					const existing = byUrl.get(row.url);
					if (existing === undefined) {
						byUrl.set(row.url, { representative: row, latestSavedAt: savedAt });
					} else if (savedAt.getTime() > existing.latestSavedAt.getTime()) {
						existing.latestSavedAt = savedAt;
					}
				}
			});
		}

		let entries = [...byUrl.values()].map((entry) => ({
			representative: entry.representative,
			latestSavedAt: entry.latestSavedAt,
			id: ReaderArticleHashId.fromResourceUniqueId(entry.representative.url).value,
		}));
		if (query.status) {
			entries = entries.filter((entry) => entry.representative.status === query.status);
		}
		entries.sort((a, b) => {
			const aValue = sort === "readAt" ? toOptionalDate(a.representative.readAt) : a.latestSavedAt;
			const bValue = sort === "readAt" ? toOptionalDate(b.representative.readAt) : b.latestSavedAt;
			assert(aValue, "sort field must be set on every row matching this query");
			assert(bValue, "sort field must be set on every row matching this query");
			const diff = aValue.getTime() - bValue.getTime();
			if (diff !== 0) return order === "asc" ? diff : -diff;
			return a.id.localeCompare(b.id);
		});

		const total = query.includeTotal ? entries.length : undefined;
		const start = (page - 1) * pageSize;
		const pageEntries = entries.slice(start, start + pageSize);
		const hasMore = entries.length > start + pageSize;
		if (pageEntries.length === 0) {
			return { articles: [], total, hasMore, page, pageSize };
		}

		const batchedArticles = await batchGetFromTable({
			client,
			tableName,
			schema: ArticleRow,
			keys: pageEntries.map((entry) => ({ url: entry.representative.url })),
			projection: query.excludeContent ? ArticleMetadataFields : undefined,
		});
		const articlesByUrl = new Map<string, z.infer<typeof ArticleRow>>();
		for (const article of batchedArticles) articlesByUrl.set(article.url, article);

		const articles: SavedArticle[] = [];
		for (const entry of pageEntries) {
			const article = articlesByUrl.get(entry.representative.url);
			assert(article, "every saved row has a global article");
			articles.push(
				toSavedArticle(article, {
					...entry.representative,
					userId: query.userId,
					savedAt: entry.latestSavedAt.toISOString(),
				}),
			);
		}
		return { articles, total, hasMore, page, pageSize };
	};

	const findPersonalLibrary: FindPersonalLibrary = async (userId) => {
		const urls = new Set<string>();
		const personal = new Set<string>();
		const readlists = await ownedReadlistSlugsInCreationOrder(userId);
		const partitions = [
			userId,
			...readlists.map((readlist) => readlistPartitionValue({ userId, readlist })),
		];
		for (const partition of partitions) {
			await forEachQueryPage(
				userArticles,
				{
					KeyConditionExpression: "userId = :userId",
					FilterExpression: "attribute_exists(savedAt) AND attribute_exists(#status)",
					ExpressionAttributeNames: { "#status": "status" },
					ExpressionAttributeValues: { ":userId": partition },
					ConsistentRead: true,
				},
				async (rows) => {
					for (const row of rows) {
						urls.add(row.url);
						if (row.provenance?.kind !== "hn-suggestion" && row.provenance?.kind !== "founder-seed") {
							personal.add(row.url);
						}
					}
				},
			);
		}
		return { urls: [...urls], personalCount: personal.size };
	};

	const countArticlesInPartition = async (
		partition: string,
		query: { userId: UserId; status?: ArticleStatus; countLimit?: number; discovery?: ArticleDiscoveryQuery },
	): Promise<number> => {
		if (query.discovery) {
			const matched = await discoveredRowsInPartition(partition, { ...query, discovery: query.discovery });
			return Math.min(matched.length, query.countLimit ?? matched.length);
		}
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

		const outcome = await writeIfCondition(() =>
			userArticles.delete({
				Key: { userId: partition, url: article.url },
				ConditionExpression: "attribute_exists(savedAt)",
			}),
		);
		if (outcome.kind === "condition-failed") return false;
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
		await forEachQueryPage(
			readlistFitOverrideRows,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":userId": userId,
					":prefix": READLIST_FIT_OVERRIDE_KEY_PREFIX,
				},
			},
			async (rows) => {
				await Promise.all(
					rows.map((row) => readlistFitOverrideRows.delete({ Key: { userId: row.userId, url: row.url } })),
				);
			},
		);
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
						UpdateExpression: "SET #status = :status, readAt = if_not_exists(readAt, :readAt)",
						ExpressionAttributeValues: { ":status": status, ":readAt": new Date().toISOString() },
					}
				: {
						UpdateExpression: "SET #status = :status REMOVE readAt",
						ExpressionAttributeValues: { ":status": status },
					};

		const outcome = await writeIfCondition(() =>
			userArticles.update({
				Key: { userId: partition, url: article.url },
				ConditionExpression: "attribute_exists(savedAt)",
				ExpressionAttributeNames: { "#status": "status" },
				ReturnValues: "ALL_NEW",
				...expression,
			}),
		);
		if (outcome.kind === "condition-failed") return null;
		assertItem(outcome.result.Attributes, "ReturnValues ALL_NEW must return the updated user-article row");
		return toSavedArticle(article, { ...outcome.result.Attributes, userId });
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
		set: Partial<z.input<typeof UserArticleRow>>;
		remove: readonly (keyof z.input<typeof UserArticleRow> & string)[];
	}): Promise<void> {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(stamp.url);
		const update = assembleRowUpdate({
			schema: UserArticleRow,
			set: stamp.set,
			remove: stamp.remove,
			handWrittenSet: { clauses: [], values: {} },
			condition: { kind: "row-exists", attribute: "savedAt" },
		});
		await writeIfCondition(() =>
			userArticles.update({ Key: { userId: stamp.partition, url: articleResourceUniqueId.value }, ...update }),
		);
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
		await stampUserArticleIfStillSaved({ partition: userId, url, set: { viewedAt: at.toISOString() }, remove: [] });
	};

	const markReadlistArticleViewed: MarkReadlistArticleViewed = async ({ userId, readlist, url, at }) => {
		await stampUserArticleIfStillSaved({
			partition: readlistPartitionValue({ userId, readlist }),
			url,
			set: { viewedAt: at.toISOString() },
			remove: [],
		});
	};

	const markSummaryToggled: MarkSummaryToggled = async ({ userId, url, state, at }) => {
		await stampUserArticleIfStillSaved({
			partition: userId,
			url,
			set: state === "open" ? { lastSummaryOpenedAt: at.toISOString() } : { lastSummaryClosedAt: at.toISOString() },
			remove: [],
		});
	};

	const markRelatedDismissed: MarkRelatedDismissed = async ({
		userId,
		url,
		at,
		suggestionId,
	}) => {
		await stampUserArticleIfStillSaved({
			partition: userId,
			url,
			set: suggestionId
				? { relatedDismissedAt: at.toISOString(), relatedDismissedSuggestionId: suggestionId.value }
				: { relatedDismissedAt: at.toISOString() },
			remove: suggestionId ? [] : ["relatedDismissedSuggestionId"],
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

	const listUserSavesForUrls: ListUserSavesForUrls = async ({ userId, urls, readlists }) => {
		const slugs = readlists ?? [DEFAULT_READLIST_SLUG, ...await listUserReadlistSlugs(userId)];
		const partitions = slugs.map((readlist) => partitionFor({ userId, readlist }));
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
			consistentRead: true,
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
		from,
		url,
		savedAt,
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const source = await findUserArticle(
			partitionFor({ userId, readlist: from }),
			articleResourceUniqueId.value,
		);
		if (!source) return { assigned: false };
		const outcome = await writeIfCondition(() =>
			userArticles.put({
				Item: {
					userId: partitionFor({ userId, readlist }),
					url: articleResourceUniqueId.value,
					status: source.status,
					savedAt: savedAt.toISOString(),
					...(source.readAt === undefined ? {} : { readAt: source.readAt }),
					...(source.provenance === undefined ? {} : { provenance: source.provenance }),
					...(source.suggestionAttribution === undefined
						? {}
						: { suggestionAttribution: source.suggestionAttribution }),
				},
				ConditionExpression: "attribute_not_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
			}),
		);
		if (outcome.kind === "condition-failed") return { assigned: false };
		return { assigned: true };
	};

	const copyRowInto = async (
		partition: string,
		row: z.infer<typeof UserArticleRow>,
	): Promise<boolean> => {
		const attributes = Object.fromEntries(
			Object.entries(row).filter(([, value]) => value !== undefined),
		);
		const outcome = await writeIfCondition(() =>
			userArticles.put({
				Item: { ...attributes, userId: partition },
				ConditionExpression: "attribute_not_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
			}),
		);
		if (outcome.kind === "condition-failed") return false;
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
		const update = assembleRowUpdate({
			schema: UserArticleRow,
			set: { emailSentAt: at.toISOString() },
			remove: [],
			handWrittenSet: { clauses: [], values: {} },
			condition: {
				kind: "expression",
				expression: "attribute_exists(savedAt) AND attribute_not_exists(emailSentAt)",
				values: {},
			},
		});
		await writeIfCondition(() =>
			userArticles.update({ Key: { userId, url: articleResourceUniqueId.value }, ...update }),
		);
	};

	const findArticleUrlById: FindArticleUrlById = async (id) => {
		const article = await findArticleByRouteId(id);
		return article ? article.originalUrl : null;
	};

	const findArticleByUrl: FindArticleByUrl = async (url, viewer = ANONYMOUS_VIEWER) => {
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
					"publishedOn",
					"estimatedReadTime",
					"savedAt",
					"contentSourceTier",
					"purgedAt",
					"readerAvailableAt",
					"ownerUserId",
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
		const destinationUrl = articleDestinationUrl({ url: row.originalUrl, displayUrl: row.displayUrl });
		return {
			id: row.routeId,
			url: row.originalUrl,
			destinationUrl,
			metadata: articleDisplayMetadata({
				url: row.originalUrl,
				destinationUrl,
				title: row.title,
				siteName: row.siteName,
				excerpt: row.excerpt,
				wordCount: row.wordCount,
				imageUrl: row.imageUrl,
				publishedOn: row.publishedOn,
				viewer,
				ownerUserId: row.ownerUserId,
			}),
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
			{ projection: ArticleContentRow.keyof().options, consistentRead: true },
		);
		if (row === undefined || isUnverifiedWrapperContent(row)) return undefined;
		return row.content;
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
		findArticlesAcrossReadlists,
		findPersonalLibrary,
		countArticlesByUser,
		deleteArticle,
		deleteAllUserArticles,
		listUserArticleUrls,
		updateArticleStatus,
		findArticleFreshness,
		findArticleCrawlVersions,
		markArticleViewed,
		markSummaryToggled,
		markRelatedDismissed,
		findUserArticlesByUrl,
		markReaderReadyEmailSent,
		findUnreadSavesForDigest,
		readContent,
		saveReadlistArticle,
		saveArticleAsRequested,
		saveReadlistArticleAsRequested,
		hasSaveLandedSince,
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
