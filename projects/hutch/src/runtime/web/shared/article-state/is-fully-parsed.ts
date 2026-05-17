import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export function isFullyParsed(input: {
	crawlStatus: CrawlStatus | undefined;
	summaryStatus: SummaryStatus | undefined;
}): boolean {
	return input.crawlStatus === "ready" && input.summaryStatus === "ready";
}
