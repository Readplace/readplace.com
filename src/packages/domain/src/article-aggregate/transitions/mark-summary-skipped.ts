import type { SummarySkipReason } from "@packages/article-state-types";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface MarkSummarySkippedInput {
	reason: SummarySkipReason;
	/** Persist-moment timestamp, threaded from the caller's clock (see the
	 * submit-link.ts `input.now` precedent), carried as `succeededAt` on the
	 * reader-view-loading-succeeded effect. A skip still reaches the successful
	 * reader-view state — there is just nothing to summarise. */
	now: string;
}

/* `writes` scoped to summary only so a concurrent inline crawl writer is not clobbered. */
export function markSummarySkipped(
	article: Article,
	input: MarkSummarySkippedInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const next: Article = {
		...article,
		summary: { kind: "skipped", reason: input.reason },
	};
	const effects: readonly Effect[] = [
		{
			kind: "publish-reader-view-loading-succeeded",
			url: article.url,
			succeededAt: input.now,
			hasSummary: false,
		},
	];
	const writes: readonly AggregateField[] = ["summary"];
	return { article: next, effects, writes };
}
