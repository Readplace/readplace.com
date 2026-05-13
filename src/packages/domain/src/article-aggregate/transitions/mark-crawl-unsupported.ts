import type { CrawlUnsupportedReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCrawlUnsupportedInput {
	reason: CrawlUnsupportedReason;
}

/* Cross-axis: pairs the unsupported crawl with summary=skipped so the summary
 * canary doesn't keep flagging the row forever waiting on a pending summary. */
export function markCrawlUnsupported(
	article: Article,
	input: MarkCrawlUnsupportedInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		crawl: { kind: "unsupported", reason: input.reason },
		summary: { kind: "skipped", reason: "crawl-unsupported" },
	};
	const effects: readonly Effect[] = [];
	const writes: readonly AggregateField[] = ["crawl", "summary"];
	return { article: next, effects, writes };
}
