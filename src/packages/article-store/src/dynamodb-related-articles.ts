import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { CrawlStatusSchema } from "@packages/article-state-types";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
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
	FindRelatedTargetArticle,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
	RelatedArticleDisplay,
	RelatedCandidate,
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
	}): Promise<void> {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(params.url);
		try {
			await userArticles.update({
				Key: { userId: params.userId, url: articleResourceUniqueId.value },
				UpdateExpression: params.updateExpression,
				ConditionExpression: "attribute_exists(savedAt)",
				ExpressionAttributeValues: params.expressionAttributeValues,
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
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
			// The stub a fresh save writes is `Article from <hostname>` over a
			// siteName of that same hostname, so this recognises it without
			// re-parsing the url.
			hasStubMetadata: article.title === `Article from ${article.siteName}`,
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

	const findRelatedCandidateArticles: FindRelatedCandidateArticles = async (
		params,
	) => {
		const excludeKey = ArticleResourceUniqueId.parse(params.excludeUrl).value;
		const savedUrls: string[] = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;

		do {
			/* c8 ignore next -- V8 async continuation branch on the awaited page read, see bcoe/c8#319 */
			const { items, lastEvaluatedKey } = await userArticles.query({
				IndexName: "userId-savedAt-index",
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

		if (savedUrls.length === 0) return [];

		const byUrl = await readArticles(savedUrls, ARTICLE_FIELDS);

		const candidates: RelatedCandidate[] = [];
		for (const url of savedUrls) {
			const article = usable(DescribableArticle, byUrl.get(url));
			if (!article) continue;
			candidates.push({
				url,
				title: article.title,
				siteName: article.siteName,
				description: descriptionOf(article),
			});
		}
		return candidates;
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

		const keyed = links.map((link) => ({
			key: ArticleResourceUniqueId.parse(link.url).value,
			reason: link.reason,
		}));

		const stillSaved = await batchGetFromTable({
			client,
			tableName: userArticlesTableName,
			schema: z.looseObject({ url: z.string() }),
			keys: keyed.map((link) => ({ userId: params.userId, url: link.key })),
			projection: ["url"],
		});
		const savedKeys = new Set(stillSaved.map((saved) => saved.url));

		const byUrl = await readArticles([...savedKeys], ARTICLE_FIELDS);

		const items: RelatedArticleDisplay[] = [];
		for (const link of keyed) {
			if (!savedKeys.has(link.key)) continue;
			const article = usable(LinkableArticle, byUrl.get(link.key));
			if (!article) continue;
			items.push({
				id: ReaderArticleHashIdSchema.parse(article.routeId),
				title: article.title,
				siteName: article.siteName,
				reason: link.reason,
			});
		}
		return { status: "ready", items };
	};

	return {
		findRelatedArticles,
		findRelatedCandidateArticles,
		findRelatedTargetArticle,
		markRelatedArticlesReady,
		markRelatedArticlesSkipped,
	};
}
