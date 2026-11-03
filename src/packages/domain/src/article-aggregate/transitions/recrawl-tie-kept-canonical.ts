import type { Article } from "../article.types";
import { type MetadataDisplay, displayedMetadata } from "./displayed-metadata";
import type { CanonicalPublishedOn } from "../canonical-published-on";
import type { Effect } from "../effects.types";
import { stampReaderAvailability } from "../reader-availability";
import type { AggregateField } from "../storage.types";

export interface RecrawlTieKeptCanonicalInput {
	now: string;
	publishedOn: CanonicalPublishedOn;
	display: Extract<MetadataDisplay, { kind: "fresh" | "row" }>;
}

/* Tie kept canonical: the selector returned a tie and a canonical already
 * exists on disk. No tier flip. The crawl axis flips
 * to ready to unstick the row, and no generate-summary effect is emitted
 * — re-summarising identical canonical content would burn DeepSeek tokens
 * for no value. Exception: a summary that failed only because the crawl
 * failed gets reset to pending so the summary worker retries. */
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

	const available = stampReaderAvailability({
		article,
		nextCrawl: { kind: "ready" },
		now: input.now,
	});

	const writes: AggregateField[] = ["crawl", ...available.writes];
	let nextSummary: Article["summary"];
	if (staleCrawlFailedSummary) {
		nextSummary = { kind: "pending", pendingSince: input.now };
		writes.push("summary");
	} else {
		nextSummary = article.summary;
	}

	const candidateMetadata = displayedMetadata({
		article,
		metadata: { ...article.metadata, publishedOn: input.publishedOn ?? article.metadata.publishedOn },
		display: input.display,
	});
	const metadataChanged = (["title", "siteName", "excerpt", "publishedOn"] as const).some(
		(field) => candidateMetadata[field] !== article.metadata[field],
	);
	const nextMetadata = metadataChanged ? candidateMetadata : article.metadata;
	if (metadataChanged) writes.push("metadata");

	const next: Article = {
		...available.article,
		metadata: nextMetadata,
		crawl: { kind: "ready" },
		summary: nextSummary,
	};
	return { article: next, effects, writes };
}
