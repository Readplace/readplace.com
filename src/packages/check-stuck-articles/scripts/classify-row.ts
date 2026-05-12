import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export type StuckReason =
	| "summary-pending"
	| "crawl-pending"
	| "summary-pending-after-aggregate-migration"
	| "crawl-pending-after-aggregate-migration";

const PHASE_2_MIGRATED_TRANSITIONS: ReadonlySet<string> = new Set([
	"markCrawlExhausted",
	"recrawlTieKeptCanonical",
	"recrawlPromoteTier",
]);

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
	aggregateTransitionName: string | undefined;
}): StuckReason[] {
	const migratedWriter =
		row.aggregateTransitionName !== undefined &&
		PHASE_2_MIGRATED_TRANSITIONS.has(row.aggregateTransitionName);

	const reasons: StuckReason[] = [];
	if (row.summaryStatus === "pending") {
		reasons.push(
			migratedWriter
				? "summary-pending-after-aggregate-migration"
				: "summary-pending",
		);
	}
	if (row.crawlStatus === "pending") {
		reasons.push(
			migratedWriter
				? "crawl-pending-after-aggregate-migration"
				: "crawl-pending",
		);
	}
	return reasons;
}
