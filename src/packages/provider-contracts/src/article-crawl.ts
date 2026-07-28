import type { CrawlStage } from "@packages/domain/article";

export interface CrawlParts {
	current: number;
	total: number;
}

export type ArticleCrawl =
	| { status: "pending"; stage?: CrawlStage; parts?: CrawlParts }
	| { status: "ready" }
	| { status: "failed"; reason: string }
	| { status: "unsupported"; reason: string };

export type FindArticleCrawlStatus = (
	url: string,
) => Promise<ArticleCrawl | undefined>;

/** Batched form of {@link FindArticleCrawlStatus}. Every input url has an entry
 * in the returned map (value possibly `undefined`), keyed by the url as given. A
 * row missing, unparseable, or failing the strict row schema degrades to
 * `undefined` for that url only; a transport failure rejects the whole call. */
export type FindArticleCrawlStatuses = (
	urls: readonly string[],
) => Promise<ReadonlyMap<string, ArticleCrawl | undefined>>;

export type MarkCrawlPending = (params: { url: string }) => Promise<void>;

/**
 * Unconditionally moves a row to crawlStatus=pending, even if it is already
 * `ready` or terminal (`failed`/`unsupported`). Used only by the operator
 * recrawl endpoint where we explicitly want to discard the previous state so
 * the reader slot shows "recrawl in progress" while the worker re-runs. Clears
 * any prior crawlFailureReason / crawlUnsupportedReason.
 */
export type ForceMarkCrawlPending = (params: { url: string }) => Promise<void>;

/** Crawl-state write operations that production routes never call — in
 * production the save-link worker owns these transitions. The in-memory
 * fixture exposes them so tests (via hutch's test-app) can drive a row into
 * any crawl state directly. */
export type InMemoryMarkCrawlReady = (params: { url: string }) => Promise<void>;
export type InMemoryMarkCrawlFailed = (params: {
	url: string;
	reason: string;
}) => Promise<void>;
export type InMemoryMarkCrawlUnsupported = (params: {
	url: string;
	reason: string;
}) => Promise<void>;
export type InMemoryMarkCrawlStage = (params: {
	url: string;
	stage: CrawlStage;
}) => Promise<void>;
