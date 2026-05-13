import type { CrawlFailureReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCrawlFailedInput {
	reason: CrawlFailureReason;
}

/* `writes` scoped to crawl only so a concurrent inline summary writer is not clobbered. */
export function markCrawlFailed(
	article: Article,
	input: MarkCrawlFailedInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		crawl: { kind: "failed", reason: input.reason },
	};
	const effects: readonly Effect[] = [];
	const writes: readonly AggregateField[] = ["crawl"];
	return { article: next, effects, writes };
}
