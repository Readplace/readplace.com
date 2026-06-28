import type { SummaryStage } from "@packages/domain/article";

export type GeneratedSummary =
	| { status: "pending"; stage?: SummaryStage }
	| { status: "ready"; summary: string; excerpt?: string }
	| { status: "failed"; reason: string }
	| { status: "skipped"; reason?: string };

export type FindGeneratedSummary = (url: string) => Promise<GeneratedSummary | undefined>;

export type MarkSummaryPending = (params: { url: string }) => Promise<void>;

export const MAX_SUMMARY_LENGTH = 750;
export const MAX_EXCERPT_LENGTH = 100;
