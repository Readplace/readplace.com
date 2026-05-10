import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export type StuckReason =
	| "summary-pending"
	| "summary-failed"
	| "summary-ready-without-text"
	| "crawl-pending"
	| "crawl-failed"
	| "legacy-stub";

/**
 * Map a row to the reasons it is "stuck". Empty array = the row is healthy
 * (terminal-good state machines, or a legacy row carrying a pre-state-machine
 * `summary`). The two switches use exhaustive `never` defaults so a new
 * SummaryStatus or CrawlStatus added to @packages/article-state-types breaks
 * `tsc --noEmit` until the classifier handles it.
 *
 * "summary-ready-without-text" catches the writer-contract violation that
 * left fagnerbrack.com/why-developers-become-frustrated-… stuck on
 * 2026-05-10: a row with summaryStatus="ready" but no `summary` text. The
 * status enums alone do not surface this — a row in that state passes both
 * status checks and would otherwise fall through as healthy.
 */
export function classifyRow(
	row: {
		summaryStatus: SummaryStatus | undefined;
		crawlStatus: CrawlStatus | undefined;
		summary: string | undefined;
	},
): StuckReason[] {
	const reasons: StuckReason[] = [];
	if (row.summaryStatus !== undefined) {
		switch (row.summaryStatus) {
			case "pending":
				reasons.push("summary-pending");
				break;
			case "failed":
				reasons.push("summary-failed");
				break;
			case "ready":
				if (row.summary === undefined) {
					reasons.push("summary-ready-without-text");
				}
				break;
			case "skipped":
				break;
			default: {
				const _exhaustive: never = row.summaryStatus;
				throw new Error(
					`Unhandled summaryStatus '${String(_exhaustive satisfies SummaryStatus)}' — extend classifyRow.`,
				);
			}
		}
	}
	if (row.crawlStatus !== undefined) {
		switch (row.crawlStatus) {
			case "pending":
				reasons.push("crawl-pending");
				break;
			case "failed":
				reasons.push("crawl-failed");
				break;
			case "ready":
				break;
			default: {
				const _exhaustive: never = row.crawlStatus;
				throw new Error(
					`Unhandled crawlStatus '${String(_exhaustive satisfies CrawlStatus)}' — extend classifyRow.`,
				);
			}
		}
	}
	if (
		row.summaryStatus === undefined &&
		row.crawlStatus === undefined &&
		row.summary === undefined
	) {
		reasons.push("legacy-stub");
	}
	return reasons;
}
