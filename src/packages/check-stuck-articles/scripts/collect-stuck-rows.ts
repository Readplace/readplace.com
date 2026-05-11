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
import { EXCLUDE_PATTERNS } from "./exclude-patterns";

/**
 * Loose row schema for the canary's projection. Every attribute except `url`
 * is wrapped in `dynamoField` so absent attributes (which DDB returns as
 * `null`) are normalised to `undefined`. The status enums are imported from
 * @packages/article-state-types so adding a new status to the production
 * schemas surfaces here as a tsc error in `classifyRow`.
 */
const StuckArticleRow = z.object({
	url: z.string(),
	originalUrl: dynamoField(z.string()),
	summaryStatus: dynamoField(SummaryStatusSchema),
	crawlStatus: dynamoField(CrawlStatusSchema),
	summaryFailureReason: dynamoField(z.string()),
	crawlFailureReason: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
	summary: dynamoField(z.string()),
});

function isExcluded(url: string): boolean {
	return EXCLUDE_PATTERNS.some((pattern) => pattern.test(url));
}

export interface StuckRow {
	originalUrl: string;
	reasons: StuckReason[];
	contentFetchedAt: string | undefined;
	failureReason: string | undefined;
	recrawlUrl: string;
	/**
	 * Surfaced in the failing test message so an operator reading the GitHub
	 * Actions output knows which writer to suspect without cross-referencing
	 * the reason enum.
	 */
	terminalCheckMessage: string;
}

/**
 * Hard cap on DDB scan pages. The articles table is small enough that a real
 * scan completes in well under 10 pages. Crossing 50 means the FilterExpression
 * stopped narrowing the scan (or the table grew an order of magnitude) — fail
 * loud here instead of burning the runner's 10-minute budget.
 */
const MAX_PAGES = 50;

/**
 * The third disjunct catches the `summaryStatus="ready" AND
 * attribute_not_exists(summary)` inconsistency the 2026-05-10 freshness-refresh
 * regression introduced — without it the row passes both status checks and the
 * canary reports green while the reader UI polls "Generating summary…" forever.
 *
 * Terminal failures (crawlStatus / summaryStatus = `failed` or `unsupported`)
 * are excluded from the scan: the operator owns recovery via /admin/recrawl
 * and the DLQ → SNS email alarm is the redrive signal, so flagging them here
 * would drown actionable pending-row reports in noise.
 */
const SCAN_INPUT = {
	FilterExpression:
		"summaryStatus = :pending " +
		"OR crawlStatus = :pending " +
		"OR (attribute_not_exists(summaryStatus) AND attribute_not_exists(crawlStatus) AND attribute_not_exists(summary)) " +
		"OR (summaryStatus = :ready AND attribute_not_exists(summary))",
	ProjectionExpression:
		"originalUrl, #u, summaryStatus, crawlStatus, summaryFailureReason, crawlFailureReason, contentFetchedAt, summary",
	ExpressionAttributeNames: { "#u": "url" },
	ExpressionAttributeValues: { ":pending": "pending", ":ready": "ready" },
} as const;

export async function collectStuckRows(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	origin: string;
}): Promise<StuckRow[]> {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: StuckArticleRow,
	});
	const stuck: StuckRow[] = [];
	let skippedNoOriginal = 0;
	let excludedDomain = 0;
	let pageCount = 0;
	let lastEvaluatedKey: Record<string, unknown> | undefined;
	do {
		pageCount += 1;
		assert(
			pageCount <= MAX_PAGES,
			`pagination cap reached (${MAX_PAGES} pages) — refine FilterExpression or raise the cap if the table is legitimately growing`,
		);
		const page = await table.scan({
			...SCAN_INPUT,
			ExclusiveStartKey: lastEvaluatedKey,
		});
		for (const row of page.items) {
			const verdict = checkTerminalState(row);
			if (verdict.terminal) continue;
			const reasons = classifyRow(row);
			if (row.originalUrl === undefined) {
				skippedNoOriginal += 1;
				continue;
			}
			if (isExcluded(row.originalUrl)) {
				excludedDomain += 1;
				continue;
			}
			stuck.push({
				originalUrl: row.originalUrl,
				reasons,
				contentFetchedAt: row.contentFetchedAt,
				failureReason: row.summaryFailureReason ?? row.crawlFailureReason,
				recrawlUrl: `${deps.origin}/admin/recrawl/${encodeURIComponent(row.originalUrl)}`,
				terminalCheckMessage: verdict.message,
			});
		}
		lastEvaluatedKey = page.lastEvaluatedKey;
	} while (lastEvaluatedKey !== undefined);
	if (skippedNoOriginal > 0) {
		process.stderr.write(`[info] skipped ${skippedNoOriginal} row(s) without originalUrl\n`);
	}
	if (excludedDomain > 0) {
		process.stderr.write(`[info] excluded ${excludedDomain} row(s) by domain filter\n`);
	}
	return stuck;
}
