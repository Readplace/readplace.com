import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export type StuckReason = "summary-pending" | "crawl-pending";

/**
 * Map a row to the reasons it is "stuck". Empty array = the row is healthy
 * (both state machines reached a terminal value: ready / failed / unsupported
 * / skipped). Only `pending` is non-terminal — the canary's job is to surface
 * rows that the workers never moved past `pending`, not to grade legacy data
 * or writer-contract violations.
 */
export function classifyRow(row: {
	summaryStatus: SummaryStatus | undefined;
	crawlStatus: CrawlStatus | undefined;
}): StuckReason[] {
	const reasons: StuckReason[] = [];
	if (row.summaryStatus === "pending") reasons.push("summary-pending");
	if (row.crawlStatus === "pending") reasons.push("crawl-pending");
	return reasons;
}
