import type { CrawlStage } from "@packages/domain/article";

export interface CrawlParts {
	current: number;
	total: number;
}

/** Transient partial-content snapshot written by save-link as it crawls. The
 * version number is monotonically incremented per write so SSE clients can
 * cheaply detect a new snapshot without diffing the content body. Lives only
 * on the `pending` variant — terminal transitions REMOVE both attributes on
 * the underlying row, making "partial only exists while pending" a
 * compile-time invariant on the discriminated union. */
export interface CrawlPartial {
	content: string;
	version: number;
}

export type ArticleCrawl =
	| { status: "pending"; stage?: CrawlStage; parts?: CrawlParts; partial?: CrawlPartial }
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
