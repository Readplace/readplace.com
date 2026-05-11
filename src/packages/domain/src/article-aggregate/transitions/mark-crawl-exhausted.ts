import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCrawlExhaustedInput {
	reason: string;
	receiveCount: number;
}

/**
 * Collapse the four DLQ handlers' hand-rolled "markCrawlFailed +
 * markSummaryFailed + publish CrawlArticleFailedEvent" sequence onto one
 * transition. Returning both terminal states alongside the publish effect
 * makes it a compile error for a future writer to flip only one axis — the
 * cross-axis stuck-row pathology this Phase 2 migration is betting it can
 * eliminate.
 *
 * `writes: ["crawl", "summary"]` scopes the aggregate save so a concurrent
 * inline metadata/freshness writer is not clobbered on retry.
 */
export function markCrawlExhausted(
	article: Article,
	input: MarkCrawlExhaustedInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		crawl: { kind: "failed", reason: input.reason },
		summary: { kind: "failed", reason: "crawl failed" },
	};
	const effects: readonly Effect[] = [
		{
			kind: "publish-crawl-article-failed",
			url: article.url,
			reason: input.reason,
			receiveCount: input.receiveCount,
		},
	];
	const writes: readonly AggregateField[] = ["crawl", "summary"];
	return { article: next, effects, writes };
}
