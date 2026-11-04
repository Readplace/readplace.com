import { CrawlStatusSchema } from "@packages/article-state-types";
import { type Viewer, articleDestinationUrl, isNonArticleHost, mayReadItem, stubMetadataFor } from "@packages/domain/article";
import {
	type DynamoDBDocumentClient,
	batchGetFromTable,
} from "@packages/hutch-storage-client";
import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { dynamoField } from "@packages/hutch-storage-client";
import { z } from "zod";

export const ArticleRelatedRow = z.object({
	url: z.string(),
	routeId: dynamoField(z.string()),
	originalUrl: dynamoField(z.string()),
	displayUrl: dynamoField(z.string()),
	title: dynamoField(z.string()),
	siteName: dynamoField(z.string()),
	excerpt: dynamoField(z.string()),
	summary: dynamoField(z.string()),
	summaryExcerpt: dynamoField(z.string()),
	crawlStatus: dynamoField(CrawlStatusSchema),
	purgedAt: dynamoField(z.string()),
	readerAvailableAt: dynamoField(z.string()),
	ownerUserId: dynamoField(UserIdSchema),
});

const LooseArticleRelatedRow = z.looseObject({ url: z.string() });

export const ARTICLE_FIELDS = ArticleRelatedRow.keyof().options;

export const DescribableArticle = ArticleRelatedRow.extend({
	title: z.string(),
	siteName: z.string(),
	excerpt: z.string(),
});

export const LinkableArticle = ArticleRelatedRow.extend({
	routeId: z.string(),
	originalUrl: z.string(),
	title: z.string(),
	siteName: z.string(),
});

/** Rows that fail their schema, or carry a tombstone, are dropped rather than
 * defaulted — a half-written row can never reach the model as empty strings, or
 * the reader as a link with no title. */
export function usable<T extends z.ZodType<z.infer<typeof ArticleRelatedRow>>>(
	schema: T,
	row: unknown,
): z.infer<T> | undefined {
	const parsed = schema.safeParse(row);
	if (!parsed.success) return undefined;
	if (parsed.data.purgedAt) return undefined;
	if (isNonArticleHost(parsed.data.originalUrl ?? `https://${parsed.data.url}`)) return undefined;
	return parsed.data;
}

export function readableBy<T extends { url: string; originalUrl?: string; ownerUserId?: UserId }>(read: {
	article: T | undefined;
	viewer: Viewer;
}): T | undefined {
	const { article, viewer } = read;
	if (!article) return undefined;
	const url = article.originalUrl ?? `https://${article.url}`;
	return mayReadItem({ url, viewer, ownerUserId: article.ownerUserId }) ? article : undefined;
}

export function descriptionOf(row: {
	summary?: string;
	summaryExcerpt?: string;
	excerpt: string;
}): string {
	return row.summary ?? row.summaryExcerpt ?? row.excerpt;
}

export function initArticleReads(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	readArticles: (
		keys: string[],
		projection: readonly (keyof z.infer<typeof ArticleRelatedRow>)[],
	) => Promise<Map<string, unknown>>;
	hydrateCandidates: (read: { savedUrls: string[]; viewer: Viewer }) => Promise<{
		candidates: RelatedCandidate[];
		awaitingCrawl: number;
	}>;
} {
	const { client, tableName } = deps;

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

	async function hydrateCandidates(read: { savedUrls: string[]; viewer: Viewer }): Promise<{
		candidates: RelatedCandidate[];
		awaitingCrawl: number;
	}> {
		const { savedUrls, viewer } = read;
		if (savedUrls.length === 0) return { candidates: [], awaitingCrawl: 0 };

		const byUrl = await readArticles(savedUrls, ARTICLE_FIELDS);

		const candidates: RelatedCandidate[] = [];
		let awaitingCrawl = 0;
		/* c8 ignore next -- V8 block-coverage phantom on the for...of iterator protocol, see bcoe/c8#319 */
		for (const url of savedUrls) {
			const article = readableBy({ article: usable(DescribableArticle, byUrl.get(url)), viewer });
			if (!article) continue;
			if (article.title === stubMetadataFor(article.siteName).title) {
				if (article.crawlStatus === "pending") awaitingCrawl += 1;
				continue;
			}
			candidates.push({
				url,
				destinationUrl: articleDestinationUrl({ url: article.originalUrl ?? article.url, displayUrl: article.displayUrl }),
				title: article.title,
				siteName: article.siteName,
				description: descriptionOf(article),
			});
		}
		return { candidates, awaitingCrawl };
	}

	return { readArticles, hydrateCandidates };
}
