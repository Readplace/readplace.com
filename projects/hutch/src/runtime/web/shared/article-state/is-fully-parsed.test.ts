import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";
import { isFullyParsed } from "./is-fully-parsed";

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

describe("isFullyParsed", () => {
	it("returns true when the crawl is ready and the summary is ready or skipped (the reader view succeeded)", () => {
		for (const crawlStatus of CRAWL_STATUSES) {
			for (const summaryStatus of SUMMARY_STATUSES) {
				const expected =
					crawlStatus === "ready" &&
					(summaryStatus === "ready" || summaryStatus === "skipped");
				expect(isFullyParsed({ crawlStatus, summaryStatus })).toBe(expected);
			}
		}
	});
});
