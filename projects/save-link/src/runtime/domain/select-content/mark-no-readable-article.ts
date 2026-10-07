import type { CrawlFailureReason } from "@packages/article-state-types";
import type { Article, AggregateField, Effect } from "@packages/domain/article-aggregate";

export function markNoReadableArticle(article: Article, input: { reason: CrawlFailureReason }): {
	article: Article;
	writes: readonly AggregateField[];
	effects: readonly Effect[];
} {
	return {
		article: {
			...article,
			crawl: { kind: "failed", reason: input.reason },
			summary: { kind: "skipped", reason: "crawl-failed" },
		},
		writes: ["crawl", "summary"],
		effects: [{ kind: "publish-crawl-article-completed", url: article.url }],
	};
}
