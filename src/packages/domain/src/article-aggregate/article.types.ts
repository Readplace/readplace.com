import type { ArticleMetadata } from "../article/article.types";
import type { CrawlStage, SummaryStage } from "../article/progress-mapping";

export type { ArticleMetadata };

export interface ArticleFreshness {
	etag?: string;
	lastModified?: string;
	contentFetchedAt: string;
}

export type CrawlState =
	| { kind: "pending"; stage?: CrawlStage }
	| { kind: "ready" }
	| { kind: "failed"; reason: string }
	| { kind: "unsupported"; reason: string };

export type SummaryState =
	| { kind: "pending"; stage?: SummaryStage }
	| {
			kind: "ready";
			summary: string;
			excerpt?: string;
			inputTokens?: number;
			outputTokens?: number;
	  }
	| { kind: "failed"; reason: string }
	| { kind: "skipped"; reason?: string };

/**
 * The Article aggregate. One typed row, one save, one dispatch per transition.
 *
 * `url` is the caller-supplied (parseable) URL. The storage adapter is
 * responsible for any normalization required to derive a partition key.
 * Downstream effects pass `url` through unchanged so subscribers can re-parse
 * it as a URL when they re-read the row.
 */
export interface Article {
	url: string;
	metadata: ArticleMetadata;
	freshness: ArticleFreshness;
	estimatedReadTime: number;
	crawl: CrawlState;
	summary: SummaryState;
}
