import type { SummaryStage } from "@packages/domain/article";

export type GeneratedSummary =
	| { status: "pending"; stage?: SummaryStage }
	| { status: "ready"; summary: string; excerpt?: string }
	| { status: "failed"; reason: string }
	| { status: "skipped"; reason?: string };

export type FindGeneratedSummary = (url: string) => Promise<GeneratedSummary | undefined>;

/** Batched form of {@link FindGeneratedSummary}. Every input url has an entry in
 * the returned map (value possibly `undefined`), keyed by the url as given. A row
 * missing, unparseable, or failing the strict row schema degrades to `undefined`
 * for that url only; a transport failure rejects the whole call. */
export type FindGeneratedSummaries = (
	urls: readonly string[],
) => Promise<ReadonlyMap<string, GeneratedSummary | undefined>>;

export type MarkSummaryPending = (params: { url: string }) => Promise<void>;

export const MAX_SUMMARY_LENGTH = 750;
export const MAX_EXCERPT_LENGTH = 100;
