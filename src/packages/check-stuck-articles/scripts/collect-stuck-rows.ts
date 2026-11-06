/**
 * Kept apart from the canary's test entry point so the unit tests can exercise the
 * canary logic without registering the top-level `test()` block (which fires
 * `requireEnv` at module load and aborts the test process).
 */
import {
	CrawlStatusSchema,
	SummaryStatusSchema,
} from "@packages/article-state-types";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/storage-client";
import {
	CRAWL_STATUS_INDEX,
	SUMMARY_STATUS_INDEX,
} from "@packages/provider-contracts/article-status-indexes";
import { z } from "zod";
import { checkTerminalState } from "./check-terminal-state";
import type { StuckReason } from "./classify-row";

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
});

export interface StuckRow {
	originalUrl: string;
	reasons: StuckReason[];
	contentFetchedAt: string | undefined;
	/**
	 * Surfaced in the failing test message so an operator reading the GitHub
	 * Actions output knows which writer to suspect without cross-referencing
	 * the reason enum.
	 */
	terminalCheckMessage: string;
}

/**
 * 1. Anchored to retry-chain wall-clock = visibility × maxReceiveCount per
 *    crawl-pipeline-rca §4. The longest pending-crawl chain is the
 *    `save-link-command` queue (visibility 360s × default maxReceiveCount 3 =
 *    1080s = 18 min); after that exhausts, `DLQEventHandler` flips
 *    `crawlStatus` to `failed`. Allow 2 min margin for AWS dispatch variance
 *    and writer/canary clock skew → 20 min.
 */
export const CRAWL_MIN_AGE_MS = 20 * 60_000; /* 1 */

/**
 * 1. Generate-summary retry chain is visibility 300s × default maxReceiveCount
 *    3 = 900s = 15 min; allow 20 min to absorb DeepSeek slow periods, which
 *    occasionally drag an in-flight summary past the SQS budget without the
 *    chain failing.
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
 *      before pendingSince existed.
 */
export function buildQueryInputs(now: Date) {
	const crawlMinAge = new Date(now.getTime() - CRAWL_MIN_AGE_MS).toISOString();
	const summaryMinAge = new Date(now.getTime() - SUMMARY_MIN_AGE_MS).toISOString();
	const legacyAgeGate = (axisMinAgeKey: string) =>
		`(attribute_not_exists(crawlPendingSince) AND attribute_not_exists(summaryPendingSince) AND ` +
		`(contentFetchedAt < ${axisMinAgeKey}` +
		` OR (attribute_not_exists(contentFetchedAt) AND savedAt < ${axisMinAgeKey})))`;
	const ProjectionExpression =
		"originalUrl, #u, summaryStatus, crawlStatus, contentFetchedAt, " +
		"crawlPendingSince, summaryPendingSince, savedAt";
	const ExpressionAttributeNames = { "#u": "url" };
	return [
		{
			IndexName: SUMMARY_STATUS_INDEX,
			KeyConditionExpression: "summaryStatus = :pending",
			FilterExpression: `summaryPendingSince < :summaryMinAge OR ${legacyAgeGate(":summaryMinAge")}`,
			ProjectionExpression,
			ExpressionAttributeNames,
			ExpressionAttributeValues: {
				":pending": "pending",
				":summaryMinAge": summaryMinAge,
			},
		},
		{
			IndexName: CRAWL_STATUS_INDEX,
			KeyConditionExpression: "crawlStatus = :pending",
			FilterExpression: `crawlPendingSince < :crawlMinAge OR ${legacyAgeGate(":crawlMinAge")}`,
			ProjectionExpression,
			ExpressionAttributeNames,
			ExpressionAttributeValues: {
				":pending": "pending",
				":crawlMinAge": crawlMinAge,
			},
		},
	] as const;
}

export async function collectStuckRows(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): Promise<StuckRow[]> {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: StuckArticleRow,
	});
	const candidates = new Map<string, z.infer<typeof StuckArticleRow>>();
	for (const input of buildQueryInputs(deps.now())) {
		await forEachQueryPage(table, input, async (items) => {
			for (const row of items) candidates.set(row.url, row);
		});
	}
	const stuck: StuckRow[] = [];
	for (const row of candidates.values()) {
		const verdict = checkTerminalState(row);
		if (verdict.terminal) continue;
		stuck.push({
			originalUrl: row.originalUrl ?? row.url,
			reasons: verdict.reasons,
			contentFetchedAt: row.contentFetchedAt,
			terminalCheckMessage: verdict.message,
		});
	}
	return stuck;
}
