import {
	type CrawlStatus,
	type SummaryStatus,
	deriveReaderViewStatus,
} from "@packages/article-state-types";

export function isReaderViewFailed(input: {
	crawlStatus: CrawlStatus | undefined;
	summaryStatus: SummaryStatus | undefined;
}): boolean {
	return (
		deriveReaderViewStatus({
			crawl: input.crawlStatus ?? "pending",
			summary: input.summaryStatus ?? "pending",
		}) === "failed"
	);
}
