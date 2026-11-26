#!/usr/bin/env node
/**
 * Failed-articles canary.
 *
 * Read-only status-index query that surfaces articles whose state machines reached a
 * terminal error outcome — crawl `failed` or summary `failed`. Crawl
 * `unsupported` and summary `skipped` are complete (supported) terminal
 * outcomes, not errors, and are not surfaced. Unlike the stuck-articles
 * canary, this one is a
 * diagnostic feed — the operator wants the full list of customer URLs that
 * the pipeline gave up on, so they can re-save and debug each one. A green
 * (zero-row) run is the normal steady state; a non-empty run is a debug
 * worklist. The workflow opens a tracking issue when the report is non-empty.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { CloudWatchLogs } from "@aws-sdk/client-cloudwatch-logs";
import { initDynamoDbCanaryReports } from "@packages/article-store";
import { createDynamoDocumentClient } from "@packages/storage-client";
import {
	type CanaryReportKey,
	CanaryReportSourceSchema,
	canaryReportPath,
} from "@packages/provider-contracts/canary-report";
import { collectFailedRows } from "./collect-failed-rows";
import { EXCLUDE_PATTERNS } from "./exclude-patterns";
import { classifyFailureHistory } from "./failure-history";
import { initFailureHistoryLogs, initFailureHistoryQuery } from "./failure-history-logs";
import { initFailureHistoryMemberships } from "./failure-history-memberships";
import { initLoadPublicViewEvidence } from "./failure-history-public";
import { formatFailedArticlesIssue, toCanaryReportRow } from "./failed-articles-issue";
import { parseIgnoredKeyHashes } from "./ignored-key-hashes";
import { parseReviewedAccess } from "./reviewed-access";
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
	const ignoredKeyHashes = parseIgnoredKeyHashes(getEnv("FAILED_ARTICLES_IGNORED_KEY_HASHES"));
	const reviewedAccess = parseReviewedAccess(getEnv("FAILED_ARTICLES_REVIEWED_ACCESS"));
	const region = requireEnv("AWS_REGION");
	const tableName = requireEnv("DYNAMODB_ARTICLES_TABLE");
	const origin = requireEnv("READPLACE_ORIGIN");
	const reportsTableName = requireEnv("DYNAMODB_CANARY_REPORTS_TABLE");
	const membershipTableName = getEnv("DYNAMODB_USER_ARTICLES_TABLE");
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
		ignoredKeyHashes,
	});
	process.stderr.write(`[info] failed rows: ${failed.length}\n`);
	if (failed.length === 0) return;
	const cutoff = new Date();
	const articles = failed.map(({ articleKey, ...row }) => ({ key: articleKey, ...row }));
	const logsClient = new CloudWatchLogs({ region });
	const [logMatches, memberships, publicViews] = await Promise.all([
		initFailureHistoryLogs({ client: logsClient })({ articles, cutoff }),
		membershipTableName === undefined
			? undefined
			: initFailureHistoryMemberships({ client, tableName: membershipTableName })(articles.map(({ key }) => key)),
		initLoadPublicViewEvidence({ query: initFailureHistoryQuery({ client: logsClient }) })({ rows: articles, now: cutoff }),
	]);
	const [first, ...rest] = failed.map((row) => classifyFailureHistory({
		row,
		cutoff,
		logs: logMatches.get(row.articleKey),
		memberships: memberships?.get(row.articleKey),
		publicOpenRecorded: publicViews.opened.has(row.articleKey),
		publicOpensCovered: publicViews.covered.has(row.articleKey),
		reviewedAccess,
	}));
	assert(first, "A nonempty canary report has a classified first row");
	const createdAt = cutoff.toISOString();
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
		historyEvidenceIncomplete: articles.some((article) => {
			const logs = logMatches.get(article.key);
			if (!logs?.ownerOpensCovered || !memberships?.has(article.key) || !publicViews.covered.has(article.key)) return true;
			return article.fullCrawlRequestedAt !== undefined &&
				article.fullCrawlRequestedAt === article.resolutionOnViewClaimedAt &&
				!logs.admissionCovered;
		}),
	});
	await writeFile(issuePath, `${JSON.stringify(issue)}\n`, "utf8");
});
