import type { CrawlStage } from "@packages/domain/article";

export type ArticleCrawl =
	| { status: "pending"; stage?: CrawlStage }
	| { status: "ready" }
	| { status: "failed"; reason: string };

export type FindArticleCrawlStatus = (
	url: string,
) => Promise<ArticleCrawl | undefined>;

export type MarkCrawlPending = (params: { url: string }) => Promise<void>;

/**
 * Unconditionally moves a row to crawlStatus=pending, even if it is currently
 * `ready`. Used only by the operator recrawl endpoint where we explicitly want
 * to discard the previous terminal state so the reader slot shows
 * "recrawl in progress" while the worker re-runs. Clears any prior
 * crawlFailureReason.
 */
export type ForceMarkCrawlPending = (params: { url: string }) => Promise<void>;

/**
 * Atomically attempts to record an auto-heal reprime against a failed row.
 * Returns 'reprimed' when the cap is not yet hit (the call also bumps the
 * counter and timestamp), or 'capped' when the row has already used up its
 * budget of attempts inside the configured TTL window.
 *
 * The cap exists to prevent a structurally-impossible URL (e.g. a 100MB PDF
 * the parser can never finish) from being republished forever. Successful
 * promote (promoteTierToCanonical) clears the counter; an admin recrawl
 * naturally bypasses the cap because /admin/recrawl does not flow through
 * the freshness path that calls this dep.
 */
export type IncrementCrawlAutoHealAttempt = (params: {
	url: string;
	nowIso: string;
	maxAttempts: number;
	ttlMs: number;
}) => Promise<"reprimed" | "capped">;
