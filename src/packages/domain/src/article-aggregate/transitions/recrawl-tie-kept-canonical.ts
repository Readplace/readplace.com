import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RecrawlTieKeptCanonicalInput {
	now: string;
}

/* Tie kept canonical: the selector returned a tie and a canonical already
 * exists on disk. No tier flip, no metadata refresh. The crawl axis flips
 * to ready to unstick the row, and no generate-summary effect is emitted
 * — re-summarising identical canonical content would burn DeepSeek tokens
 * for no value. Exception: a failed(crawl-failed) summary is a cross-axis
 * pairing from markCrawlExhausted that is stale now that crawl succeeded;
 * that gets reset to pending so the summary worker retries. */
export function recrawlTieKeptCanonical(
	article: Article,
	input: RecrawlTieKeptCanonicalInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const staleCrawlFailedSummary =
		article.summary.kind === "failed" &&
		article.summary.reason.kind === "crawl-failed";

	const effects: Effect[] = [];
	if (staleCrawlFailedSummary) {
		effects.push({ kind: "generate-summary", url: article.url });
	}
	effects.push({ kind: "publish-recrawl-completed", url: article.url });

	const writes: AggregateField[] = ["crawl"];
	let nextSummary: Article["summary"];
	if (staleCrawlFailedSummary) {
		nextSummary = { kind: "pending", pendingSince: input.now };
		writes.push("summary");
	} else {
		nextSummary = article.summary;
	}

	const next: Article = {
		...article,
		crawl: { kind: "ready" },
		summary: nextSummary,
	};
	return { article: next, effects, writes };
}
