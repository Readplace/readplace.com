import {
	type DynamoDBDocumentClient,
	assembleRowUpdate,
	assertItem,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
	TransactionCanceledException,
	TransactGetCommand,
	TransactWriteCommand,
	transactIfConditions,
	writeIfCondition,
} from "@packages/storage-client";
import { toEventInstant } from "@packages/domain/event-envelope";
import { initFindReadlistRemoval, initRecordReadlistRemoval, readlistRemovedAtAttribute } from "./readlist-removal-marker";
import { initFindSmartMatchRevisions, initRecordSmartMatchRevision } from "./smart-match-revision-marker";
import { EnclosureSchema, PRIVATE_ITEM_HOST } from "@packages/media-contracts";
import { z } from "zod";
import { VerificationFields, isUnverifiedWrapperContent } from "./verified-content";
import { ServedBodyFields, servedBodyOf } from "./served-body";
import type { ArticleDiscoveryQuery, ArticleStatus, SaveTrigger, SavedArticle } from "@packages/domain/article";
import {
	personalDecisionKey,
	personalReadlistPartition,
	personalReadlistOrder,
	MinutesSchema,
	ArticleStatusSchema,
	PROVENANCE_KINDS_KEPT_AGAINST_AUTOMATIC_SAVE,
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
	ChangePersonalPick,
	CountArticlesQuery,
	CountArticlesByUser,
	CountReadlistArticles,
	DeleteAllUserArticles,
	DeleteArticle,
	DeleteReadlistArticle,
	FileIntoLiveReadlist,
	FindReadlistFiling,
	FindReadlistRemoval,
	FindSmartMatchRevisions,
	RecordSmartMatchRevision,
	PurgeReadlistArticle,
	ListUserArticleUrls,
	ListUserSavesForUrl,
	CountSmartReadlistArticles,
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
	MarkOcrPagesHeld,
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
	type SaveArticleAsRequested,
	type SaveReadlistArticleAsRequested,
} from "@packages/provider-contracts/article-store";
import {
	BULK_ARTICLE_JOB_PREFIX, CANONICAL_REMOVAL_PREFIX,
	canonicalRemovalKey,
	READLIST_DEFINITION_KEY_PREFIX,
	READLIST_FIT_OVERRIDE_KEY_PREFIX,
	decodeUserArticlePartition,
	partitionFor,
	readlistDefinitionKey,
	readlistPartitionValue,
	removedLinksPartition,
	savedLinksJobKey,
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
	statusRevision: dynamoField(z.number().int()),
	restoredAt: dynamoField(z.string()),
	bulkSave: dynamoField(z.literal(true)),
	personalPickedAt: dynamoField(z.string()),
	personalScope: dynamoField(z.string()),
	personalDecision: dynamoField(z.string()),
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
	ocrPagesHold: dynamoField(z.object({ pages: z.number(), pagesLeft: z.number(), retryAt: z.string() })),
});

function digestIndexKeyOfLast(rows: z.infer<typeof UserArticleRow>[]): Record<string, unknown> {
	const last = rows.at(-1);
	assert(last, "a digest page cut at its limit keeps at least one row");
	return { userId: last.userId, url: last.url, savedAt: last.savedAt };
}

function toOptionalDate(value: string | undefined): Date | undefined {
	return value ? new Date(value) : undefined;
}

const PROTECTED_USER_ROW_VALUES: Record<string, string> = Object.fromEntries(
	PROVENANCE_KINDS_KEPT_AGAINST_AUTOMATIC_SAVE.map((kind, index) => [`:keptKind${index}`, kind]),
);

const PROTECTED_USER_ROW = `(attribute_exists(savedAt) AND (attribute_exists(personalPickedAt) OR attribute_exists(handPickedAt) OR attribute_not_exists(provenance) OR provenance.#kind IN (${Object.keys(PROTECTED_USER_ROW_VALUES).join(", ")})))`;

const ExistingUserRow = z.object({
	personalPickedAt: z.object({ S: z.string() }).optional(),
	handPickedAt: z.object({ S: z.string() }).optional(),
	provenance: z.object({ M: z.object({ kind: z.object({ S: z.string() }).optional() }) }).optional(),
});

function isProtectedAgainstAutomaticSave(oldItem: Record<string, unknown>): boolean {
	const { personalPickedAt, handPickedAt, provenance } = ExistingUserRow.parse(oldItem);
	if (personalPickedAt !== undefined || handPickedAt !== undefined || provenance === undefined) return true;
	return PROVENANCE_KINDS_KEPT_AGAINST_AUTOMATIC_SAVE.some((kind) => kind === provenance.M.kind?.S);
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
		...(userArticle.bulkSave ? { bulkSave: true as const } : {}),
		lastSummaryOpenedAt: toOptionalDate(userArticle.lastSummaryOpenedAt),
		lastSummaryClosedAt: toOptionalDate(userArticle.lastSummaryClosedAt),
		restoredAt: toOptionalDate(userArticle.restoredAt),
		statusRevision: userArticle.statusRevision,
		personalDecision: userArticle.personalDecision,
		personalPickedAt: toOptionalDate(userArticle.personalPickedAt),
		...(userArticle.personalScope === personalReadlistPartition(userArticle.userId, "uncertain", userArticle.status) ? { personalReviewPending: true as const } : {}),
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
		ocrPagesHold: userArticle.ocrPagesHold && { ...userArticle.ocrPagesHold, retryAt: new Date(userArticle.ocrPagesHold.retryAt) },
	};
}

export function initDynamoDbSavedArticleStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	userArticlesTableName: string;
	logger: Logger;
	now: () => Date;
}): {
	changePersonalPick: ChangePersonalPick;
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
	markOcrPagesHeld: MarkOcrPagesHeld;
	findUserArticlesByUrl: FindUserArticlesByUrl;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	findUnreadSavesForDigest: FindUnreadSavesForDigest;
	readContent: ContentProvider;
	saveReadlistArticle: SaveReadlistArticle;
	saveArticleAsRequested: SaveArticleAsRequested;
	saveReadlistArticleAsRequested: SaveReadlistArticleAsRequested;
	findReadlistArticles: FindReadlistArticles;
	countReadlistArticles: CountReadlistArticles;
	findReadlistArticleById: FindReadlistArticleById;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
	deleteReadlistArticle: DeleteReadlistArticle;
	purgeReadlistArticle: PurgeReadlistArticle;
	findReadlistFiling: FindReadlistFiling;
	findReadlistRemoval: FindReadlistRemoval;
	findSmartMatchRevisions: FindSmartMatchRevisions;
	recordSmartMatchRevision: RecordSmartMatchRevision;
	fileIntoLiveReadlist: FileIntoLiveReadlist;
	markReadlistArticleViewed: MarkReadlistArticleViewed;
	listUserSavesForUrl: ListUserSavesForUrl;
	countSmartReadlistArticles: CountSmartReadlistArticles;
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
	const removalRows = defineDynamoTable({ client, tableName: userArticlesTableName, schema: z.object({ userId: z.string(), url: z.string() }) });
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

	const HeldLinkKeyRow = z.object({ userId: z.string(), url: z.string(), removedUrl: z.string() });
	const heldLinkRows = defineDynamoTable({ client, tableName: userArticlesTableName, schema: HeldLinkKeyRow });

	const forEachHeldLinkRowPage = (
		userId: UserId,
		onPage: (rows: z.infer<typeof HeldLinkKeyRow>[]) => Promise<void>,
	): Promise<void> =>
		forEachQueryPage(
			heldLinkRows,
			{
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": removedLinksPartition(userId) },
				ProjectionExpression: "userId, #url, removedUrl",
				ExpressionAttributeNames: { "#url": "url" },
			},
			onPage,
		);

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

	type UserRowSaveParams = Omit<SaveArticleParams, "saveTrigger">;
	type UserRowWritten = { createdUserArticle: boolean; wroteUserArticle: boolean };
	type UserRowWrite = {
		partition: string;
		params: UserRowSaveParams;
		condition: string;
		conditionValues: Record<string, string>;
		conditionNames: Record<string, string>;
	};

	const updateUserRow = async ({
		partition,
		params,
		condition,
		conditionValues,
		conditionNames,
		provenance,
		stampHandPicked,
	}: UserRowWrite & { provenance: "set" | "keep"; stampHandPicked: boolean }): Promise<
		UserRowWritten & { oldItem?: Record<string, unknown> }
	> => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const sets = [
			"savedAt = :savedAt",
			...(params.bulkSave ? ["bulkSave = :bulk"] : []),
			...(provenance === "set" ? ["provenance = :provenance"] : []),
			"#status = if_not_exists(#status, :unread)",
			...(params.suggestionAttribution === undefined
				? []
				: ["suggestionAttribution = if_not_exists(suggestionAttribution, :attribution)"]),
			...(stampHandPicked ? ["handPickedAt = if_not_exists(handPickedAt, :savedAt)"] : []),
		];
		const update = {
			Key: { userId: partition, url: articleResourceUniqueId.value },
			UpdateExpression: `SET ${sets.join(", ")}`,
			ConditionExpression: condition,
			ExpressionAttributeNames: { "#status": "status", ...conditionNames },
			ExpressionAttributeValues: {
				":savedAt": params.savedAt.toISOString(),
				...(params.bulkSave ? { ":bulk": true } : {}),
				...(provenance === "set" ? { ":provenance": params.provenance } : {}),
				":unread": "unread",
				...(params.suggestionAttribution === undefined
					? {}
					: { ":attribution": params.suggestionAttribution }),
				...conditionValues,
			},
		};
		const requestedAt = params.personalPick ? new Date(params.personalPick.requestedAt).toISOString() : params.requestedAt?.toISOString();
		const privateUpload = articleResourceUniqueId.value.startsWith(`${PRIVATE_ITEM_HOST}/`);
		const canonicalOrigin = partition === params.userId ? requestedAt : undefined;
		if (canonicalOrigin || privateUpload) {
			const newerThanRemoval = "attribute_not_exists(removedAt) OR removedAt < :origin";
			const releaseUnclaimed = "attribute_not_exists(privateReleaseClaim)";
			const canSave = canonicalOrigin && privateUpload ? `(${newerThanRemoval}) AND ${releaseUnclaimed}` :
				canonicalOrigin ? newerThanRemoval : releaseUnclaimed;
			for (let attempt = 0; attempt < 8; attempt++) {
				const prior = await userArticles.get(update.Key, { consistentRead: true });
				try {
					await client.send(new TransactWriteCommand({ TransactItems: [
						{ ConditionCheck: {
							TableName: userArticlesTableName,
							Key: canonicalRemovalKey(params.userId, articleResourceUniqueId.value),
							ConditionExpression: canSave,
							...(canonicalOrigin ? { ExpressionAttributeValues: { ":origin": canonicalOrigin } } : {}),
						} },
						{ Update: {
							TableName: userArticlesTableName, ...update,
							ConditionExpression: `(${condition}) AND attribute_${prior ? "exists" : "not_exists"}(savedAt)`,
							ReturnValuesOnConditionCheckFailure: "ALL_OLD",
						} },
					] }));
					return { createdUserArticle: !prior, wroteUserArticle: true };
				} catch (error) {
					if (!(error instanceof TransactionCanceledException)) throw error;
					const reasons = error.CancellationReasons;
					if (reasons?.[0]?.Code === "ConditionalCheckFailed") throw new ArticlePurgedAfterRequest(params.url);
					if (reasons?.[1]?.Code !== "ConditionalCheckFailed") throw error;
					const oldItem = reasons[1].Item;
					if (Boolean(oldItem) !== Boolean(prior)) continue;
					return { createdUserArticle: false, wroteUserArticle: false, oldItem };
				}
			}
			throw new Error("The canonical save changed during each attempt");
		}
		const outcome = await writeIfCondition(() => userArticles.update({
			...update, ReturnValues: "ALL_OLD", ReturnValuesOnConditionCheckFailure: "ALL_OLD",
		}));
		if (outcome.kind === "condition-failed") {
			return { createdUserArticle: false, wroteUserArticle: false, oldItem: outcome.oldItem };
		}
		return { createdUserArticle: outcome.result.Attributes === undefined, wroteUserArticle: true };
	};

	const stampHandPickedIfRowExists = async ({
		partition,
		url,
		at,
	}: { partition: string; url: string; at: Date }): Promise<void> => {
		await writeIfCondition(() =>
			userArticles.update({
				Key: { userId: partition, url: ArticleResourceUniqueId.parse(url).value },
				UpdateExpression: "SET handPickedAt = if_not_exists(handPickedAt, :at)",
				ConditionExpression: "attribute_exists(savedAt)",
				ExpressionAttributeValues: { ":at": at.toISOString() },
			}),
		);
	};

	const writeUserRowBySaveTrigger: Record<SaveTrigger, (write: UserRowWrite) => Promise<UserRowWritten>> = {
		manual: async (write) => {
			const written = await updateUserRow({ ...write, provenance: "set", stampHandPicked: true });
			if (!written.wroteUserArticle) {
				await stampHandPickedIfRowExists({ partition: write.partition, url: write.params.url, at: write.params.savedAt });
			}
			return written;
		},
		automatic: async (write) => {
			const conditionValues = { ...write.conditionValues, ...PROTECTED_USER_ROW_VALUES };
			const conditionNames = { ...write.conditionNames, "#kind": "kind" };
			const restamped = await updateUserRow({
				...write,
				condition: `(${write.condition}) AND NOT ${PROTECTED_USER_ROW}`,
				conditionValues,
				conditionNames,
				provenance: "set",
				stampHandPicked: false,
			});
			if (restamped.wroteUserArticle) return restamped;
			if (restamped.oldItem === undefined || !isProtectedAgainstAutomaticSave(restamped.oldItem)) return restamped;
			const kept = await updateUserRow({
				...write,
				condition: `(${write.condition}) AND attribute_exists(savedAt) AND ${PROTECTED_USER_ROW}`,
				conditionValues,
				conditionNames,
				provenance: "keep",
				stampHandPicked: false,
			});
			return { createdUserArticle: false, wroteUserArticle: kept.wroteUserArticle };
		},
	};

	const writeUserArticleUnlessConditionLost = ({
		saveTrigger,
		...write
	}: UserRowWrite & { saveTrigger: SaveTrigger | undefined }): Promise<UserRowWritten> =>
		saveTrigger === undefined
			? updateUserRow({ ...write, provenance: "set", stampHandPicked: false })
			: writeUserRowBySaveTrigger[saveTrigger](write);

	const changePersonalPick: ChangePersonalPick = async ({ userId, url, picked, request }) => {
		const key = { userId, url: ArticleResourceUniqueId.parse(url).value };
		const decision = personalDecisionKey(request);
		const requestedAt = new Date(request.requestedAt).toISOString();
		for (let attempt = 0; attempt < 8; attempt++) {
			const row = await userArticles.get(key, { consistentRead: true });
			if (row === undefined) return "missing";
			if (row.personalDecision !== undefined && row.personalDecision >= decision) return "superseded";
			const pickedAt = row.personalPickedAt ?? requestedAt;
			const orderAt = row.status === "read" ? row.readAt ?? row.savedAt : pickedAt;
			const update = {
				Key: key,
				ConditionExpression: [
					"savedAt = :saved AND #status = :status",
					row.personalDecision === undefined ? "attribute_not_exists(personalDecision)" : "personalDecision = :previous",
					row.readAt === undefined ? "attribute_not_exists(readAt)" : "readAt = :read",
				].join(" AND "),
				UpdateExpression: picked
					? "SET personalDecision = :decision, personalPickedAt = :picked, personalScope = :scope, personalOrder = :order"
					: "SET personalDecision = :decision REMOVE personalPickedAt, personalScope, personalOrder",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					":decision": decision,
					":saved": row.savedAt,
					":status": row.status,
					...(row.personalDecision === undefined ? {} : { ":previous": row.personalDecision }),
					...(row.readAt === undefined ? {} : { ":read": row.readAt }),
					...(picked ? {
						":picked": pickedAt,
						":scope": personalReadlistPartition(userId, "picked", row.status),
						":order": personalReadlistOrder(orderAt, ReaderArticleHashId.fromResourceUniqueId(key.url)),
					} : {}),
				},
			};
			try {
				await client.send(new TransactWriteCommand({ TransactItems: [
					{ ConditionCheck: {
						TableName: userArticlesTableName,
						Key: canonicalRemovalKey(userId, key.url),
						ConditionExpression: "attribute_not_exists(removedAt) OR removedAt < :origin",
						ExpressionAttributeValues: { ":origin": requestedAt },
					} },
					{ Update: { TableName: userArticlesTableName, ...update } },
				] }));
				return "updated";
			} catch (error) {
				if (!(error instanceof TransactionCanceledException)) throw error;
				if (error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") return "superseded";
				if (error.CancellationReasons?.[1]?.Code !== "ConditionalCheckFailed") throw error;
			}
		}
		throw new Error("The saved article kept changing during the membership update");
	};

	const readBackSave = async ({
		partition,
		params,
		written,
	}: {
		partition: string;
		params: UserRowSaveParams;
		written: UserRowWritten;
	}): ReturnType<SaveArticle> => {
		if (params.personalPick && partition === params.userId) {
			await changePersonalPick({ userId: params.userId, url: params.url, picked: true, request: params.personalPick });
		}
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
		params: UserRowSaveParams,
		saveTrigger: SaveTrigger | undefined,
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
			writeUserArticleUnlessConditionLost({
				partition,
				params,
				condition: userRowCondition,
				conditionValues: {},
				conditionNames: {},
				saveTrigger,
			}),
		]);

		return readBackSave({ partition, params, written });
	};

	const writeSaveAsRequested = async (
		partition: string,
		{ requestedAt, ...params }: UserRowSaveParams & { requestedAt: Date },
		saveTrigger: SaveTrigger | undefined,
		keepPosition = false,
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
			params: { ...params, requestedAt },
			condition: keepPosition ? "attribute_not_exists(savedAt)"
				: "(attribute_not_exists(savedAt) OR savedAt < :requestedAt) AND (attribute_not_exists(readAt) OR readAt < :requestedAt)",
			conditionValues: keepPosition ? {} : requested,
			conditionNames: {},
			saveTrigger,
		});
		return readBackSave({ partition, params, written });
	};

	const writeSave = initSaveWrite("attribute_not_exists(savedAt) OR savedAt < :savedAt");
	const writeSaveKeepingPosition = initSaveWrite("attribute_not_exists(savedAt)");

	const saveCanonical = ({ saveTrigger, ...params }: SaveArticleParams, keepPosition: boolean) => {
		const requestedAt = params.requestedAt ?? (params.personalPick && new Date(params.personalPick.requestedAt));
		if (requestedAt) return writeSaveAsRequested(params.userId, { ...params, requestedAt }, saveTrigger, keepPosition);
		const write = keepPosition ? writeSaveKeepingPosition : writeSave;
		return write(params.userId, params, saveTrigger);
	};
	const saveArticle: SaveArticle = params => saveCanonical(params, false);
	const saveArticleKeepingPosition: SaveArticle = params => saveCanonical(params, true);
	const saveReadlistArticle: SaveReadlistArticle = ({ readlist, ...params }) =>
		writeSave(readlistPartitionValue({ userId: params.userId, readlist }), params, undefined);
	const saveArticleAsRequested: SaveArticleAsRequested = ({ saveTrigger, ...params }) =>
		writeSaveAsRequested(params.userId, params, saveTrigger);
	const saveReadlistArticleAsRequested: SaveReadlistArticleAsRequested = ({ readlist, ...params }) =>
		writeSaveAsRequested(readlistPartitionValue({ userId: params.userId, readlist }), params, undefined);


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

	function listingIndex(partition: string, query: CountArticlesQuery & { sort?: SortField }) {
		if (query.managedOrigin) {
			const source: { expression: string; names: Record<string, string>; values: Record<string, string> } = query.managedOrigin === "bulk" ? {
				expression: "bulkSave = :flag OR provenance.#kind = :import",
				names: { "#kind": "kind" }, values: { ":import": "import" },
			} : {
				expression: "unknownOrigin = :flag OR attribute_not_exists(provenance)", names: {}, values: {},
			};
			const statusFilter = query.status ? " AND #status = :status" : "";
			return {
				IndexName: query.sort === "readAt" ? "userId-readAt-index" : "userId-savedAt-index",
				KeyConditionExpression: "userId = :userId",
				FilterExpression: `(${source.expression})${statusFilter}`,
				...(query.status || query.managedOrigin === "bulk" ? { ExpressionAttributeNames: { ...source.names, ...(query.status ? { "#status": "status" } : {}) } } : {}),
				ExpressionAttributeValues: { ":userId": partition, ":flag": true, ...source.values, ...(query.status ? { ":status": query.status } : {}) },
			};
		}
		if (query.personalScope) {
			assert(query.status && partition === query.userId, "personal readlists require a canonical account and status");
			return {
				IndexName: "personalScope-personalOrder-index",
				KeyConditionExpression: "personalScope = :scope",
				ExpressionAttributeValues: { ":scope": personalReadlistPartition(query.userId, query.personalScope, query.status) },
			};
		}
		return {
			IndexName: query.sort === "readAt" ? "userId-readAt-index" : "userId-savedAt-index",
			KeyConditionExpression: "userId = :userId",
			...(query.status ? {
				FilterExpression: "#status = :status",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: { ":userId": partition, ":status": query.status },
			} : { ExpressionAttributeValues: { ":userId": partition } }),
		};
	}

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
		const userArticleRows: z.infer<typeof UserArticleRow>[] = [];
		await forEachQueryPage(
			userArticles,
			{
				...listingIndex(partition, query),
				ScanIndexForward: query.order === "asc",
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
		const index = listingIndex(partition, query);

		let total: number | undefined;
		if (query.includeTotal) {
			let counted = 0;
			let countStartKey: Record<string, unknown> | undefined;
			do {
				const { count, lastEvaluatedKey } = await userArticles.query({
					...index,
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
				...index,
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
		query: CountArticlesQuery,
	): Promise<number> => {
		if (query.discovery) {
			const matched = await discoveredRowsInPartition(partition, { ...query, discovery: query.discovery });
			return Math.min(matched.length, query.countLimit ?? matched.length);
		}
		const index = listingIndex(partition, query);
		let total = 0;
		let startKey: Record<string, unknown> | undefined;
		do {
			const { count, lastEvaluatedKey } = await userArticles.query({
				...index,
				Select: "COUNT",
				...(query.personalScope && query.countLimit ? { Limit: Math.max(1, query.countLimit - total) } : {}),
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

	const deleteRowInPartition = async ({ partition, url }: { partition: string; url: string }): Promise<boolean> => {
		const outcome = await writeIfCondition(() =>
			userArticles.delete({
				Key: { userId: partition, url },
				ConditionExpression: "attribute_exists(savedAt)",
			}),
		);
		if (outcome.kind === "condition-failed") return false;
		return true;
	};

	const deleteInPartition = async (
		partition: string,
		routeId: ReaderArticleHashId,
	): Promise<boolean> => {
		const article = await findArticleByRouteId(routeId);
		if (!article) return false;
		return deleteRowInPartition({ partition, url: article.url });
	};

	const deleteArticle: DeleteArticle = async (routeId, userId) => {
		const article = await findArticleByRouteId(routeId);
		if (!article) return false;
		const removedAt = now().toISOString();
		try {
			await client.send(new TransactWriteCommand({ TransactItems: [
				{ Delete: {
					TableName: userArticlesTableName,
					Key: { userId, url: article.url },
					ConditionExpression: "attribute_exists(savedAt)",
				} },
				{ Update: {
					TableName: userArticlesTableName,
					Key: canonicalRemovalKey(userId, article.url),
					UpdateExpression: "SET removedAt = :at",
					ConditionExpression: "attribute_not_exists(removedAt) OR removedAt <= :at",
					ExpressionAttributeValues: { ":at": removedAt },
				} },
			] }));
			return true;
		} catch (error) {
			if (error instanceof TransactionCanceledException && error.CancellationReasons?.some(reason => reason.Code === "ConditionalCheckFailed")) return false;
			throw error;
		}
	};

	const recordReadlistRemoval = initRecordReadlistRemoval({ client, userArticlesTableName, now });

	const deleteReadlistArticle: DeleteReadlistArticle = async ({ id, userId, readlist }) => {
		const article = await findArticleByRouteId(id);
		if (!article) return false;
		await recordReadlistRemoval({ userId, readlist, url: article.originalUrl });
		return deleteRowInPartition({ partition: readlistPartitionValue({ userId, readlist }), url: article.url });
	};

	const purgeReadlistArticle: PurgeReadlistArticle = ({ id, userId, readlist }) =>
		deleteInPartition(readlistPartitionValue({ userId, readlist }), id);

	const findReadlistFiling: FindReadlistFiling = async ({ userId, readlist, url }) => {
		const row = await userArticles.get(
			{ userId: readlistPartitionValue({ userId, readlist }), url: ArticleResourceUniqueId.parse(url).value },
			{ consistentRead: true },
		);
		if (row === undefined) return undefined;
		return { savedAt: new Date(row.savedAt), status: row.status, readAt: toOptionalDate(row.readAt) };
	};

	const readlistRowWrite = (params: Parameters<FileIntoLiveReadlist>[0]) => {
		const attribution =
			params.suggestionAttribution === undefined
				? { set: "", values: {} }
				: {
					set: ", suggestionAttribution = if_not_exists(suggestionAttribution, :attribution)",
					values: { ":attribution": params.suggestionAttribution },
				};
		const shared = { ":savedAt": params.savedAt.toISOString(), ":provenance": params.provenance, ...attribution.values };
		if (params.landsAs.status === "read") {
			return {
				UpdateExpression: `SET savedAt = :savedAt, provenance = :provenance, #status = :read, readAt = :readAt${attribution.set}`,
				ConditionExpression: "attribute_not_exists(savedAt)",
				ExpressionAttributeValues: { ...shared, ":read": "read", ":readAt": params.landsAs.readAt.toISOString() },
			};
		}
		return {
			UpdateExpression: `SET savedAt = :savedAt, provenance = :provenance, #status = if_not_exists(#status, :unread)${attribution.set}`,
			ConditionExpression: "attribute_not_exists(savedAt) OR savedAt < :savedAt",
			ExpressionAttributeValues: { ...shared, ":unread": "unread" },
		};
	};

	const isNeitherPassedNorConditionFailed = (code: string | undefined) =>
		code !== "None" && code !== "ConditionalCheckFailed";

	const definitionCondition = (smartRule: Parameters<FileIntoLiveReadlist>[0]["smartRule"]) => {
		if (smartRule === undefined) {
			return { ConditionExpression: "attribute_exists(#url)", ExpressionAttributeNames: { "#url": "url" } };
		}
		return {
			ConditionExpression: "attribute_exists(#url) AND filingMode = :smart AND filingRuleRevision = :revision",
			ExpressionAttributeNames: { "#url": "url" },
			ExpressionAttributeValues: { ":smart": "smart", ":revision": smartRule.revision },
		};
	};

	const fileIntoLiveReadlist: FileIntoLiveReadlist = async (params) => {
		const { userId, readlist } = params;
		const key = ArticleResourceUniqueId.parse(params.url).value;
		try {
			await client.send(
				new TransactWriteCommand({
					TransactItems: [
						{
							ConditionCheck: {
								TableName: userArticlesTableName,
								Key: { userId, url: readlistDefinitionKey(readlist) },
								...definitionCondition(params.smartRule),
							},
						},
						{
							ConditionCheck: {
								TableName: userArticlesTableName,
								Key: { userId, url: key },
								ConditionExpression:
									"attribute_exists(savedAt) AND (attribute_not_exists(#removedAt) OR #removedAt <= :requestedAt)",
								ExpressionAttributeNames: { "#removedAt": readlistRemovedAtAttribute(readlist) },
								ExpressionAttributeValues: { ":requestedAt": toEventInstant(params.requestedAt) },
							},
						},
						{
							Update: {
								TableName: userArticlesTableName,
								Key: { userId: readlistPartitionValue({ userId, readlist }), url: key },
								ExpressionAttributeNames: { "#status": "status" },
								...readlistRowWrite(params),
							},
						},
					],
				}),
			);
		} catch (error) {
			if (!(error instanceof TransactionCanceledException)) throw error;
			const codes = (error.CancellationReasons ?? []).map((reason) => reason.Code);
			const decisive = codes.indexOf("ConditionalCheckFailed");
			if (decisive === -1 || codes.some(isNeitherPassedNorConditionFailed)) throw error;
			if (decisive === 0) return { outcome: params.smartRule === undefined ? "readlist-gone" : "smart-rule-changed" };
			if (decisive === 1) {
				const allRow = await userArticles.get({ userId, url: key }, { consistentRead: true });
				return { outcome: allRow === undefined ? "not-in-all" : "removed-after-request" };
			}
			return { outcome: "newer-row-won" };
		}
		await bumpArticleSavedAt({ url: params.url, savedAt: now() });
		return { outcome: "filed" };
	};

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
				ConsistentRead: true,
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
		await forEachQueryPage(removalRows, {
			KeyConditionExpression: "userId = :user AND begins_with(#url, :prefix)",
			ExpressionAttributeNames: { "#url": "url" },
			ExpressionAttributeValues: { ":user": userId, ":prefix": CANONICAL_REMOVAL_PREFIX },
		}, async rows => {
			await Promise.all(rows.map(key => removalRows.delete({ Key: key })));
		});
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
		await userArticles.delete({ Key: { userId, url: savedLinksJobKey(userId) } });
		await forEachHeldLinkRowPage(userId, async (rows) => {
			await Promise.all(rows.map((row) => heldLinkRows.delete({ Key: { userId: row.userId, url: row.url } })));
		});
		await forEachQueryPage(removalRows, {
			KeyConditionExpression: "userId = :user AND begins_with(#url, :prefix)",
			ExpressionAttributeNames: { "#url": "url" },
			ExpressionAttributeValues: { ":user": userId, ":prefix": BULK_ARTICLE_JOB_PREFIX },
			ConsistentRead: true,
		}, async rows => {
			await Promise.all(rows.map(({ userId, url }) => removalRows.delete({ Key: { userId, url } })));
		});
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
		await forEachHeldLinkRowPage(userId, async (rows) => {
			for (const row of rows) seen.add(row.removedUrl);
		});
		const bulkHolds = defineDynamoTable({ client, tableName: userArticlesTableName, schema: z.object({ recovery: z.object({ url: z.string() }) }) });
		await forEachQueryPage(bulkHolds, {
			KeyConditionExpression: "userId = :user AND begins_with(#url, :prefix)",
			FilterExpression: "attribute_exists(recovery)", ProjectionExpression: "recovery.#url",
			ExpressionAttributeNames: { "#url": "url" }, ExpressionAttributeValues: { ":user": userId, ":prefix": BULK_ARTICLE_JOB_PREFIX },
			ConsistentRead: true,
		}, async rows => { for (const row of rows) seen.add(row.recovery.url); });
		// An expired recovery row can be gone while the media worker is retrying blob deletion.
		const privateReleaseUrls = new Set<string>();
		const privateHolds = defineDynamoTable({ client, tableName: userArticlesTableName, schema: z.object({ privateReleaseUrl: z.string() }) });
		await forEachQueryPage(privateHolds, {
			KeyConditionExpression: "userId = :user AND begins_with(#url, :prefix)", FilterExpression: "attribute_exists(privateReleaseUrl)",
			ExpressionAttributeNames: { "#url": "url" }, ExpressionAttributeValues: { ":user": userId, ":prefix": CANONICAL_REMOVAL_PREFIX },
			ConsistentRead: true,
		}, async rows => { for (const row of rows) privateReleaseUrls.add(row.privateReleaseUrl); });
		const normalizedUrls = [...seen];
		if (normalizedUrls.length === 0) return [...privateReleaseUrls];
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
		const activeUrls = globals
			.map((row) => row.originalUrl)
			.filter((url): url is string => url !== undefined);
		return [...new Set([...activeUrls, ...privateReleaseUrls])];
	};

	const updateStatusInPartition = async (
		partition: string,
		userId: UserId,
		routeId: ReaderArticleHashId,
		status: ArticleStatus,
		attempt = 0,
		expected?: Parameters<UpdateArticleStatus>[3],
	): Promise<SavedArticle | null> => {
		if (attempt >= 8) throw new Error("The saved article kept changing during the status update");
		const article = await findArticleByRouteId(routeId);
		if (!article) return null;

		// Save again can finish crawling after a reader has changed the same save.
		const expectedCondition = expected ? " AND savedAt = :expectedSaved AND " +
			(expected.readAt ? "readAt = :expectedRead" : "(attribute_not_exists(readAt) OR attribute_type(readAt, :nullType))") + " AND " +
			(expected.statusRevision === undefined ? "(attribute_not_exists(statusRevision) OR attribute_type(statusRevision, :nullType))" : "statusRevision = :expectedRevision") : "";
		const expectedValues = expected ? {
			":expectedSaved": expected.savedAt.toISOString(),
			...(expected.readAt && expected.statusRevision !== undefined ? {} : { ":nullType": "NULL" }),
			...(expected.readAt ? { ":expectedRead": expected.readAt.toISOString() } : {}),
			...(expected.statusRevision === undefined ? {} : { ":expectedRevision": expected.statusRevision }),
		} : {};
		const expression =
			status === "read"
				? {
						UpdateExpression: "SET #status = :status, readAt = if_not_exists(readAt, :readAt) ADD statusRevision :one",
						ExpressionAttributeValues: { ":one": 1, ":status": status, ":readAt": now().toISOString() },
					}
				: {
						UpdateExpression: "SET #status = :status REMOVE readAt ADD statusRevision :one",
						ExpressionAttributeValues: { ":one": 1, ":status": status },
					};

		const outcome = await writeIfCondition(() =>
			userArticles.update({
				Key: { userId: partition, url: article.url },
				ConditionExpression: `attribute_exists(savedAt) AND attribute_not_exists(personalScope)${expectedCondition}`,
				ExpressionAttributeNames: { "#status": "status" },
				ReturnValues: "ALL_NEW",
				...expression,
				ExpressionAttributeValues: { ...expression.ExpressionAttributeValues, ...expectedValues },
			}),
		);
		if (outcome.kind === "condition-failed") {
			const key = { userId: partition, url: article.url };
			const row = await userArticles.get(key, { consistentRead: true });
			if (!row) return null;
			if (expected && (row.savedAt !== expected.savedAt.toISOString() || row.readAt !== expected.readAt?.toISOString()
				|| row.statusRevision !== expected.statusRevision)) return toSavedArticle(article, { ...row, userId });
			if (!row.personalScope) return updateStatusInPartition(partition, userId, routeId, status, attempt + 1, expected);
			if (row.status === status) return toSavedArticle(article, { ...row, userId });
			const at = status === "read" ? now().toISOString() : row.personalPickedAt ?? row.savedAt;
			const scope = row.personalPickedAt ? "picked" : "uncertain";
			const changed = await writeIfCondition(() => userArticles.update({
				Key: key,
				UpdateExpression: status === "read"
					? "SET #status = :status, personalScope = :scope, personalOrder = :order, readAt = :at ADD statusRevision :one"
					: "SET #status = :status, personalScope = :scope, personalOrder = :order REMOVE readAt ADD statusRevision :one",
				ConditionExpression: "personalScope = :previous AND savedAt = :saved AND " +
					(row.personalDecision === undefined ? "attribute_not_exists(personalDecision)" : "personalDecision = :decision") + expectedCondition,
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					...expectedValues,
					":one": 1, ":status": status, ":scope": personalReadlistPartition(userId, scope, status),
					":order": personalReadlistOrder(at, routeId), ":saved": row.savedAt, ":previous": row.personalScope,
					...(status === "read" ? { ":at": at } : {}),
					...(row.personalDecision === undefined ? {} : { ":decision": row.personalDecision }),
				},
				ReturnValues: "ALL_NEW",
			}));
			if (changed.kind === "condition-failed") return updateStatusInPartition(partition, userId, routeId, status, attempt + 1, expected);
			assertItem(changed.result.Attributes, "the updated classified row must be returned");
			return toSavedArticle(article, { ...changed.result.Attributes, userId });
		}
		assertItem(outcome.result.Attributes, "ReturnValues ALL_NEW must return the updated user-article row");
		return toSavedArticle(article, { ...outcome.result.Attributes, userId });
	};

	const updateArticleStatus: UpdateArticleStatus = (routeId, userId, status, expected) =>
		updateStatusInPartition(userId, userId, routeId, status, 0, expected);

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

	const markOcrPagesHeld: MarkOcrPagesHeld = async ({ userId, url, hold }) => {
		await stampUserArticleIfStillSaved({
			partition: userId,
			url,
			set: { ocrPagesHold: { pages: hold.pages, pagesLeft: hold.pagesLeft, retryAt: hold.retryAt.toISOString() } },
			remove: [],
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
			consistentRead: true,
		});
		return rows.map((row) => {
			const { readlist } = decodeUserArticlePartition(row.userId);
			return readlist === undefined ? {} : { readlist };
		});
	};

	const smartMembershipKeys = defineDynamoTable({
		client, tableName: userArticlesTableName, schema: z.object({ url: z.string() }),
	});

	const countSmartReadlistArticles: CountSmartReadlistArticles = async ({ userId, readlists }) => {
		const witnesses = new Map<string, ReadlistSlug>();
		for (const readlist of readlists) {
			let cursor: Record<string, unknown> | undefined;
			do {
				const page = await smartMembershipKeys.query({
					KeyConditionExpression: "userId = :partition",
					ExpressionAttributeValues: { ":partition": readlistPartitionValue({ userId, readlist }) },
					FilterExpression: "attribute_exists(savedAt)",
					ProjectionExpression: "#url",
					ExpressionAttributeNames: { "#url": "url" },
					ConsistentRead: true, Limit: 100, ExclusiveStartKey: cursor,
				});
				for (const { url } of page.items) {
					witnesses.set(url, readlist);
					if (witnesses.size === 10) break;
				}
				cursor = page.lastEvaluatedKey;
			} while (cursor && witnesses.size < 10);
			if (witnesses.size === 10) break;
		}
		if (witnesses.size < 10) return witnesses.size;

		const gets = [
			...[...witnesses].map(([url, readlist]) => ({
				Key: { userId: readlistPartitionValue({ userId, readlist }), url },
				ProjectionExpression: "savedAt",
			})),
			...[...new Set(witnesses.values())].map((readlist) => ({
				Key: { userId, url: readlistDefinitionKey(readlist) }, ProjectionExpression: "queuePurpose",
			})),
		];
		const { Responses } = await client.send(new TransactGetCommand({
			TransactItems: gets.map((get) => ({ Get: { TableName: userArticlesTableName, ...get } })),
		}));
		if (!gets.every((get, i) => z.string().min(1).safeParse(Responses?.[i]?.Item?.[get.ProjectionExpression]).success)) {
			throw new Error("Smart Readlist memberships or purposes changed during counting");
		}
		return witnesses.size;
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

	const writeReadlistCopy = async (owner: UserId, source: string, item: Record<string, unknown> & { userId: string; url: string }) => {
		const put = { Item: item, ConditionExpression: "attribute_not_exists(#url)", ExpressionAttributeNames: { "#url": "url" } };
		if (!item.url.startsWith(`${PRIVATE_ITEM_HOST}/`)) return (await writeIfCondition(() => userArticles.put(put))).kind === "written";
		if (source === item.userId) return false;
		const result = await transactIfConditions(() => client.send(new TransactWriteCommand({ TransactItems: [
			{ ConditionCheck: { TableName: userArticlesTableName, Key: canonicalRemovalKey(owner, item.url), ConditionExpression: "attribute_not_exists(privateReleaseClaim)" } },
			{ ConditionCheck: { TableName: userArticlesTableName, Key: { userId: source, url: item.url }, ConditionExpression: "attribute_exists(savedAt)" } },
			{ Put: { TableName: userArticlesTableName, ...put } },
		] })));
		return result.kind === "written";
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
		const assigned = await writeReadlistCopy(userId, partitionFor({ userId, readlist: from }), {
			userId: partitionFor({ userId, readlist }), url: articleResourceUniqueId.value, status: source.status,
			savedAt: savedAt.toISOString(),
			...(source.readAt === undefined ? {} : { readAt: source.readAt }),
			...(source.provenance === undefined ? {} : { provenance: source.provenance }),
			...(source.suggestionAttribution === undefined ? {} : { suggestionAttribution: source.suggestionAttribution }),
		});
		return { assigned };
	};

	const copyRowInto = async (
		userId: UserId,
		partition: string,
		row: z.infer<typeof UserArticleRow>,
	): Promise<boolean> => {
		const attributes = Object.fromEntries(
			Object.entries(row).filter(([, value]) => value !== undefined),
		);
		return writeReadlistCopy(userId, row.userId, { ...attributes, userId: partition, url: row.url });
	};

	const moveReadlistArticles: MoveReadlistArticles = async ({ userId, from, to }) => {
		const source = readlistPartitionValue({ userId, readlist: from });
		const destination = readlistPartitionValue({ userId, readlist: to });
		let moved = 0;
		await forEachPartitionRow(source, async (rows) => {
			const copied = await Promise.all(
				rows.map(async (row) => {
					const landed = await copyRowInto(userId, destination, row);
					if (!landed && row.url.startsWith(`${PRIVATE_ITEM_HOST}/`) &&
						!await userArticles.get({ userId: destination, url: row.url }, { consistentRead: true })) {
						if (await userArticles.get({ userId: source, url: row.url }, { consistentRead: true })) {
							throw new Error("Private upload release is in progress. Retry the readlist move.");
						}
						return false;
					}
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
					"media",
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
			media: row.media,
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
		changePersonalPick,
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
		markOcrPagesHeld,
		findUserArticlesByUrl,
		markReaderReadyEmailSent,
		findUnreadSavesForDigest,
		readContent,
		saveReadlistArticle,
		saveArticleAsRequested,
		saveReadlistArticleAsRequested,
		findReadlistArticles,
		countReadlistArticles,
		findReadlistArticleById,
		updateArticleStatusAcrossReadlists,
		deleteReadlistArticle,
		purgeReadlistArticle,
		findReadlistFiling,
		findReadlistRemoval: initFindReadlistRemoval({ client, userArticlesTableName }),
		findSmartMatchRevisions: initFindSmartMatchRevisions({ client, userArticlesTableName }),
		recordSmartMatchRevision: initRecordSmartMatchRevision({ client, userArticlesTableName }),
		fileIntoLiveReadlist,
		markReadlistArticleViewed,
		listUserSavesForUrl,
		countSmartReadlistArticles,
		listUserSavesForUrls,
		assignSavedArticleToReadlist,
		moveReadlistArticles,
	};
}
