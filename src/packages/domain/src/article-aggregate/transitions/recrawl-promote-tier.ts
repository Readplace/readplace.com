import type { Article, ArticleMetadata } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RecrawlPromoteTierInput {
	winnerTier: "tier-0" | "tier-1";
	metadata: ArticleMetadata;
	estimatedReadTime: number;
	contentFetchedAt: string;
}

export function recrawlPromoteTier(
	article: Article,
	input: RecrawlPromoteTierInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		metadata: input.metadata,
		freshness: {
			...article.freshness,
			contentFetchedAt: input.contentFetchedAt,
		},
		estimatedReadTime: input.estimatedReadTime,
		crawl: { kind: "ready" },
		summary: { kind: "pending" },
	};
	const effects: readonly Effect[] = [
		{ kind: "generate-summary", url: article.url },
		{ kind: "publish-recrawl-completed", url: article.url },
	];
	const writes: readonly AggregateField[] = [
		"metadata",
		"freshness",
		"crawl",
		"summary",
	];
	return { article: next, effects, writes };
}
