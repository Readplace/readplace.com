#!/usr/bin/env node
/**
 * Tier 1+ crawl pipeline health canary.
 *
 * Exercises the production crawling pipeline END-TO-END from a user's
 * perspective: force a re-crawl via `https://readplace.com/admin/recrawl/<url>`
 * and wait for the Lambda-driven worker to produce a parsed article. A
 * "failed" state or a missing expectedContent substring fails the run.
 *
 * Why this replaces the previous GH-Actions-local canary: the crawler can
 * behave differently from AWS Lambda's egress than from GitHub Actions'
 * egress (different IP reputation, different TLS fingerprint handling).
 * This test routes through prod's Lambda, so a "green" run means prod can
 * actually crawl the URL — not that GitHub Actions can.
 *
 * Auth: shared secret in `x-service-token` header, matched by require-admin
 * middleware against `RECRAWL_SERVICE_TOKEN`. No session cookie needed.
 *
 * Required env:
 *   - RECRAWL_SERVICE_TOKEN: the shared secret
 *   - READPLACE_ORIGIN (optional): override origin (defaults to prod)
 *
 * Run via: pnpm nx run @packages/crawl-article:tier-1-plus-pipeline-health
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ReaderStatus, ReaderStatusSchema } from "@packages/article-state-types";
import { HEALTH_SOURCES } from "./health-sources";

function requireEnv(name: string): string {
	const value = process.env[name];
	assert(value, `${name} env var is required`);
	return value;
}

const ORIGIN = process.env.READPLACE_ORIGIN ?? "https://readplace.com";
const SERVICE_TOKEN = requireEnv("RECRAWL_SERVICE_TOKEN");

// 3s poll interval × 440 polls = 1320s (22 min) budget per source. A
// successful Lambda cold start + crawl + parse + write still lands in a
// few seconds; the budget exists to cover save-link's SQS retry → DLQ →
// terminal markCrawlFailed path. Phase 2 of the unstick-articles plan
// raised saveLinkWork's Lambda timeout 30→180s and matched SQS visibility
// 60→360s, so worst-case wall clock to DLQ is now visibility × maxReceiveCount
// = 360s × 3 = 1080s (~18 min). 22 min adds 4 min slack for cold starts
// and the DLQ handler's terminal write — both of which this canary MUST
// surface as a failing test, not a timeout.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 1_320_000;

type TerminalReaderStatus = Exclude<ReaderStatus, "pending">;

async function forceRecrawl(url: string): Promise<void> {
	const res = await fetch(`${ORIGIN}/admin/recrawl/${encodeURIComponent(url)}`, {
		headers: { "x-service-token": SERVICE_TOKEN },
	});
	assert.equal(
		res.status,
		200,
		`force-recrawl ${url}: expected 200, got ${res.status} — URL may not be in the articles DB, or the service token was rejected.`,
	);
	await res.text();
}

function extractReaderStatus(html: string): ReaderStatus | undefined {
	const match = html.match(/data-reader-status="([^"]*)"/);
	if (!match) return undefined;
	const result = ReaderStatusSchema.safeParse(match[1]);
	return result.success ? result.data : undefined;
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
					break;
				case "ready":
				case "failed":
				case "unsupported":
				case "unavailable":
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

describe("Tier 1+ crawl pipeline health (via readplace.com/admin/recrawl)", () => {
	for (const source of HEALTH_SOURCES) {
		describe(source.label, () => {
			it("force recrawls via prod Lambda and the parsed article matches expected content", async () => {
				await forceRecrawl(source.url);
				const { status, html } = await pollUntilDone(source.url);
				assert.equal(
					status,
					"ready",
					`crawl ended in '${status}' for ${source.url} — the Lambda could not parse the URL (likely an origin-side block of the Lambda egress IP, or a parser regression).`,
				);
				assert(
					html.includes(source.expectedContent),
					`expected content "${source.expectedContent}" not found in parsed output for ${source.url}`,
				);
			});
		});
	}
});
