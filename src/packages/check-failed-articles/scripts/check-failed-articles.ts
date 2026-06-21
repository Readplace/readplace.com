#!/usr/bin/env node
/**
 * Failed-articles canary.
 *
 * Read-only DDB scan that surfaces articles whose state machines reached a
 * terminal error outcome — crawl `failed` or summary `failed`. Crawl
 * `unsupported` and summary `skipped` are complete (supported) terminal
 * outcomes, not errors, and are not surfaced. Unlike the stuck-articles
 * canary, this one is a
 * diagnostic feed — the operator wants the full list of customer URLs that
 * the pipeline gave up on, so they can re-save and debug each one. A green
 * (zero-row) scan is the normal steady state; a non-empty scan is a debug
 * worklist, not a CI failure. The script therefore always exits 0; the
 * workflow opens a tracking issue when the report is non-empty.
 *
 * Required env:
 *   - AWS_REGION
 *   - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (the SDK reads these directly)
 *   - DYNAMODB_ARTICLES_TABLE
 *   - READPLACE_ORIGIN (used to build the admin recrawl URL per row)
 *
 * Optional env:
 *   - FAILED_ARTICLES_LOOKBACK_DAYS — non-negative integer. 0 (default)
 *     disables the time gate and surfaces every historical row; a positive
 *     value gates rows on `savedAt >= (now - N days)`.
 *   - FAILED_ARTICLES_REPORT_PATH — when set, the canary writes a JSON
 *     report to this path. The workflow reads it to format the issue body
 *     without re-scanning DDB.
 *
 * Run via: pnpm nx run @packages/check-failed-articles:check-failed-articles
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { type FailedRow, collectFailedRows } from "./collect-failed-rows";
import { EXCLUDE_PATTERNS } from "./exclude-patterns";
import { getEnv, requireEnv } from "./require-env";

function parseLookbackDays(): number {
	const raw = getEnv("FAILED_ARTICLES_LOOKBACK_DAYS");
	if (raw === undefined) return 0;
	const parsed = Number(raw);
	assert(
		Number.isInteger(parsed) && parsed >= 0,
		`FAILED_ARTICLES_LOOKBACK_DAYS must be a non-negative integer (got '${raw}')`,
	);
	return parsed;
}

async function writeReportIfRequested(failed: FailedRow[]): Promise<void> {
	const reportPath = getEnv("FAILED_ARTICLES_REPORT_PATH");
	if (reportPath === undefined) return;
	await writeFile(reportPath, `${JSON.stringify({ failed }, null, 2)}\n`, "utf8");
}

test("Failed articles canary", async () => {
	const region = requireEnv("AWS_REGION");
	const tableName = requireEnv("DYNAMODB_ARTICLES_TABLE");
	const origin = requireEnv("READPLACE_ORIGIN");
	const lookbackDays = parseLookbackDays();
	const client = createDynamoDocumentClient({ region });
	process.stderr.write(
		`[info] lookback gate: ${lookbackDays === 0 ? "disabled (all time)" : `savedAt >= now - ${lookbackDays}d`}\n`,
	);
	const failed = await collectFailedRows({
		client,
		tableName,
		origin,
		now: () => new Date(),
		lookbackDays,
		excludePatterns: EXCLUDE_PATTERNS,
	});
	await writeReportIfRequested(failed);
	process.stderr.write(`[info] failed rows: ${failed.length}\n`);
	for (const row of failed) {
		const axes = row.axes.join(",");
		process.stderr.write(`  [${axes}] ${row.originalUrl}\n`);
	}
});
