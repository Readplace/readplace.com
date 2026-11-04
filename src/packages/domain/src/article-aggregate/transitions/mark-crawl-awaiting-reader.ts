import type { DeferredMeteredLeg } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCrawlAwaitingReaderInput {
	deferredLeg: DeferredMeteredLeg;
}

export function markCrawlAwaitingReader(
	article: Article,
	input: MarkCrawlAwaitingReaderInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		crawl: {
			kind: "unsupported",
			reason: { kind: "awaiting-reader", deferredLeg: input.deferredLeg },
		},
		summary: { kind: "skipped", reason: "awaiting-reader" },
	};
	const effects: readonly Effect[] = [];
	const writes: readonly AggregateField[] = ["crawl", "summary"];
	return { article: next, effects, writes };
}
