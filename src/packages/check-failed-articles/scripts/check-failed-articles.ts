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
import { collectFailedRows } from "./collect-failed-rows";
import { EXCLUDE_PATTERNS } from "./exclude-patterns";
import { formatFailedArticlesIssue, toCanaryReportRow } from "./failed-articles-issue";
import { getEnv, requireEnv } from "@packages/require-env";

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

test("Failed articles canary", async () => {
	const region = requireEnv("AWS_REGION");
	const tableName = requireEnv("DYNAMODB_ARTICLES_TABLE");
	const origin = requireEnv("READPLACE_ORIGIN");
	const reportsTableName = requireEnv("DYNAMODB_CANARY_REPORTS_TABLE");
	const issuePath = requireEnv("FAILED_ARTICLES_ISSUE_PATH");
	const runId = requireEnv("GITHUB_RUN_ID");
	const runUrl = `${requireEnv("GITHUB_SERVER_URL")}/${requireEnv("GITHUB_REPOSITORY")}/actions/runs/${runId}`;
	const key: CanaryReportKey = {
		canary: "failed-articles",
		source: CanaryReportSourceSchema.parse(`run-${runId}-${requireEnv("GITHUB_RUN_ATTEMPT")}`),
	};
	const reportUrl = `${origin}${canaryReportPath(key)}`;
	const lookbackDays = parseLookbackDays();
	const client = createDynamoDocumentClient({ region });
	process.stderr.write(
		`[info] lookback gate: ${lookbackDays === 0 ? "disabled (all time)" : `savedAt >= now - ${lookbackDays}d`}\n`,
	);
	const failed = await collectFailedRows({
		client,
		tableName,
		now: () => new Date(),
		lookbackDays,
		excludePatterns: EXCLUDE_PATTERNS,
	});
	process.stderr.write(`[info] failed rows: ${failed.length}\n`);
	const [first, ...rest] = failed;
	if (first === undefined) return;
	const createdAt = new Date().toISOString();
	await initDynamoDbCanaryReports({ client, tableName: reportsTableName }).saveCanaryReport({
		...key,
		runUrl,
		createdAt,
		rows: [toCanaryReportRow(first), ...rest.map(toCanaryReportRow)],
	});
	process.stderr.write(`[info] report: ${reportUrl}\n`);
	const issue = formatFailedArticlesIssue({
		rows: [first, ...rest],
		runUrl,
		reportUrl,
		today: createdAt.slice(0, 10),
	});
	await writeFile(issuePath, `${JSON.stringify(issue)}\n`, "utf8");
});
