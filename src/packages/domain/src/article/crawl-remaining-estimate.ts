export const CRAWL_SETTLED_P99_SECONDS = 160;
export const CRAWL_ESTIMATE_QUIET_SECONDS = 5;

export type CrawlRemainingEstimate =
	| { kind: "quiet"; revealInSeconds: number; seconds: number }
	| { kind: "counting"; seconds: number }
	| { kind: "almost-there" };

export function estimateCrawlRemaining(params: { startedAt: string; now: Date; pct: number }): CrawlRemainingEstimate {
	const elapsedSeconds = (params.now.getTime() - Date.parse(params.startedAt)) / 1000;
	const seconds = Math.ceil(
		Math.min(CRAWL_SETTLED_P99_SECONDS - elapsedSeconds, CRAWL_SETTLED_P99_SECONDS * (1 - params.pct / 100)),
	);
	if (elapsedSeconds < CRAWL_ESTIMATE_QUIET_SECONDS) {
		return { kind: "quiet", revealInSeconds: Math.ceil(CRAWL_ESTIMATE_QUIET_SECONDS - elapsedSeconds), seconds };
	}
	return seconds > 0 ? { kind: "counting", seconds } : { kind: "almost-there" };
}
