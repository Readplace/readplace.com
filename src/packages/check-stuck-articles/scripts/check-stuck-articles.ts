#!/usr/bin/env node
/**
 * Stuck-articles canary.
 *
 * Read-only DDB scan: returns one failing node:test sub-test per article
 * whose state machines never reached a terminal-good state. Zero stuck
 * rows = green. Replaces /tmp/list-stuck-articles.sh — same FilterExpression
 * and same exclude-regex semantics, but the classifier and the Zod schemas
 * are bound to @packages/article-state-types so a new summaryStatus or
 * crawlStatus value upstream fails `tsc --noEmit` immediately, instead of
 * producing a quiet false-negative on tomorrow's cron.
 *
 * Required env:
 *   - AWS_REGION
 *   - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (the SDK reads these directly)
 *   - DYNAMODB_ARTICLES_TABLE
 *
 *   - READPLACE_ORIGIN (used to build admin recrawl URLs in the
 *     failing-test message for each stuck row)
 *
 * Run via: pnpm nx run @packages/check-stuck-articles:check-stuck-articles
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
	CrawlStatusSchema,
	SummaryStatusSchema,
} from "@packages/article-state-types";
import {
	createDynamoDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { filterReachable } from "./check-reachable";
import { type StuckReason, classifyRow } from "./classify-row";
import { EXCLUDE_PATTERNS } from "./exclude-patterns";

function requireEnv(name: string): string {
	const value = process.env[name];
	assert(value, `${name} env var is required`);
	return value;
}

const REGION = requireEnv("AWS_REGION");
const TABLE = requireEnv("DYNAMODB_ARTICLES_TABLE");
const ORIGIN = requireEnv("READPLACE_ORIGIN");

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

interface StuckRow {
	originalUrl: string;
	reasons: StuckReason[];
	contentFetchedAt: string | undefined;
	failureReason: string | undefined;
	recrawlUrl: string;
}

/**
 * Hard cap on DDB scan pages. The articles table is small enough that a real
 * scan completes in well under 10 pages. Crossing 50 means the FilterExpression
 * stopped narrowing the scan (or the table grew an order of magnitude) — fail
 * loud here instead of burning the runner's 10-minute budget.
 */
const MAX_PAGES = 50;

/**
 * Reachability ping budget per stuck row. Matches the production crawler's
 * FETCH_TIMEOUT_MS in src/packages/crawl-article/src/crawl-article.ts so the
 * canary's idea of "reachable" tracks the crawler's idea of "had a chance".
 */
const REACHABILITY_TIMEOUT_MS = 10_000;

/**
 * Bounded parallelism for the reachability pings. The DDB scan caps at
 * MAX_PAGES so the worst-case row count is small, but bounding parallelism
 * keeps the runner from opening a pathological number of sockets when a
 * regression in classification widens the candidate set.
 */
const REACHABILITY_CONCURRENCY = 8;

async function collectStuckRows(): Promise<StuckRow[]> {
	const client = createDynamoDocumentClient({ region: REGION });
	const table = defineDynamoTable({
		client,
		tableName: TABLE,
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
			// The fourth disjunct catches the `summaryStatus="ready" AND
			// attribute_not_exists(summary)` inconsistency the 2026-05-10
			// freshness-refresh regression introduced — without it the row
			// passes both status checks and the canary reports green while the
			// reader UI polls "Generating summary…" forever.
			FilterExpression:
				"summaryStatus IN (:pending, :failed) " +
				"OR crawlStatus IN (:pending, :failed) " +
				"OR (attribute_not_exists(summaryStatus) AND attribute_not_exists(crawlStatus) AND attribute_not_exists(summary)) " +
				"OR (summaryStatus = :ready AND attribute_not_exists(summary))",
			ProjectionExpression:
				"originalUrl, #u, summaryStatus, crawlStatus, summaryFailureReason, crawlFailureReason, contentFetchedAt, summary",
			ExpressionAttributeNames: { "#u": "url" },
			ExpressionAttributeValues: { ":pending": "pending", ":failed": "failed", ":ready": "ready" },
			ExclusiveStartKey: lastEvaluatedKey,
		});
		for (const row of page.items) {
			const reasons = classifyRow(row);
			if (reasons.length === 0) continue;
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
				recrawlUrl: `${ORIGIN}/admin/recrawl/${encodeURIComponent(row.originalUrl)}`,
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

/**
 * When STUCK_ARTICLES_REPORT_PATH is set (CI), drop a JSON report so the
 * on-failure workflow step can format the @claude issue body without
 * re-scanning DDB or scraping node:test output. Local runs leave the env
 * unset and skip the write.
 */
async function writeReportIfRequested(stuck: StuckRow[]): Promise<void> {
	const reportPath = process.env.STUCK_ARTICLES_REPORT_PATH;
	if (reportPath === undefined) return;
	await writeFile(reportPath, `${JSON.stringify({ stuck }, null, 2)}\n`, "utf8");
}

test("Stuck articles canary", async (t) => {
	const stuck = await collectStuckRows();
	const reachable = await filterReachable(stuck, {
		fetch: globalThis.fetch,
		timeoutMs: REACHABILITY_TIMEOUT_MS,
		concurrency: REACHABILITY_CONCURRENCY,
		log: (msg) => process.stderr.write(`${msg}\n`),
	});
	await writeReportIfRequested(reachable);
	for (const row of reachable) {
		const label = `[${row.reasons.join(",")}] ${row.originalUrl}`;
		await t.test(label, () => {
			assert.fail(
				`Stuck article — fetched: ${row.contentFetchedAt ?? "-"}; failure: ${row.failureReason ?? "-"}; recrawl: ${row.recrawlUrl}`,
			);
		});
	}
});
