#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { type ReaderStatus, ReaderStatusSchema } from "@packages/article-state-types";
import { getEnv, requireEnv } from "@packages/require-env";
import { parseHTML } from "linkedom";
import { type HealthSource, HEALTH_SOURCES } from "./health-sources";
import { initArchiveHealthClient } from "./archive-health-client";
import { initArchiveHealthEvidence } from "./archive-health-evidence";
import { initArchiveHealthAws } from "./archive-health-aws";
import { initArchiveHealth } from "./archive-health";

const ORIGIN = requireEnv("READPLACE_ORIGIN");
assert(ORIGIN, "READPLACE_ORIGIN env var must not be empty");
const SERVICE_TOKEN = requireEnv("RECRAWL_SERVICE_TOKEN");
assert(SERVICE_TOKEN, "RECRAWL_SERVICE_TOKEN env var must not be empty");
const CANARY_EMAIL = requireEnv("CRAWL_CANARY_EMAIL");
const CANARY_PASSWORD = requireEnv("CRAWL_CANARY_PASSWORD");
assert(CANARY_EMAIL && CANARY_PASSWORD, "configure an existing verified canary account with write access");
const REPORT_PATH = requireEnv("ARCHIVE_HEALTH_REPORT_PATH");
const STEP_SUMMARY = getEnv("GITHUB_STEP_SUMMARY");
const runFile = promisify(execFile);
const archiveAws = initArchiveHealthAws({
	runAws: async (args) => (await runFile("aws", args, { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 })).stdout,
	region: requireEnv("AWS_REGION"),
	contentBucket: requireEnv("CONTENT_BUCKET_NAME"),
	comparisonLogGroup: requireEnv("ARCHIVE_COMPARISON_LOG_GROUP"),
});

// 3s poll interval × 800 polls = 2400s (40 min) budget per source. A
// successful Lambda cold start + crawl + parse + write still lands in a
// few seconds; the budget exists to cover save-link's SQS retry → DLQ →
// terminal markCrawlFailed path. saveLinkWork's Lambda timeout is 360s
// and SQS visibility is 720s (≥2× Lambda timeout per AWS guidance) so the
// scanned-PDF OCR path has room. Worst-case wall clock to DLQ is therefore
// visibility × maxReceiveCount = 720s × 3 = 2160s (~36 min); 40 min adds
// 4 min slack for cold starts and the DLQ handler's terminal write — both
// of which this canary MUST surface as a failing test, not a timeout.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 2_400_000;

type TerminalReaderStatus = Exclude<ReaderStatus, "pending" | "slow">;

async function forceRecrawl(url: string): Promise<void> {
	const res = await fetch(`${ORIGIN}/admin/recrawl?url=${encodeURIComponent(url)}`, {
		method: "POST",
		headers: { "x-service-token": SERVICE_TOKEN },
	});
	assert.equal(
		res.status,
		200,
		`force-recrawl ${url}: expected 200, got ${res.status} — URL may not be in the articles DB, or the service token was rejected; 502 means the wrapper no longer resolves to an article, 409 that it now resolves to a different article than it was saved as.`,
	);
	await res.text();
}

function extractReaderStatus(html: string): ReaderStatus | undefined {
	const match = html.match(/data-reader-status="([^"]*)"/);
	if (!match) return undefined;
	const result = ReaderStatusSchema.safeParse(match[1]);
	assert(
		result.success,
		`unrecognised data-reader-status '${match[1]}' — the rendered vocabulary has drifted from ReaderStatusSchema`,
	);
	return result.data;
}

async function pollUntilDone(url: string): Promise<{ status: TerminalReaderStatus; html: string }> {
	const deadline = Date.now() + POLL_TIMEOUT_MS;
	let pollCount = 0;
	let lastStatus: ReaderStatus | "unknown" = "unknown";
	let lastHtml = "";
	while (Date.now() < deadline) {
		const res = await fetch(
			`${ORIGIN}/admin/recrawl/reader?url=${encodeURIComponent(url)}&poll=${pollCount}`,
			{
				headers: { "x-service-token": SERVICE_TOKEN },
			},
		);
		assert.equal(res.status, 200, `poll ${url}: expected 200, got ${res.status}`);
		lastHtml = await res.text();
		const status = extractReaderStatus(lastHtml);
		lastStatus = status ?? "unknown";
		if (status !== undefined) {
			switch (status) {
				case "pending":
				case "slow":
					break;
				case "ready":
				case "failed":
				case "unsupported":
				case "unavailable":
				case "blocked":
				case "origin-down":
				case "not-found":
				case "not-an-article":
					return { status, html: lastHtml };
				default: {
					const _exhaustive: never = status;
					throw new Error(`unhandled reader status '${String(_exhaustive)}' for ${url}`);
				}
			}
		}
		pollCount += 1;
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
	throw new Error(
		`poll timed out for ${url} after ${POLL_TIMEOUT_MS}ms; last reader-status was '${lastStatus}'`,
	);
}

async function checkReader(source: HealthSource): Promise<void> {
	const { status, html } = await pollUntilDone(source.url);
	assert.equal(
		status,
		"ready",
		`${source.label}: crawl ended in '${status}' for ${source.url} — the Lambda could not parse the URL (likely an origin-side block of the Lambda egress IP, or a parser regression).`,
	);
	const expected =
		typeof source.expectedContent === "string"
			? [source.expectedContent]
			: source.expectedContent;
	for (const needle of expected) {
		assert(
			html.includes(needle),
			`${source.label}: expected content "${needle}" not found in parsed output for ${source.url}`,
		);
	}
	for (const forbidden of source.forbiddenContent ?? []) {
		assert(
			!html.includes(forbidden),
			`${source.label}: forbidden chrome "${forbidden}" found in parsed output for ${source.url} — site rule regression`,
		);
	}
	if (source.expectedDestinationUrl !== undefined) {
		const savedLink = parseHTML(html).document.querySelector("[data-test-original-link]")?.getAttribute("href");
		assert(savedLink, `${source.label}: no "View original" link in the parsed output for ${source.url}`);
		assert.equal(
			ArticleResourceUniqueId.parse(savedLink).value,
			ArticleResourceUniqueId.parse(source.expectedDestinationUrl).value,
			`${source.label}: the saved link is "${savedLink}", not the article the wrapper points at — the wrapper was saved as itself (save-time resolution regression or missing alias) for ${source.url}`,
		);
	}
}

// HEALTH_SOURCES is ordered quick-link-first, slow-PDF-last. A single
// sequential loop is the fail-fast gate: the first source that throws aborts
// the loop, so a broken quick-link source can never reach the expensive PDF
// sources and spend DeepInfra OCR tokens on a run that is already red. The
// thrown assertion carries the failing source's label, and node --test exits
// non-zero on the throw — no bail flag or shared failure state needed.
describe("Tier 1+ crawl pipeline health", () => {
	it("checks production recrawls and actual archive saves sequentially", async (test) => {
		const reports: unknown[] = [];
		await writeFile(REPORT_PATH, "[]\n");
		const archiveHealth = initArchiveHealth({
			client: initArchiveHealthClient({ origin: ORIGIN, email: CANARY_EMAIL, password: CANARY_PASSWORD, fetch }),
			evidence: initArchiveHealthEvidence(archiveAws),
			readCompletionMessages: archiveAws.readCompletionMessages,
			now: Date.now,
			wait: () => new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS)),
			timeoutMs: POLL_TIMEOUT_MS,
			report: async (report) => {
				reports.push(report);
				await writeFile(REPORT_PATH, `${JSON.stringify(reports, null, 2)}\n`);
				const summary = report.outcome === "deduplicated"
					? `${report.label}: same original card confirmed.`
					: `${report.label}: fresh archive ${report.freshArchive}; ${report.outcome} ${report.selected.fresh ? "fresh" : "cached"} ${report.selected.kind} candidate (${report.saveAttemptId}).`;
				test.diagnostic(summary);
				if (STEP_SUMMARY !== undefined) await appendFile(STEP_SUMMARY, `- ${summary}\n`);
			},
		});
		for (const source of HEALTH_SOURCES) {
			try {
				if ("save" in source) await archiveHealth(source);
				else await forceRecrawl(source.url);
				await checkReader(source);
			} catch (error) {
				reports.push({ label: source.label, outcome: "failed", error: String(error) });
				await writeFile(REPORT_PATH, `${JSON.stringify(reports, null, 2)}\n`);
				throw error;
			}
		}
	});
});
