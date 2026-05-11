export type MarkCrawlReady = (params: { url: string }) => Promise<void>;
export type MarkCrawlFailed = (params: {
	url: string;
	reason: string;
}) => Promise<void>;
export type MarkCrawlUnsupported = (params: {
	url: string;
	reason: string;
}) => Promise<void>;

/**
 * Worker-side stage strings for the unified article-body progress bar. Mirrors
 * the hutch progress-mapping CrawlStage union — kept as a literal type here so
 * the save-link package does not take a cross-project relative import on the
 * percentage table. The worker only writes the stage name; the reader maps
 * stage → pct at render time. Terminal stages are omitted because by the time
 * the worker would write them the row's status attribute has already flipped
 * to a terminal value, which the reader respects ahead of any stage write.
 */
export type CrawlStage =
	| "crawl-fetching"
	| "crawl-fetched"
	| "crawl-parsed"
	| "crawl-metadata-written"
	| "crawl-content-uploaded";

export type MarkCrawlStage = (params: {
	url: string;
	stage: CrawlStage;
}) => Promise<void>;
