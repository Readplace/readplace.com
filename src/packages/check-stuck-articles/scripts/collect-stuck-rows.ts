/**
 * Extracted from `check-stuck-articles.ts` so the unit tests can exercise the
 * canary logic without registering the top-level `test()` block (which fires
 * `requireEnv` at module load and aborts the test process).
 */
import assert from "node:assert/strict";
import {
	CrawlStatusSchema,
	SummaryStatusSchema,
} from "@packages/article-state-types";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { checkTerminalState } from "./check-terminal-state";
import { type StuckReason, classifyRow } from "./classify-row";

/* `dynamoField` normalises DDB's `null` for absent attributes to `undefined`. */
const StuckArticleRow = z.object({
	url: z.string(),
	originalUrl: dynamoField(z.string()),
	summaryStatus: dynamoField(SummaryStatusSchema),
	crawlStatus: dynamoField(CrawlStatusSchema),
	contentFetchedAt: dynamoField(z.string()),
	crawlPendingSince: dynamoField(z.string()),
	summaryPendingSince: dynamoField(z.string()),
	savedAt: z.string(),
	aggregateTransitionName: dynamoField(z.string()),
	summarySkippedReason: dynamoField(z.string()),
});

export interface StuckRow {
	originalUrl: string;
	reasons: StuckReason[];
	contentFetchedAt: string | undefined;
	recrawlUrl: string;
	/**
	 * Surfaced in the failing test message so an operator reading the GitHub
	 * Actions output knows which writer to suspect without cross-referencing
	 * the reason enum.
	 */
	terminalCheckMessage: string;
}

/* The articles table completes a real scan in under 10 pages. Crossing 50
 * means the FilterExpression stopped narrowing (or the table grew an order of
 * magnitude) — fail loud instead of burning the runner's 10-minute budget. */
const MAX_PAGES = 50;

/**
 * 1. Anchored to retry-chain wall-clock = visibility × maxReceiveCount per
 *    crawl-pipeline-rca §4. The longest pending-crawl chain is the
 *    `save-link-command` queue (visibility 360s × default maxReceiveCount 3 =
 *    1080s = 18 min); after that exhausts, `HutchDLQEventHandler` flips
 *    `crawlStatus` to `failed`. Allow 2 min margin for AWS dispatch variance
 *    and writer/canary clock skew → 20 min.
 */
export const CRAWL_MIN_AGE_MS = 20 * 60_000; /* 1 */

/**
 * 1. Generate-summary retry chain is visibility 300s × default maxReceiveCount
 *    3 = 900s = 15 min. Bumped to 20 min to absorb DeepSeek slow periods
 *    documented in #251 — DeepSeek occasionally drags an in-flight summary
 *    past the SQS budget without the chain failing.
 */
export const SUMMARY_MIN_AGE_MS = 20 * 60_000; /* 1 */

/**
 * Per-axis age-gate disjuncts:
 *
 *   1. `<axis>PendingSince < :axisMinAge` — written by every transition
 *      that produces a pending state. Captures the moment the worker took
 *      ownership of the row, so the age compare is independent of unrelated
 *      writes (refresh updating contentFetchedAt while a summary regen is in
 *      flight, for example).
 *   2. Legacy disjunct on contentFetchedAt/savedAt — covers rows saved
 *      before pendingSince existed. Dropped once the canary scan reports
 *      zero rows hitting this branch.
 *   3. `summaryStatus = "skipped" AND summarySkippedReason = "ai-unavailable"`
 *      — `summaryPendingSince` is removed when the summary transitions to
 *      skipped (see `dynamodb-article-store.ts` REMOVE clause), so the
 *      pending-age gates above can never match this state. Anchor the gate
 *      to `contentFetchedAt` (set by the freshness writer immediately
 *      before the summariser ran, so it bounds when the skip happened),
 *      falling back to `savedAt` for legacy rows missing contentFetchedAt.
 */
export function buildScanInput(now: Date) {
	const crawlMinAge = new Date(now.getTime() - CRAWL_MIN_AGE_MS).toISOString();
	const summaryMinAge = new Date(now.getTime() - SUMMARY_MIN_AGE_MS).toISOString();
	const legacyAgeGate = (axisMinAgeKey: string) =>
		`(attribute_not_exists(crawlPendingSince) AND attribute_not_exists(summaryPendingSince) AND ` +
		`(contentFetchedAt < ${axisMinAgeKey}` +
		` OR (attribute_not_exists(contentFetchedAt) AND savedAt < ${axisMinAgeKey})))`;
	return {
		FilterExpression:
			`(summaryStatus = :pending AND ` +
			`(summaryPendingSince < :summaryMinAge OR ${legacyAgeGate(":summaryMinAge")})) ` +
			`OR (crawlStatus = :pending AND ` +
			`(crawlPendingSince < :crawlMinAge OR ${legacyAgeGate(":crawlMinAge")})) ` +
			`OR (summaryStatus = :skipped AND summarySkippedReason = :aiUnavailable AND ` +
			`(contentFetchedAt < :summaryMinAge OR (attribute_not_exists(contentFetchedAt) AND savedAt < :summaryMinAge)))`,
		ProjectionExpression:
			"originalUrl, #u, summaryStatus, crawlStatus, contentFetchedAt, " +
			"crawlPendingSince, summaryPendingSince, savedAt, aggregateTransitionName, " +
			"summarySkippedReason",
		ExpressionAttributeNames: { "#u": "url" },
		ExpressionAttributeValues: {
			":pending": "pending",
			":skipped": "skipped",
			":aiUnavailable": "ai-unavailable",
			":crawlMinAge": crawlMinAge,
			":summaryMinAge": summaryMinAge,
		},
	} as const;
}

export async function collectStuckRows(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	origin: string;
	now: () => Date;
}): Promise<StuckRow[]> {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: StuckArticleRow,
	});
	const stuck: StuckRow[] = [];
	let pageCount = 0;
	let lastEvaluatedKey: Record<string, unknown> | undefined;
	const scanInput = buildScanInput(deps.now());
	do {
		pageCount += 1;
		assert(
			pageCount <= MAX_PAGES,
			`pagination cap reached (${MAX_PAGES} pages) — refine FilterExpression or raise the cap if the table is legitimately growing`,
		);
		const page = await table.scan({
			...scanInput,
			ExclusiveStartKey: lastEvaluatedKey,
		});
		for (const row of page.items) {
			const verdict = checkTerminalState(row);
			if (verdict.terminal) continue;
			const reasons = classifyRow(row);
			const effectiveUrl = row.originalUrl ?? row.url;
			stuck.push({
				originalUrl: effectiveUrl,
				reasons,
				contentFetchedAt: row.contentFetchedAt,
				recrawlUrl: `${deps.origin}/admin/recrawl/${encodeURIComponent(effectiveUrl)}`,
				terminalCheckMessage: verdict.message,
			});
		}
		lastEvaluatedKey = page.lastEvaluatedKey;
	} while (lastEvaluatedKey !== undefined);
	return stuck;
}
