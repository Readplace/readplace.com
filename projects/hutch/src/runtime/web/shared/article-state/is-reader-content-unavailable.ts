import type { CrawlStatus } from "@packages/article-state-types";

export function isReaderContentUnavailable(input: { crawlStatus: CrawlStatus | undefined }): boolean {
	return input.crawlStatus === "failed" || input.crawlStatus === "unsupported";
}
