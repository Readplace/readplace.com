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
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { filterReachable } from "./check-reachable";
import { type StuckRow, collectStuckRows } from "./collect-stuck-rows";

function requireEnv(name: string): string {
	const value = process.env[name];
	assert(value, `${name} env var is required`);
	return value;
}

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
	const region = requireEnv("AWS_REGION");
	const tableName = requireEnv("DYNAMODB_ARTICLES_TABLE");
	const origin = requireEnv("READPLACE_ORIGIN");
	const client = createDynamoDocumentClient({ region });
	const stuck = await collectStuckRows({ client, tableName, origin });
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
				`Stuck article — ${row.terminalCheckMessage}; fetched: ${row.contentFetchedAt ?? "-"}; failure: ${row.failureReason ?? "-"}; recrawl: ${row.recrawlUrl}`,
			);
		});
	}
});
