import type { CrawlFailureReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkCrawlExhaustedInput {
	reason: CrawlFailureReason;
	receiveCount: number;
}

function reasonAsString(reason: CrawlFailureReason): string {
	switch (reason.kind) {
		case "parse-error":
			return `parse-error: ${reason.detail}`;
		case "fetch-failed":
			return reason.httpStatus !== undefined
				? `fetch-failed: HTTP ${reason.httpStatus}`
				: "fetch-failed";
		case "exhausted-retries":
			return `exhausted-retries (receiveCount=${reason.receiveCount})`;
		case "blocked":
			return `blocked: ${reason.cause}`;
	}
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
		summary: { kind: "failed", reason: { kind: "crawl-failed" } },
	};
	const effects: readonly Effect[] = [
		{
			kind: "publish-crawl-article-failed",
			url: article.url,
			reason: reasonAsString(input.reason),
			receiveCount: input.receiveCount,
		},
	];
	const writes: readonly AggregateField[] = ["crawl", "summary"];
	return { article: next, effects, writes };
}
