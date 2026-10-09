import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFailedArticlesIssue, toCanaryReportRow } from "./failed-articles-issue";

const RUN_URL = "https://github.test/readplace/actions/runs/37967705297";
const REPORT_URL = "https://readplace.test/admin/canary-reports/failed-articles/run-37967705297-1";

describe("toCanaryReportRow", () => {
	it("keeps the URL, labels the row by its axes and writes each stored reason after its axis", () => {
		assert.deepEqual(
			toCanaryReportRow({
				originalUrl: "https://site.test/post?ref=feed&id=7",
				axes: ["crawl-failed", "summary-failed"],
				reasons: {
					"crawl-failed": '{"kind":"blocked","cause":"edge-block"}',
					"summary-failed": '{"kind":"crawl-failed"}',
				},
				savedAt: "2026-10-01T08:00:00.000Z",
				contentFetchedAt: "2026-10-02T09:30:00.000Z",
			}),
			{
				url: "https://site.test/post?ref=feed&id=7",
				labels: ["crawl-failed", "summary-failed"],
				detail: 'crawl-failed: {"kind":"blocked","cause":"edge-block"} | summary-failed: {"kind":"crawl-failed"}',
				savedAt: "2026-10-01T08:00:00.000Z",
				contentFetchedAt: "2026-10-02T09:30:00.000Z",
			},
		);
	});

	it("says no reason was stored when the row holds none", () => {
		assert.deepEqual(
			toCanaryReportRow({
				originalUrl: "https://site.test/quiet",
				axes: ["summary-failed"],
				reasons: {},
				savedAt: "2026-10-03T08:00:00.000Z",
				contentFetchedAt: undefined,
			}),
			{
				url: "https://site.test/quiet",
				labels: ["summary-failed"],
				detail: "(no stored reason)",
				savedAt: "2026-10-03T08:00:00.000Z",
				contentFetchedAt: undefined,
			},
		);
	});
});

describe("formatFailedArticlesIssue", () => {
	it("counts the rows by axis and by reason and links the report instead of listing any row", () => {
		const issue = formatFailedArticlesIssue({
			rows: [
				{
					originalUrl: "https://site.test/a",
					axes: ["crawl-failed"],
					reasons: { "crawl-failed": '{"kind":"blocked","cause":"edge-block"}' },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
				{
					originalUrl: "https://site.test/b",
					axes: ["crawl-failed"],
					reasons: { "crawl-failed": '{"kind":"blocked","cause":"edge-block"}' },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
				{
					originalUrl: "https://site.test/c",
					axes: ["crawl-failed"],
					reasons: { "crawl-failed": '{"kind":"fetch-failed","httpStatus":503}' },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
				{
					originalUrl: "https://site.test/d",
					axes: ["crawl-failed"],
					reasons: {
						"crawl-failed": '{"kind":"parse-error","detail":"no article body at https://site.test/d?token=reader-7"}',
					},
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: "2026-10-02T09:30:00.000Z",
				},
				{
					originalUrl: "https://site.test/e",
					axes: ["crawl-failed"],
					reasons: { "crawl-failed": "HTTP 403 from https://site.test/e" },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
				{
					originalUrl: "https://site.test/f",
					axes: ["summary-failed"],
					reasons: { "summary-failed": '{"kind":"model-overload"}' },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: "2026-10-02T09:30:00.000Z",
				},
				{
					originalUrl: "https://site.test/g",
					axes: ["summary-failed"],
					reasons: { "summary-failed": "DeepSeek timed out" },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: "2026-10-02T09:30:00.000Z",
				},
				{
					originalUrl: "https://site.test/h",
					axes: ["crawl-failed", "summary-failed"],
					reasons: {},
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
			],
			runUrl: RUN_URL,
			reportUrl: REPORT_URL,
			today: "2026-10-10",
		});

		assert.equal(issue.rowCount, 8);
		assert.equal(
			issue.body,
			[
				"<!-- CLAUDE_FAILED_ARTICLES_FIX -->",
				"",
				"The failed-articles canary surfaced rows whose state machines reached a terminal unsuccessful outcome. This is a debug worklist: investigate each cluster below, then close this issue once the backlog is processed (the canary skips its scan while this issue stays open).",
				"",
				"Each row's URL, stored reason and recrawl button are on the report page, which only admins can open. Do not copy a reader's URL into this issue, a comment or a commit; cite a row by its number on the report.",
				"",
				"## Context",
				`- **Run**: ${RUN_URL}`,
				"- **Date (UTC)**: 2026-10-10",
				"- **Failed rows**: 8",
				`- **Report (admins only)**: ${REPORT_URL}`,
				"",
				"## Breakdown by axis",
				"- **crawl-failed**: 6",
				"- **summary-failed**: 3",
				"",
				"## Breakdown by reason",
				"- **crawl-failed: blocked (edge-block)**: 2",
				"- **crawl-failed: fetch-failed (HTTP 503)**: 1",
				"- **crawl-failed: no stored reason**: 1",
				"- **crawl-failed: parse-error**: 1",
				"- **crawl-failed: unrecognised reason**: 1",
				"- **summary-failed: model-overload**: 1",
				"- **summary-failed: no stored reason**: 1",
				"- **summary-failed: unrecognised reason**: 1",
			].join("\n"),
		);
		assert.deepEqual(issue.body.match(/https?:\/\/\S+/g), [RUN_URL, REPORT_URL]);
	});

	it("puts the larger count first and orders equal counts by name", () => {
		const issue = formatFailedArticlesIssue({
			rows: [
				{
					originalUrl: "https://site.test/a",
					axes: ["summary-failed"],
					reasons: { "summary-failed": '{"kind":"model-overload"}' },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
				{
					originalUrl: "https://site.test/b",
					axes: ["summary-failed"],
					reasons: { "summary-failed": '{"kind":"model-overload"}' },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
				{
					originalUrl: "https://site.test/c",
					axes: ["crawl-failed"],
					reasons: { "crawl-failed": '{"kind":"origin-unreachable","code":"ENOTFOUND"}' },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
				{
					originalUrl: "https://site.test/d",
					axes: ["crawl-failed"],
					reasons: { "crawl-failed": '{"kind":"exhausted-retries","receiveCount":3}' },
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
			],
			runUrl: RUN_URL,
			reportUrl: REPORT_URL,
			today: "2026-10-10",
		});

		const lines = issue.body.split("\n");
		assert.deepEqual(lines.slice(lines.indexOf("## Breakdown by axis")), [
			"## Breakdown by axis",
			"- **crawl-failed**: 2",
			"- **summary-failed**: 2",
			"",
			"## Breakdown by reason",
			"- **summary-failed: model-overload**: 2",
			"- **crawl-failed: exhausted-retries**: 1",
			"- **crawl-failed: origin-unreachable**: 1",
		]);
	});
});
