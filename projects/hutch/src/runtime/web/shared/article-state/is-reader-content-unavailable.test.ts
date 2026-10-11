import type { CrawlStatus } from "@packages/article-state-types";
import { isReaderContentUnavailable } from "./is-reader-content-unavailable";

describe("isReaderContentUnavailable", () => {
	it.each<[CrawlStatus | undefined, boolean]>([
		["pending", false],
		["ready", false],
		["failed", true],
		["unsupported", true],
		[undefined, false],
	])("answers %s with %s: only a crawl that settled without reader content leaves nothing to show", (crawlStatus, expected) => {
		expect(isReaderContentUnavailable({ crawlStatus })).toBe(expected);
	});
});
