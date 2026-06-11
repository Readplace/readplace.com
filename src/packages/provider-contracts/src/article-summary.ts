import type { SummaryStage } from "@packages/domain/article";

export type GeneratedSummary =
	| { status: "pending"; stage?: SummaryStage }
	| { status: "ready"; summary: string; excerpt?: string }
	| { status: "failed"; reason: string }
	| { status: "skipped"; reason?: string };

export type FindGeneratedSummary = (url: string) => Promise<GeneratedSummary | undefined>;

export type MarkSummaryPending = (params: { url: string }) => Promise<void>;

/**
 * Unconditionally moves a row to summaryStatus=pending, even if it is currently
 * `ready` or `skipped`. Used only by the operator recrawl endpoint where we
 * explicitly want to discard the previous terminal state so the worker
 * regenerates the summary and excerpt instead of short-circuiting on the
 * cached "ready" row. Clears any prior summaryFailureReason.
 */
export type ForceMarkSummaryPending = (params: { url: string }) => Promise<void>;
