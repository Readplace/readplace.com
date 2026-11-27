import type { CrawlFailureReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export function failCrawlAndSkipSummary(
	article: Article,
	reason: Extract<CrawlFailureReason, { kind: "blocked" | "not-found" }>,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	if (article.crawl.kind === "ready") {
		return { article, effects: [], writes: [] };
	}

	const next: Article = {
		...article,
		crawl: { kind: "failed", reason },
		summary: { kind: "skipped", reason: "crawl-failed" },
	};
	const effects: readonly Effect[] = [];
	const writes: readonly AggregateField[] = ["crawl", "summary"];
	return { article: next, effects, writes };
}
