import type { SummarySkipReason } from "@packages/article-state-types";

export type GeneratedSummary =
	| { status: "pending" }
	| { status: "ready"; summary: string; excerpt?: string }
	| { status: "failed"; reason: string }
	| { status: "skipped"; reason?: string };

export type FindGeneratedSummary = (url: string) => Promise<GeneratedSummary | undefined>;

export type SaveGeneratedSummary = (params: {
	url: string;
	summary: string;
	excerpt: string;
	inputTokens: number;
	outputTokens: number;
}) => Promise<void>;

export type MarkSummaryPending = (params: { url: string }) => Promise<void>;
export type MarkSummaryFailed = (params: { url: string; reason: string }) => Promise<void>;
export type MarkSummarySkipped = (params: {
	url: string;
	reason: SummarySkipReason;
}) => Promise<void>;

/**
 * Worker-side stage strings for the unified article-body progress bar.
 * Mirrors the hutch progress-mapping SummaryStage union — kept as a literal
 * type to keep the save-link package free of cross-project relative imports.
 * Terminal stages are omitted because by the time the worker would write
 * them the row's status attribute has already flipped to a terminal value.
 */
export type SummaryStage = "summary-started" | "summary-generating";

export type MarkSummaryStage = (params: {
	url: string;
	stage: SummaryStage;
}) => Promise<void>;
