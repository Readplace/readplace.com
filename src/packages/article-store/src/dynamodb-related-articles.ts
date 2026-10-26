import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ArticleStatusSchema,
	ReaderArticleHashIdSchema,
	type ComparableArticle,
	articleDestinationUrl,
	articleLinkedDisplay,
	isNonArticleHost,
	isSameArticle,
	stubMetadataFor,
} from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import type {
	FindRelatedArticles,
	FindRelatedCandidateArticles,
	FindRelatedReadCandidateArticles,
	FindRelatedTargetArticle, FindSkippedNextReadSaves,
	MarkRelatedArticlesOutcome,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
	RelatedArticleDisplay,
} from "@packages/provider-contracts/related-articles";
import { z } from "zod";
import {
	ARTICLE_FIELDS,
	ArticleRelatedRow,
	DescribableArticle,
	LinkableArticle,
	descriptionOf,
	initArticleReads,
	usable,
} from "./related-articles-rows";
import { decodeUserArticlePartition } from "./user-readlist-partition";

const RelatedArticleLinkRow = z.object({
	url: z.string(),
	reason: z.string(),
});

const UserArticleRelatedRow = z.object({
	userId: z.string(),
	url: z.string(),
	savedAt: dynamoField(z.string()),
	relatedStatus: dynamoField(z.enum(["ready", "skipped"])),
	relatedArticles: dynamoField(z.array(RelatedArticleLinkRow)),
	relatedComputedAt: dynamoField(z.string()),
	relatedInputTokens: dynamoField(z.number()),
	relatedOutputTokens: dynamoField(z.number()),
});

const READY_UPDATE_EXPRESSION =
	"SET relatedStatus = :status, relatedArticles = :articles, relatedComputedAt = :at, relatedInputTokens = :inputTokens, relatedOutputTokens = :outputTokens";
const SKIPPED_UPDATE_EXPRESSION =
	"SET relatedStatus = :status, relatedComputedAt = :at REMOVE relatedArticles";

export function initDynamoDbRelatedArticles(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	userArticlesTableName: string;
}): {
	findRelatedArticles: FindRelatedArticles;
	findRelatedCandidateArticles: FindRelatedCandidateArticles;
	findRelatedReadCandidateArticles: FindRelatedReadCandidateArticles;
	findRelatedTargetArticle: FindRelatedTargetArticle;
	findSkippedNextReadSaves: FindSkippedNextReadSaves;
	markRelatedArticlesReady: MarkRelatedArticlesReady;
	markRelatedArticlesSkipped: MarkRelatedArticlesSkipped;
	replaceSkippedRelatedArticlesWithReady: MarkRelatedArticlesReady;
	replaceSkippedRelatedArticlesWithSkip: MarkRelatedArticlesSkipped;
} {
	const { client, tableName, userArticlesTableName } = deps;

	const userArticles = defineDynamoTable({
		client,
		tableName: userArticlesTableName,
		schema: UserArticleRelatedRow,
	});
	const articles = defineDynamoTable({
		client,
		tableName,
		schema: ArticleRelatedRow,
	});

	const { readArticles, hydrateCandidates } = initArticleReads({ client, tableName });

	async function writeRelated(params: {
		userId: UserId;
		url: string;
		updateExpression: string;
		expressionAttributeValues: Record<string, unknown>;
	}): Promise<MarkRelatedArticlesOutcome> {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		try {
			await userArticles.update({
				Key: { userId: params.userId, url: articleResourceUniqueId.value },
				UpdateExpression: params.updateExpression,
				// Terminal-once: two saves of the same article race each other through
				// the worker, and the loser must not repaint a settled row with its own
				// (equally valid, differently ordered) answer.
				ConditionExpression:
					"attribute_exists(savedAt) AND attribute_not_exists(relatedStatus)",
				ExpressionAttributeValues: params.expressionAttributeValues,
			});
			return "stored";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "superseded";
			throw error;
		}
	}

	const markRelatedArticlesReady: MarkRelatedArticlesReady = async (params) =>
		writeRelated({
			userId: params.userId,
			url: params.url,
			updateExpression: READY_UPDATE_EXPRESSION,
			expressionAttributeValues: {
				":status": "ready",
				":articles": params.relatedArticles.map((link) => ({
					url: link.url,
					reason: link.reason,
				})),
				":at": params.at.toISOString(),
				":inputTokens": params.inputTokens,
				":outputTokens": params.outputTokens,
			},
		});

	const markRelatedArticlesSkipped: MarkRelatedArticlesSkipped = async (params) =>
		writeRelated({
			userId: params.userId,
			url: params.url,
			updateExpression: SKIPPED_UPDATE_EXPRESSION,
			expressionAttributeValues: {
				":status": "skipped",
				":at": params.at.toISOString(),
			},
		});

	const findRelatedTargetArticle: FindRelatedTargetArticle = async (url, options) => {
		if (isNonArticleHost(url)) return { state: "not-an-article" };
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await articles.get(
			{ url: articleResourceUniqueId.value },
			{ projection: ARTICLE_FIELDS, consistentRead: options?.consistentRead },
		);
		if (!row) return { state: "absent" };
		if (row.purgedAt) return { state: "purged" };
		const article = usable(DescribableArticle, row);
		if (!article) return { state: "absent" };
		return {
			state: "found",
			article: {
				crawlStatus: article.crawlStatus,
				destinationUrl: articleDestinationUrl({ url: article.originalUrl ?? article.url, displayUrl: article.displayUrl }),
				title: article.title,
				siteName: article.siteName,
				description: descriptionOf(article),
				hasSummary: article.summary !== undefined,
				// Recognised off the stored siteName so the url never has to be re-parsed.
				hasStubMetadata: article.title === stubMetadataFor(article.siteName).title || (article.title === article.siteName && article.excerpt === ""),
				...(article.readerAvailableAt !== undefined
					? { readerAvailableAt: new Date(article.readerAvailableAt) }
					: {}),
			},
		};
	};

	const findRelatedCandidateArticles: FindRelatedCandidateArticles = async (
		params,
	) => {
		const excludeKey = ArticleResourceUniqueId.parse(params.excludeUrl).value;
		const savedUrls: string[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;

		do {
			const { items, lastEvaluatedKey } = await userArticles.query({
				IndexName: "userId-savedAt-index",
				KeyConditionExpression: "userId = :userId",
				FilterExpression: "#status = :status",
				/* c8 ignore next -- V8 block-coverage phantom on the awaited page read, see bcoe/c8#319 */
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					":userId": params.userId,
					":status": "unread",
				},
				ScanIndexForward: false,
				ExclusiveStartKey: exclusiveStartKey,
			});
			for (const item of items) {
				if (item.url === excludeKey) continue;
				if (savedUrls.length >= params.limit) break;
				savedUrls.push(item.url);
			}
			exclusiveStartKey = lastEvaluatedKey;
		} while (exclusiveStartKey && savedUrls.length < params.limit);

		return hydrateCandidates(savedUrls);
	};

	const findRelatedReadCandidateArticles: FindRelatedReadCandidateArticles = async (
		params,
	) => {
		const excludeKey = ArticleResourceUniqueId.parse(params.excludeUrl).value;
		/* c8 ignore next -- V8 block-coverage phantom on the awaited page read, see bcoe/c8#319 */
		const savedUrls: string[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;

		do {
			const { items, lastEvaluatedKey } = await userArticles.query({
				IndexName: "userId-readAt-index",
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": params.userId },
				ScanIndexForward: false,
				ExclusiveStartKey: exclusiveStartKey,
			});
			for (const item of items) {
				if (item.url === excludeKey) continue;
				if (savedUrls.length >= params.limit) break;
				savedUrls.push(item.url);
			}
			exclusiveStartKey = lastEvaluatedKey;
		} while (exclusiveStartKey && savedUrls.length < params.limit);

		return hydrateCandidates(savedUrls);
	};

	const findRelatedArticles: FindRelatedArticles = async (params) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		const row = await userArticles.get({
			userId: params.userId,
			url: articleResourceUniqueId.value,
		});
		if (!row?.relatedStatus) return { status: "pending" };
		if (row.relatedStatus === "skipped") return { status: "skipped" };

		const links = row.relatedArticles;
		assert(links, "a ready related row is written with its relations");
		if (links.length === 0) return { status: "ready", items: [] };

		// Stored relation urls ARE canonical table keys (the candidate query reads
		// them off the user-articles sort key), so re-parsing would reject them:
		// the normaliser takes real URLs and a key has no scheme.
		const keyed = links.map((link) => ({
			key: link.url,
			reason: link.reason,
		}));

		const stillSaved = await batchGetFromTable({
			client,
			tableName: userArticlesTableName,
			schema: z.looseObject({
				url: z.string(),
				status: ArticleStatusSchema,
				savedAt: z.string(),
				readAt: z.string().optional(),
			}),
			keys: keyed.map((link) => ({ userId: params.userId, url: link.key })),
			projection: ["url", "status", "savedAt", "readAt"],
		});
		const savedByKey = new Map(
			stillSaved.map((saved) => [saved.url, saved] as const),
		);
		if (savedByKey.size === 0) return { status: "ready", items: [] };

		const byUrl = await readArticles(
			[...new Set([...savedByKey.keys(), articleResourceUniqueId.value])],
			ARTICLE_FIELDS,
		);
		const target = usable(ArticleRelatedRow, byUrl.get(articleResourceUniqueId.value));

		const kept: ComparableArticle[] = [];
		const items: RelatedArticleDisplay[] = [];
		for (const link of keyed) {
			const saved = savedByKey.get(link.key);
			if (!saved) continue;
			const article = usable(LinkableArticle, byUrl.get(link.key));
			if (!article) continue;
			if (target && isSameArticle({ article, other: target })) continue;
			if (kept.some((earlier) => isSameArticle({ article, other: earlier }))) continue;
			kept.push(article);
			const display = articleLinkedDisplay({
				url: article.originalUrl,
				destinationUrl: articleDestinationUrl({ url: article.originalUrl, displayUrl: article.displayUrl }),
				title: article.title,
				siteName: article.siteName,
			});
			items.push({
				id: ReaderArticleHashIdSchema.parse(article.routeId),
				title: display.title,
				siteName: display.siteName,
				reason: link.reason,
				status: saved.status,
				savedAt: new Date(saved.savedAt),
				...(saved.readAt !== undefined ? { readAt: new Date(saved.readAt) } : {}),
			});
		}
		return { status: "ready", items };
	};

	async function replaceSkippedRelated(params: {
		userId: UserId;
		url: string;
		updateExpression: string;
		expressionAttributeValues: Record<string, unknown>;
	}): Promise<MarkRelatedArticlesOutcome> {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		try {
			await userArticles.update({
				Key: { userId: params.userId, url: articleResourceUniqueId.value },
				UpdateExpression: params.updateExpression,
				ConditionExpression: "attribute_exists(savedAt) AND relatedStatus = :skipped",
				ExpressionAttributeValues: {
					...params.expressionAttributeValues,
					":skipped": "skipped",
				},
			});
			return "stored";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "superseded";
			throw error;
		}
	}

	const readyValues = (params: Parameters<MarkRelatedArticlesReady>[0]): Record<string, unknown> => ({
		":status": "ready",
		":articles": params.relatedArticles.map((link) => ({
			url: link.url,
			reason: link.reason,
		})),
		":at": params.at.toISOString(),
		":inputTokens": params.inputTokens,
		":outputTokens": params.outputTokens,
	});

	const skippedValues = (params: Parameters<MarkRelatedArticlesSkipped>[0]): Record<string, unknown> => ({
		":status": "skipped",
		":at": params.at.toISOString(),
	});

	const replaceSkippedRelatedArticlesWithReady: MarkRelatedArticlesReady = async (params) =>
		replaceSkippedRelated({
			userId: params.userId,
			url: params.url,
			updateExpression: READY_UPDATE_EXPRESSION,
			expressionAttributeValues: readyValues(params),
		});

	const replaceSkippedRelatedArticlesWithSkip: MarkRelatedArticlesSkipped = async (params) =>
		replaceSkippedRelated({
			userId: params.userId,
			url: params.url,
			updateExpression: SKIPPED_UPDATE_EXPRESSION,
			expressionAttributeValues: skippedValues(params),
		});

	const findSkippedNextReadSaves: FindSkippedNextReadSaves = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const saves: { userId: UserId; skippedAt: Date }[] = [];
		await forEachQueryPage(
			userArticles,
			{
				IndexName: "url-index",
				KeyConditionExpression: "#url = :url",
				FilterExpression: "relatedStatus = :skipped",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":url": articleResourceUniqueId.value,
					":skipped": "skipped",
				},
			},
			async (items) => {
				for (const item of items) {
					const { userId, readlist } = decodeUserArticlePartition(item.userId);
					assert(readlist === undefined, "Next read is written only on the default partition");
					assert(item.relatedComputedAt, "every Next-read skip write stamps relatedComputedAt");
					saves.push({ userId, skippedAt: new Date(item.relatedComputedAt) });
				}
			},
		);
		return saves;
	};

	return {
		findRelatedArticles,
		findRelatedCandidateArticles,
		findRelatedReadCandidateArticles,
		findRelatedTargetArticle,
		findSkippedNextReadSaves,
		markRelatedArticlesReady,
		markRelatedArticlesSkipped,
		replaceSkippedRelatedArticlesWithReady,
		replaceSkippedRelatedArticlesWithSkip,
	};
}
