import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export type StuckReason =
	| "summary-pending"
	| "crawl-pending"
	| "summary-pending-after-aggregate-migration"
	| "crawl-pending-after-aggregate-migration";

/**
 * Transitions whose rows are produced by the Phase 2 cross-axis writer
 * migration. A stuck row carrying one of these names in
 * `aggregateTransitionName` is the falsifiable result of the migration: the
 * aggregate is supposed to flip the row to a terminal/ready state in one
 * save, so seeing it still stuck a week later means the design is wrong and
 * Phases 3+ stop. We surface those rows under a separate StuckReason so the
 * canary report buckets them away from legacy-writer noise.
 */
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
 *
 * "-after-aggregate-migration" variants: rows whose `aggregateTransitionName`
 * column names a Phase 2 transition (markCrawlExhausted, recrawlTieKeptCanonical,
 * recrawlPromoteTier) emit the suffixed variant of the pending reason instead.
 * After one week of Phase 2 in production, the count of these variants is the
 * pass/fail signal: zero = the aggregate flips terminal states reliably and
 * Phase 3+ proceeds; non-zero = the aggregate doesn't do what we claim and
 * the migration plan is cancelled.
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
