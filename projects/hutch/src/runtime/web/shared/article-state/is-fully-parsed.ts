import {
	type CrawlStatus,
	type SummaryStatus,
	deriveReaderViewStatus,
} from "@packages/article-state-types";

/* A missing crawl/summary status (legacy or freshly-stubbed rows) is not
 * "done": default each absent axis to "pending" so deriveReaderViewStatus
 * resolves to "loading". A skipped summary on a ready crawl counts as done —
 * the reader view is complete, there is just nothing to summarise. */
export function isFullyParsed(input: {
	crawlStatus: CrawlStatus | undefined;
	summaryStatus: SummaryStatus | undefined;
}): boolean {
	return (
		deriveReaderViewStatus({
			crawl: input.crawlStatus ?? "pending",
			summary: input.summaryStatus ?? "pending",
		}) === "succeeded"
	);
}
