/**
 * Worker-side stage strings. The
 * stage union is duplicated as a literal here rather than imported so this
 * package takes no cross-project dependency on the stage → percentage table.
 * The worker only writes the stage name; the reader maps stage → pct at render
 * time. Terminal stages are omitted because by the time the worker would write
 * them the row's status attribute has already flipped to a terminal value,
 * which the reader respects ahead of any stage write.
 */
export type CrawlStage =
	| "crawl-fetching"
	| "crawl-fetched"
	| "comprehensive-fetching"
	| "comprehensive-extracting"
	| "comprehensive-cleaning"
	| "crawl-parsed"
	| "crawl-metadata-written"
	| "crawl-content-uploaded";

export type MarkCrawlStage = (params: {
	url: string;
	stage: CrawlStage;
}) => Promise<void>;

export type MarkCrawlProgress = (params: {
	url: string;
	partCurrent: number;
	partTotal: number;
}) => Promise<void>;
