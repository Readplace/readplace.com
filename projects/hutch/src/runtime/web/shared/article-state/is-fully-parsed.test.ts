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
	it("returns true only when both crawl and summary statuses are ready", () => {
		for (const crawlStatus of CRAWL_STATUSES) {
			for (const summaryStatus of SUMMARY_STATUSES) {
				const expected = crawlStatus === "ready" && summaryStatus === "ready";
				expect(isFullyParsed({ crawlStatus, summaryStatus })).toBe(expected);
			}
		}
	});
});
