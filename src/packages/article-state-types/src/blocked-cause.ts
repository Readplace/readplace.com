import type { CrawlFailureReason } from "./crawl-failure-reason";

export function blockedCauseForStatus(
	httpStatus: number,
): Extract<CrawlFailureReason, { kind: "blocked" }>["cause"] {
	if (httpStatus === 429) return "rate-limited";
	return "edge-block";
}
