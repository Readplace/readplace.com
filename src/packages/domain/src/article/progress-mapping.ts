/**
 * Only stages observable to a poll are listed: terminal "ready"-like stages
 * (crawl-ready, summary-complete) are not included because by the time the
 * worker writes them the row's status attribute has already flipped to a
 * terminal value.
 */

export const CRAWL_STAGE_TO_PCT = {
	"crawl-fetching": 8,
	"crawl-fetched": 29,
	"comprehensive-fetching": 34,
	"comprehensive-extracting": 39,
	"comprehensive-cleaning": 44,
	"crawl-parsed": 49,
	"crawl-metadata-written": 70,
	"crawl-content-uploaded": 90,
} as const;

export type CrawlStage = keyof typeof CRAWL_STAGE_TO_PCT;

export const CRAWL_STAGES = Object.keys(CRAWL_STAGE_TO_PCT) as readonly CrawlStage[];

export const SUMMARY_STAGE_TO_PCT = {
	"summary-started": 29,
	"summary-generating": 90,
} as const;

export type SummaryStage = keyof typeof SUMMARY_STAGE_TO_PCT;

export const SUMMARY_STAGES = Object.keys(SUMMARY_STAGE_TO_PCT) as readonly SummaryStage[];

export const DEFAULT_CRAWL_STAGE: CrawlStage = "crawl-fetching";
export const DEFAULT_SUMMARY_STAGE: SummaryStage = "summary-started";

export function crawlStagePct(stage: CrawlStage): number {
	return CRAWL_STAGE_TO_PCT[stage];
}

export function crawlProgressPct(crawl: {
	stage: CrawlStage;
	parts?: { current: number; total: number };
}): number {
	const stagePct = CRAWL_STAGE_TO_PCT[crawl.stage];
	const isComprehensiveSubStage =
		crawl.stage === "comprehensive-extracting" || crawl.stage === "comprehensive-cleaning";
	return isComprehensiveSubStage && crawl.parts !== undefined && crawl.parts.total > 0
		? stagePct + (crawl.parts.current / crawl.parts.total) * (CRAWL_STAGE_TO_PCT["crawl-parsed"] - stagePct)
		: stagePct;
}

export function summaryStagePct(stage: SummaryStage): number {
	return SUMMARY_STAGE_TO_PCT[stage];
}
