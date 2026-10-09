import assert from "node:assert/strict";
import { type CanaryReport, CanaryReportSourceSchema } from "@packages/provider-contracts/canary-report";
import { initInMemoryCanaryReports } from "./in-memory-canary-report";

describe("initInMemoryCanaryReports", () => {
	it("finds a saved report by its canary and source", async () => {
		const reports = initInMemoryCanaryReports();
		const report: CanaryReport = {
			canary: "failed-articles",
			source: CanaryReportSourceSchema.parse("run-37967705297-2"),
			runUrl: "https://github.test/actions/runs/37967705297",
			createdAt: "2026-10-10T20:00:05.000Z",
			rows: [
				{
					url: "https://site.test/post",
					labels: ["crawl-failed"],
					detail: "crawl-failed: {\"kind\":\"blocked\",\"cause\":\"edge-block\"}",
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
			],
		};

		await reports.saveCanaryReport(report);

		assert.deepEqual(
			await reports.findCanaryReport({ canary: "failed-articles", source: CanaryReportSourceSchema.parse("run-37967705297-2") }),
			report,
		);
	});

	it("finds no report under another canary's key with the same source", async () => {
		const reports = initInMemoryCanaryReports();
		await reports.saveCanaryReport({
			canary: "failed-articles",
			source: CanaryReportSourceSchema.parse("run-12-1"),
			runUrl: "https://github.test/actions/runs/12",
			createdAt: "2026-10-10T20:00:05.000Z",
			rows: [
				{
					url: "https://site.test/post",
					labels: ["crawl-failed"],
					detail: "(no stored reason)",
					savedAt: undefined,
					contentFetchedAt: undefined,
				},
			],
		});

		assert.equal(
			await reports.findCanaryReport({ canary: "stuck-articles", source: CanaryReportSourceSchema.parse("run-12-1") }),
			undefined,
		);
	});
});
