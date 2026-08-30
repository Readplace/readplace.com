import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";
import { isReaderViewFailed } from "./is-reader-view-failed";

const CRAWL_STATUSES: ReadonlyArray<CrawlStatus | undefined> = [
	"pending",
	"ready",
	"failed",
	"unsupported",
	undefined,
];

const SUMMARY_STATUSES: ReadonlyArray<SummaryStatus | undefined> = [
	"pending",
	"ready",
	"failed",
	"skipped",
	undefined,
];

describe("isReaderViewFailed", () => {
	it("returns true when the crawl failed or is unsupported, or the summary failed (the reader view failed)", () => {
		for (const crawlStatus of CRAWL_STATUSES) {
			for (const summaryStatus of SUMMARY_STATUSES) {
				const expected =
					crawlStatus === "failed" ||
					crawlStatus === "unsupported" ||
					summaryStatus === "failed";
				expect(isReaderViewFailed({ crawlStatus, summaryStatus })).toBe(expected);
			}
		}
	});
});
