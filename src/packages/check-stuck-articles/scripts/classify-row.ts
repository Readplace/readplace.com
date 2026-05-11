import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export type StuckReason =
	| "summary-pending"
	| "summary-ready-without-text"
	| "crawl-pending"
	| "legacy-stub";

/**
 * Map a row to the reasons it is "stuck". Empty array = the row is healthy
 * (terminal state machines — ready/failed/unsupported/skipped — or a legacy
 * row carrying a pre-state-machine `summary`). The two switches use exhaustive
 * `never` defaults so a new SummaryStatus or CrawlStatus added to
 * @packages/article-state-types breaks `tsc --noEmit` until the classifier
 * handles it.
 *
 * Why terminal failures (failed / unsupported) are NOT flagged: the canary
 * only reports rows that are not making progress. failed and unsupported are
 * terminal states the operator owns via /admin/recrawl and the DLQ → SNS
 * email signal. Flagging them in the stuck-articles report would drown the
 * actionable pending-row signals in noise that the operator can't resolve
 * without per-URL judgement (recrawl vs. exclude vs. live with).
 *
 * "summary-ready-without-text" catches the writer-contract violation that
 * left fagnerbrack.com/why-developers-become-frustrated-… stuck on
 * 2026-05-10: a row with summaryStatus="ready" but no `summary` text.
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
			case "ready":
				if (row.summary === undefined) {
					reasons.push("summary-ready-without-text");
				}
				break;
			case "failed":
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
			case "ready":
			case "failed":
			case "unsupported":
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
