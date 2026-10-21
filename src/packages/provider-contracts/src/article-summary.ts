import type { ShownSummary } from "@packages/domain/article";

export type { GeneratedSummary } from "@packages/domain/article";

export type FindGeneratedSummary = (url: string) => Promise<ShownSummary | undefined>;

/** Batched form of {@link FindGeneratedSummary}. Every input url has an entry in
 * the returned map (value possibly `undefined`), keyed by the url as given. A
 * transport failure rejects the whole call. */
export type FindGeneratedSummaries = (
	urls: readonly string[],
) => Promise<ReadonlyMap<string, ShownSummary | undefined>>;

export type MarkSummaryPending = (params: { url: string }) => Promise<void>;

export const MAX_SUMMARY_LENGTH = 750;
export const MAX_EXCERPT_LENGTH = 100;
