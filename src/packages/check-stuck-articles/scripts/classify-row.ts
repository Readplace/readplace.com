import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export type StuckReason =
	| "summary-pending"
	| "crawl-pending"
	| "summary-skipped-ai-unavailable";

/**
 * Map a row to the reasons it is "stuck". Empty array = the row is healthy
 * and no manual retry is owed. The canary surfaces:
 *   - `pending` on either axis (worker never moved past in-flight).
 *   - `summary.skipped("ai-unavailable")` — AI was down when summarisation
 *     ran. The generate-summary handler treats `skipped` as a terminal cache
 *     hit and never re-runs the AI, and `decideSummaryAutoHeal` only re-primes
 *     `failed` rows, so without this signal the row sits skipped forever.
 * `failed` rows are intentionally excluded — the DLQ alarm is their signal.
 * Other `skipped` reasons (`content-too-short`, `crawl-unsupported`) are not
 * surfaced: a pure retry cannot change the input that produced the skip.
 */
export function classifyRow(row: {
	summaryStatus: SummaryStatus | undefined;
	crawlStatus: CrawlStatus | undefined;
	summarySkippedReason: string | undefined;
}): StuckReason[] {
	const reasons: StuckReason[] = [];
	if (row.summaryStatus === "pending") {
		reasons.push("summary-pending");
	}
	if (row.crawlStatus === "pending") {
		reasons.push("crawl-pending");
	}
	if (
		row.summaryStatus === "skipped" &&
		row.summarySkippedReason === "ai-unavailable"
	) {
		reasons.push("summary-skipped-ai-unavailable");
	}
	return reasons;
}
