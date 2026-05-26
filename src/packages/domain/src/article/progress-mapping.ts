/**
 * Unified progress mapping for the single article-body progress bar.
 *
 * The page has two pending sub-states (crawl, summary) but exposes one bar to
 * the reader. Crawl stages live on the lower half of the 0–100 scale and
 * summary stages on the upper half so the bar marches forward across both
 * pipelines without ever moving backwards when crawl flips ready and the
 * summary worker takes over.
 *
 * Only stages observable to a poll are listed: terminal "ready"-like stages
 * (crawl-ready, summary-complete) are not included because by the time the
 * worker writes them the row's status attribute has already flipped to a
 * terminal value, and `buildUnifiedProgress` drops the bar entirely.
 */

export const CRAWL_STAGE_TO_PCT = {
	"crawl-fetching": 5,
	"crawl-fetched": 17,
	"comprehensive-fetching": 20,
	"comprehensive-extracting": 23,
	"comprehensive-cleaning": 26,
	"crawl-parsed": 29,
	"crawl-metadata-written": 41,
	"crawl-content-uploaded": 53,
} as const;

export type CrawlStage = keyof typeof CRAWL_STAGE_TO_PCT;

export const CRAWL_STAGES = Object.keys(CRAWL_STAGE_TO_PCT) as readonly CrawlStage[];

export const SUMMARY_STAGE_TO_PCT = {
	"summary-started": 65,
	"summary-generating": 90,
} as const;

export type SummaryStage = keyof typeof SUMMARY_STAGE_TO_PCT;

export const SUMMARY_STAGES = Object.keys(SUMMARY_STAGE_TO_PCT) as readonly SummaryStage[];

export const DEFAULT_CRAWL_STAGE: CrawlStage = "crawl-fetching";
export const DEFAULT_SUMMARY_STAGE: SummaryStage = "summary-started";

export type ProgressStage = CrawlStage | SummaryStage;

export interface ProgressTick {
	stage: ProgressStage;
	pct: number;
	tickAt: string;
}

export function crawlStagePct(stage: CrawlStage): number {
	return CRAWL_STAGE_TO_PCT[stage];
}

export function summaryStagePct(stage: SummaryStage): number {
	return SUMMARY_STAGE_TO_PCT[stage];
}
