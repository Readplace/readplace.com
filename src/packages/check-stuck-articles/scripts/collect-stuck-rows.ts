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
	originalUrl: z.string(),
	summaryStatus: dynamoField(SummaryStatusSchema),
	crawlStatus: dynamoField(CrawlStatusSchema),
	contentFetchedAt: dynamoField(z.string()),
	savedAt: z.string(),
	/* Phase 2 canary tag — the transition function name from the most recent
	 * aggregate save. classifyRow reads it to bucket stuck rows by migrated vs.
	 * legacy writer. Legacy rows do not carry the attribute. */
	aggregateTransitionName: dynamoField(z.string()),
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
 * Age-gate disjunction per axis:
 *   1. `contentFetchedAt < :axisMinAge` — covers a previously-crawled row that
 *      was recrawled; if the recrawl is in flight, the existing
 *      `contentFetchedAt` is still the old value and counts as old enough.
 *   2. `attribute_not_exists(contentFetchedAt) AND savedAt < :axisMinAge`
 *      — first-time pending row that has never crawled successfully.
 */
export function buildScanInput(now: Date) {
	const crawlMinAge = new Date(now.getTime() - CRAWL_MIN_AGE_MS).toISOString();
	const summaryMinAge = new Date(now.getTime() - SUMMARY_MIN_AGE_MS).toISOString();
	const ageGate = (axisMinAgeKey: string) =>
		`(contentFetchedAt < ${axisMinAgeKey}` +
		` OR (attribute_not_exists(contentFetchedAt) AND savedAt < ${axisMinAgeKey}))`;
	return {
		FilterExpression:
			`(summaryStatus = :pending AND ${ageGate(":summaryMinAge")}) ` +
			`OR (crawlStatus = :pending AND ${ageGate(":crawlMinAge")})`,
		ProjectionExpression:
			"originalUrl, #u, summaryStatus, crawlStatus, contentFetchedAt, savedAt, aggregateTransitionName",
		ExpressionAttributeNames: { "#u": "url" },
		ExpressionAttributeValues: {
			":pending": "pending",
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
			stuck.push({
				originalUrl: row.originalUrl,
				reasons,
				contentFetchedAt: row.contentFetchedAt,
				recrawlUrl: `${deps.origin}/admin/recrawl/${encodeURIComponent(row.originalUrl)}`,
				terminalCheckMessage: verdict.message,
			});
		}
		lastEvaluatedKey = page.lastEvaluatedKey;
	} while (lastEvaluatedKey !== undefined);
	return stuck;
}
