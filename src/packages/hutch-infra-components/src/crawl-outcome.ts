export const CRAWL_OUTCOME_STREAM = "crawl-outcomes";

export type TierName = "tier-0" | "tier-1" | "tier-2";

export interface CrawlOutcomeEvent {
	stream: typeof CRAWL_OUTCOME_STREAM;
	event: "tier-outcome";
	timestamp: string;
	url: string;
	thisTier: TierName;
	thisTierStatus: "success" | "failed";
	otherTierStatus: "success" | "failed" | "not_attempted";
	pickedTier: TierName | "none";
}

export type LogCrawlOutcome = (params: Omit<CrawlOutcomeEvent, "stream" | "event" | "timestamp">) => void;

export function initLogCrawlOutcome(deps: {
	logger: { info: (event: CrawlOutcomeEvent) => void };
	now: () => Date;
}): { logCrawlOutcome: LogCrawlOutcome } {
	const logCrawlOutcome: LogCrawlOutcome = (params) => {
		deps.logger.info({
			stream: CRAWL_OUTCOME_STREAM,
			event: "tier-outcome",
			timestamp: deps.now().toISOString(),
			url: params.url,
			thisTier: params.thisTier,
			thisTierStatus: params.thisTierStatus,
			otherTierStatus: params.otherTierStatus,
			pickedTier: params.pickedTier,
		});
	};
	return { logCrawlOutcome };
}
