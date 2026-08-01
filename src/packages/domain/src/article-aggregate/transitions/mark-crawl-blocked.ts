import type { CrawlFailureReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCrawlBlockedInput {
	reason: Extract<CrawlFailureReason, { kind: "blocked" }>;
}

/* Cross-axis: pairs the blocked crawl with summary=skipped in one atomic save so
 * a partial terminalisation can't strand summary=pending. The comprehensive
 * queue is maxReceiveCount=1, so a throw between two separate writes routes the
 * message to a DLQ handler that only advances the crawl axis — leaving the
 * summary pending and paging the stuck-articles canary over a transient spend
 * cap. */
export function markCrawlBlocked(
	article: Article,
	input: MarkCrawlBlockedInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	/* A re-crawl of an already-served article can be refused by the origin's edge
	 * long after a first crawl succeeded. Single writer per terminal state, as in
	 * markCrawlNotFound: a block never overwrites content a reader can already
	 * read — otherwise one 403 on a refresh turns a readable article into the
	 * "we couldn't fetch this" notice and drops its summary. */
	if (article.crawl.kind === "ready") {
		return { article, effects: [], writes: [] };
	}

	const next: Article = {
		...article,
		crawl: { kind: "failed", reason: input.reason },
		summary: { kind: "skipped", reason: "crawl-failed" },
	};
	const effects: readonly Effect[] = [];
	const writes: readonly AggregateField[] = ["crawl", "summary"];
	return { article: next, effects, writes };
}
