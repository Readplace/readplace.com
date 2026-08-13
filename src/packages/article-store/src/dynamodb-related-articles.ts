import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { CrawlStatusSchema } from "@packages/article-state-types";
import {
	ArticleStatusSchema,
	ReaderArticleHashIdSchema,
	stubMetadataFor,
} from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	batchGetFromTable,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import type {
	FindRelatedArticles,
	FindRelatedCandidateArticles,
	FindRelatedReadCandidateArticles,
	FindRelatedTargetArticle,
	MarkRelatedArticlesOutcome,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
	RelatedArticleDisplay,
	RelatedCandidate,
	RelatedCandidates,
} from "@packages/provider-contracts/related-articles";
import { z } from "zod";

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

const ArticleRelatedRow = z.object({
	url: z.string(),
	routeId: dynamoField(z.string()),
	title: dynamoField(z.string()),
	siteName: dynamoField(z.string()),
	excerpt: dynamoField(z.string()),
	summary: dynamoField(z.string()),
	summaryExcerpt: dynamoField(z.string()),
	crawlStatus: dynamoField(CrawlStatusSchema),
	purgedAt: dynamoField(z.string()),
});

const LooseArticleRelatedRow = z.looseObject({ url: z.string() });

const ARTICLE_FIELDS = ArticleRelatedRow.keyof().options;

const DescribableArticle = ArticleRelatedRow.extend({
	title: z.string(),
	siteName: z.string(),
	excerpt: z.string(),
});

const LinkableArticle = ArticleRelatedRow.extend({
	routeId: z.string(),
	title: z.string(),
	siteName: z.string(),
});

/** Rows that fail their schema, or carry a tombstone, are dropped rather than
 * defaulted — a half-written row can never reach the model as empty strings, or
 * the reader as a link with no title. */
function usable<T extends z.ZodObject>(
	schema: T,
	row: unknown,
): z.infer<T> | undefined {
	const parsed = schema.safeParse(row);
	if (!parsed.success) return undefined;
	return parsed.data.purgedAt ? undefined : parsed.data;
}

function descriptionOf(row: {
	summary?: string;
	summaryExcerpt?: string;
	excerpt: string;
}): string {
	return row.summary ?? row.summaryExcerpt ?? row.excerpt;
}

export function initDynamoDbRelatedArticles(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	userArticlesTableName: string;
}): {
	findRelatedArticles: FindRelatedArticles;
	findRelatedCandidateArticles: FindRelatedCandidateArticles;
	findRelatedReadCandidateArticles: FindRelatedReadCandidateArticles;
	findRelatedTargetArticle: FindRelatedTargetArticle;
	markRelatedArticlesReady: MarkRelatedArticlesReady;
	markRelatedArticlesSkipped: MarkRelatedArticlesSkipped;
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
			updateExpression:
				"SET relatedStatus = :status, relatedArticles = :articles, relatedComputedAt = :at, relatedInputTokens = :inputTokens, relatedOutputTokens = :outputTokens",
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
			updateExpression:
				"SET relatedStatus = :status, relatedComputedAt = :at REMOVE relatedArticles",
			expressionAttributeValues: {
				":status": "skipped",
				":at": params.at.toISOString(),
			},
		});

	const findRelatedTargetArticle: FindRelatedTargetArticle = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await articles.get(
			{ url: articleResourceUniqueId.value },
			{ projection: ARTICLE_FIELDS },
		);
		const article = usable(DescribableArticle, row);
		if (!article) return undefined;
		return {
			crawlStatus: article.crawlStatus,
			title: article.title,
			siteName: article.siteName,
			description: descriptionOf(article),
			// Recognised off the stored siteName so the url never has to be re-parsed.
			hasStubMetadata: article.title === stubMetadataFor(article.siteName).title,
		};
	};

	async function readArticles(
		keys: string[],
		projection: readonly (keyof z.infer<typeof ArticleRelatedRow>)[],
	): Promise<Map<string, unknown>> {
		const rows = await batchGetFromTable({
			client,
			tableName,
			schema: LooseArticleRelatedRow,
			keys: keys.map((url) => ({ url })),
			projection,
		});
		return new Map(rows.map((row) => [row.url, row]));
	}

	async function hydrateCandidates(
		savedUrls: string[],
	): Promise<RelatedCandidates> {
		if (savedUrls.length === 0) return { candidates: [], awaitingCrawl: 0 };

		const byUrl = await readArticles(savedUrls, ARTICLE_FIELDS);

		const candidates: RelatedCandidate[] = [];
		let awaitingCrawl = 0;
		for (const url of savedUrls) {
			const article = usable(DescribableArticle, byUrl.get(url));
			if (!article) continue;
			if (article.title === stubMetadataFor(article.siteName).title) {
				if (article.crawlStatus === "pending") awaitingCrawl += 1;
				continue;
			}
			candidates.push({
				url,
				title: article.title,
				siteName: article.siteName,
				description: descriptionOf(article),
			});
		}
		return { candidates, awaitingCrawl };
	}

	const findRelatedCandidateArticles: FindRelatedCandidateArticles = async (
		params,
	) => {
		const excludeKey = ArticleResourceUniqueId.parse(params.excludeUrl).value;
		const savedUrls: string[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;

		do {
			const { items, lastEvaluatedKey } = await userArticles.query({
				IndexName: "userId-savedAt-index",
				/* c8 ignore next -- V8 block-coverage phantom on the awaited page read, see bcoe/c8#319 */
				KeyConditionExpression: "userId = :userId",
				FilterExpression: "#status = :status",
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

	/* c8 ignore next -- V8 block-coverage phantom on the awaited page read, see bcoe/c8#319 */
	const findRelatedReadCandidateArticles: FindRelatedReadCandidateArticles = async (
		params,
	) => {
		const excludeKey = ArticleResourceUniqueId.parse(params.excludeUrl).value;
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

		const byUrl = await readArticles([...savedByKey.keys()], ARTICLE_FIELDS);

		const items: RelatedArticleDisplay[] = [];
		for (const link of keyed) {
			const saved = savedByKey.get(link.key);
			if (!saved) continue;
			const article = usable(LinkableArticle, byUrl.get(link.key));
			if (!article) continue;
			items.push({
				id: ReaderArticleHashIdSchema.parse(article.routeId),
				title: article.title,
				siteName: article.siteName,
				reason: link.reason,
				status: saved.status,
				savedAt: new Date(saved.savedAt),
				...(saved.readAt !== undefined ? { readAt: new Date(saved.readAt) } : {}),
			});
		}
		return { status: "ready", items };
	};

	return {
		findRelatedArticles,
		findRelatedCandidateArticles,
		findRelatedReadCandidateArticles,
		findRelatedTargetArticle,
		markRelatedArticlesReady,
		markRelatedArticlesSkipped,
	};
}
