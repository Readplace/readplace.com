import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStuckArticlesIssue, toCanaryReportRow } from "./stuck-articles-issue";

const RUN_URL = "https://github.test/readplace/actions/runs/37967705297";
const REPORT_URL = "https://readplace.test/admin/canary-reports/stuck-articles/run-37967705297-1";

describe("toCanaryReportRow", () => {
	it("keeps the URL, labels the row by its reasons and carries the state message as its detail", () => {
		assert.deepEqual(
			toCanaryReportRow({
				originalUrl: "https://site.test/post?ref=feed&id=7",
				reasons: ["summary-pending", "crawl-pending"],
				contentFetchedAt: "2026-10-02T09:30:00.000Z",
				terminalCheckMessage: "summaryStatus is 'pending'; crawlStatus is 'pending'",
			}),
			{
				url: "https://site.test/post?ref=feed&id=7",
				labels: ["summary-pending", "crawl-pending"],
				detail: "summaryStatus is 'pending'; crawlStatus is 'pending'",
				savedAt: undefined,
				contentFetchedAt: "2026-10-02T09:30:00.000Z",
			},
		);
	});
});

describe("formatStuckArticlesIssue", () => {
	it("counts the rows by reason and links the report instead of listing any row", () => {
		const issue = formatStuckArticlesIssue({
			rows: [
				{
					originalUrl: "https://site.test/a?token=reader-7",
					reasons: ["summary-skipped-ai-unavailable"],
					contentFetchedAt: "2026-10-02T09:30:00.000Z",
					terminalCheckMessage: "summaryStatus is 'skipped' with reason 'ai-unavailable'",
				},
				{
					originalUrl: "https://site.test/b",
					reasons: ["summary-pending", "crawl-pending"],
					contentFetchedAt: undefined,
					terminalCheckMessage: "summaryStatus is 'pending'; crawlStatus is 'pending'",
				},
				{
					originalUrl: "https://site.test/c",
					reasons: ["crawl-pending"],
					contentFetchedAt: undefined,
					terminalCheckMessage: "crawlStatus is 'pending'",
				},
				{
					originalUrl: "https://site.test/d",
					reasons: ["summary-pending"],
					contentFetchedAt: "2026-10-02T09:30:00.000Z",
					terminalCheckMessage: "summaryStatus is 'pending'",
				},
			],
			runUrl: RUN_URL,
			reportUrl: REPORT_URL,
			today: "2026-10-10",
		});

		assert.equal(issue.rowCount, 4);
		assert.equal(
			issue.body,
			[
				"<!-- CLAUDE_STUCK_ARTICLES_FIX -->",
				"",
				"The stuck-articles canary failed on its scheduled run. The rows on the report never reached a terminal-good state and their URLs still resolve. Investigate the root cause, then close this issue once resolved.",
				"",
				"Each row's URL, state and recrawl button are on the report page, which only admins can open. Do not copy a reader's URL into this issue, a comment or a commit; cite a row by its number on the report.",
				"",
				"## Context",
				`- **Run**: ${RUN_URL}`,
				"- **Date (UTC)**: 2026-10-10",
				"- **Stuck rows**: 4",
				`- **Report (admins only)**: ${REPORT_URL}`,
				"",
				"## Breakdown by reason",
				"- **crawl-pending**: 2",
				"- **summary-pending**: 2",
				"- **summary-skipped-ai-unavailable**: 1",
			].join("\n"),
		);
		assert.deepEqual(issue.body.match(/https?:\/\/\S+/g), [RUN_URL, REPORT_URL]);
	});

	it("puts the larger count first", () => {
		const issue = formatStuckArticlesIssue({
			rows: [
				{
					originalUrl: "https://site.test/a",
					reasons: ["summary-skipped-ai-unavailable"],
					contentFetchedAt: undefined,
					terminalCheckMessage: "summaryStatus is 'skipped' with reason 'ai-unavailable'",
				},
				{
					originalUrl: "https://site.test/b",
					reasons: ["summary-skipped-ai-unavailable"],
					contentFetchedAt: undefined,
					terminalCheckMessage: "summaryStatus is 'skipped' with reason 'ai-unavailable'",
				},
				{
					originalUrl: "https://site.test/c",
					reasons: ["crawl-pending"],
					contentFetchedAt: undefined,
					terminalCheckMessage: "crawlStatus is 'pending'",
				},
			],
			runUrl: RUN_URL,
			reportUrl: REPORT_URL,
			today: "2026-10-10",
		});

		const lines = issue.body.split("\n");
		assert.deepEqual(lines.slice(lines.indexOf("## Breakdown by reason")), [
			"## Breakdown by reason",
			"- **summary-skipped-ai-unavailable**: 2",
			"- **crawl-pending**: 1",
		]);
	});
});
