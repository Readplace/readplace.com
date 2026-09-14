import { CrawlStatusSchema } from "@packages/article-state-types";
import { stubMetadataFor } from "@packages/domain/article";
import {
	type DynamoDBDocumentClient,
	batchGetFromTable,
} from "@packages/hutch-storage-client";
import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import { dynamoField } from "@packages/hutch-storage-client";
import { z } from "zod";

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

export const ARTICLE_FIELDS = ArticleRelatedRow.keyof().options;

const DescribableArticle = ArticleRelatedRow.extend({
	title: z.string(),
	siteName: z.string(),
	excerpt: z.string(),
});

export const LinkableArticle = ArticleRelatedRow.extend({
	routeId: z.string(),
	title: z.string(),
	siteName: z.string(),
});

/** Rows that fail their schema, or carry a tombstone, are dropped rather than
 * defaulted — a half-written row can never reach the model as empty strings, or
 * the reader as a link with no title. */
export function usable<T extends z.ZodObject>(
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

export function initArticleReads(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	readArticles: (
		keys: string[],
		projection: readonly (keyof z.infer<typeof ArticleRelatedRow>)[],
	) => Promise<Map<string, unknown>>;
	hydrateCandidates: (savedUrls: string[]) => Promise<{
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

	async function hydrateCandidates(savedUrls: string[]): Promise<{
		candidates: RelatedCandidate[];
		awaitingCrawl: number;
	}> {
		if (savedUrls.length === 0) return { candidates: [], awaitingCrawl: 0 };

		const byUrl = await readArticles(savedUrls, ARTICLE_FIELDS);

		const candidates: RelatedCandidate[] = [];
		let awaitingCrawl = 0;
		/* c8 ignore next -- V8 block-coverage phantom on the for...of iterator protocol, see bcoe/c8#319 */
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

	return { readArticles, hydrateCandidates };
}
