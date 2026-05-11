import type { CrawlStage } from "@packages/domain/article";

export type ArticleCrawl =
	| { status: "pending"; stage?: CrawlStage }
	| { status: "ready" }
	| { status: "failed"; reason: string }
	| { status: "unsupported"; reason: string };

export type FindArticleCrawlStatus = (
	url: string,
) => Promise<ArticleCrawl | undefined>;

export type MarkCrawlPending = (params: { url: string }) => Promise<void>;

/**
 * Unconditionally moves a row to crawlStatus=pending, even if it is currently
 * `ready` or terminal (`failed`/`unsupported`). Used only by the operator
 * recrawl endpoint where we explicitly want to discard the previous state so
 * the reader slot shows "recrawl in progress" while the worker re-runs. Clears
 * any prior crawlFailureReason / crawlUnsupportedReason.
 */
export type ForceMarkCrawlPending = (params: { url: string }) => Promise<void>;
