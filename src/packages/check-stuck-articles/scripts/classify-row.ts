import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export type StuckReason = "summary-pending" | "crawl-pending";

/**
 * Map a row to the reasons it is "stuck". Empty array = the row is healthy
 * and no manual retry is owed. The canary surfaces:
 *   - `pending` on either axis (worker never moved past in-flight).
 * `failed` rows are intentionally excluded — the DLQ alarm is their signal.
 * `skipped` reasons (`content-too-short`, `crawl-unsupported`) are not
 * surfaced: a pure retry cannot change the input that produced the skip.
 */
export function classifyRow(row: {
	summaryStatus: SummaryStatus | undefined;
	crawlStatus: CrawlStatus | undefined;
}): StuckReason[] {
	const reasons: StuckReason[] = [];
	if (row.summaryStatus === "pending") {
		reasons.push("summary-pending");
	}
	if (row.crawlStatus === "pending") {
		reasons.push("crawl-pending");
	}
	return reasons;
}
