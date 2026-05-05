import type { SummaryStage } from "@packages/domain/article";

export type GeneratedSummary =
	| { status: "pending"; stage?: SummaryStage }
	| { status: "ready"; summary: string; excerpt?: string }
	| { status: "failed"; reason: string }
	| { status: "skipped"; reason?: string };

export type FindGeneratedSummary = (url: string) => Promise<GeneratedSummary | undefined>;

/**
 * Batched lookup keyed by the same URL the caller passes in. The returned Map
 * is keyed by the input URL (not the canonicalised resource id) so the queue
 * page handler can look up summaries directly by `article.url`. Missing rows
 * map to `undefined`. An empty input returns an empty Map without hitting
 * DynamoDB.
 */
export type FindGeneratedSummariesByUrls = (
	urls: readonly string[],
) => Promise<Map<string, GeneratedSummary | undefined>>;

export type MarkSummaryPending = (params: { url: string }) => Promise<void>;

/**
 * Unconditionally moves a row to summaryStatus=pending, even if it is currently
 * `ready` or `skipped`. Used only by the operator recrawl endpoint where we
 * explicitly want to discard the previous terminal state so the worker
 * regenerates the summary and excerpt instead of short-circuiting on the
 * cached "ready" row. Clears any prior summaryFailureReason.
 */
export type ForceMarkSummaryPending = (params: { url: string }) => Promise<void>;
