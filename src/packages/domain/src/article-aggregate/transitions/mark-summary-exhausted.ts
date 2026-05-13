import type { SummaryFailureReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkSummaryExhaustedInput {
	reason: SummaryFailureReason;
	receiveCount: number;
}

function reasonAsString(reason: SummaryFailureReason): string {
	switch (reason.kind) {
		case "exhausted-retries":
			return `exhausted-retries (receiveCount=${reason.receiveCount})`;
		case "crawl-failed":
			return "crawl-failed";
		case "model-overload":
			return "model-overload";
		case "content-too-large":
			return `content-too-large (${reason.tokens} tokens)`;
	}
}

/* Summary-only DLQ path: crawl axis is left untouched (unlike markCrawlExhausted
 * which is cross-axis), so a concurrent inline crawl writer is not clobbered. */
export function markSummaryExhausted(
	article: Article,
	input: MarkSummaryExhaustedInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		summary: { kind: "failed", reason: input.reason },
	};
	const effects: readonly Effect[] = [
		{
			kind: "publish-summary-generation-failed",
			url: article.url,
			reason: reasonAsString(input.reason),
			receiveCount: input.receiveCount,
		},
	];
	const writes: readonly AggregateField[] = ["summary"];
	return { article: next, effects, writes };
}
