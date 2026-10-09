#!/usr/bin/env node
/**
 * Stuck-articles canary.
 *
 * Read-only DDB scan: returns one failing node:test sub-test per article
 * whose state machines never reached a terminal-good state. Zero stuck
 * rows = green.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { initDynamoDbCanaryReports } from "@packages/article-store";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import {
	type CanaryReportKey,
	CanaryReportSourceSchema,
	canaryReportPath,
} from "@packages/provider-contracts/canary-report";
import { requireEnv } from "@packages/require-env";
import { filterReachable } from "./check-reachable";
import {
	CRAWL_MIN_AGE_MS,
	SUMMARY_MIN_AGE_MS,
	collectStuckRows,
} from "./collect-stuck-rows";
import { formatStuckArticlesIssue, toCanaryReportRow } from "./stuck-articles-issue";

/**
 * Reachability ping budget per stuck row. Matches the production crawler's
 * fetch timeout so the canary's idea of "reachable" tracks the crawler's
 * idea of "had a chance".
 */
const REACHABILITY_TIMEOUT_MS = 10_000;

/**
 * Bounded parallelism for the reachability pings. The DDB scan caps at
 * MAX_PAGES so the worst-case row count is small, but bounding parallelism
 * keeps the runner from opening a pathological number of sockets when a
 * regression in classification widens the candidate set.
 */
const REACHABILITY_CONCURRENCY = 8;

test("Stuck articles canary", async (t) => {
	const region = requireEnv("AWS_REGION");
	assert(region, "AWS_REGION env var must not be empty");
	const tableName = requireEnv("DYNAMODB_ARTICLES_TABLE");
	assert(tableName, "DYNAMODB_ARTICLES_TABLE env var must not be empty");
	const origin = requireEnv("READPLACE_ORIGIN");
	assert(origin, "READPLACE_ORIGIN env var must not be empty");
	const reportsTableName = requireEnv("DYNAMODB_CANARY_REPORTS_TABLE");
	const issuePath = requireEnv("STUCK_ARTICLES_ISSUE_PATH");
	const runId = requireEnv("GITHUB_RUN_ID");
	const runUrl = `${requireEnv("GITHUB_SERVER_URL")}/${requireEnv("GITHUB_REPOSITORY")}/actions/runs/${runId}`;
	const key: CanaryReportKey = {
		canary: "stuck-articles",
		source: CanaryReportSourceSchema.parse(`run-${runId}-${requireEnv("GITHUB_RUN_ATTEMPT")}`),
	};
	const reportUrl = `${origin}${canaryReportPath(key)}`;
	const client = createDynamoDocumentClient({ region });
	process.stderr.write(
		`[info] min-age gate: crawl-pending ≥ ${CRAWL_MIN_AGE_MS / 60_000}min, summary-pending ≥ ${SUMMARY_MIN_AGE_MS / 60_000}min\n`,
	);
	const stuck = await collectStuckRows({
		client,
		tableName,
		now: () => new Date(),
	});
	const reachable = await filterReachable(stuck, {
		fetch: globalThis.fetch,
		timeoutMs: REACHABILITY_TIMEOUT_MS,
		concurrency: REACHABILITY_CONCURRENCY,
		log: (msg) => process.stderr.write(`${msg}\n`),
	});
	const [first, ...rest] = reachable;
	if (first === undefined) return;
	const createdAt = new Date().toISOString();
	await initDynamoDbCanaryReports({ client, tableName: reportsTableName }).saveCanaryReport({
		...key,
		runUrl,
		createdAt,
		rows: [toCanaryReportRow(first), ...rest.map(toCanaryReportRow)],
	});
	const issue = formatStuckArticlesIssue({
		rows: [first, ...rest],
		runUrl,
		reportUrl,
		today: createdAt.slice(0, 10),
	});
	await writeFile(issuePath, `${JSON.stringify(issue)}\n`, "utf8");
	for (const [index, row] of reachable.entries()) {
		await t.test(`[${row.reasons.join(",")}] row ${index + 1} of ${reachable.length}`, () => {
			assert.fail(
				`Stuck article — ${row.terminalCheckMessage}; fetched: ${row.contentFetchedAt ?? "-"}; report: ${reportUrl}`,
			);
		});
	}
});
