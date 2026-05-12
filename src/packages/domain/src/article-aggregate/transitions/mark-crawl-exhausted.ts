import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCrawlExhaustedInput {
	reason: string;
	receiveCount: number;
}

/* `writes` scoped to crawl + summary so a concurrent inline metadata/freshness writer is not clobbered. */
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
