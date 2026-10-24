import assert from "node:assert/strict";
import { initInMemoryLogsInsights } from "./in-memory-logs-insights";

const WEEK = {
	logGroupNames: ["/readplace/analytics"],
	startTime: new Date("2026-10-11T00:00:00.000Z"),
	endTime: new Date("2026-10-18T00:00:00.000Z"),
};

describe("initInMemoryLogsInsights", () => {
	it("answers a seeded query string with its rows and records the query it ran", async () => {
		const logsInsights = initInMemoryLogsInsights();
		const rows = [[{ field: "event", value: "starter_assigned" }, { field: "events", value: "12" }]];
		logsInsights.answerQuery({ queryString: "stats count(*) as events by event", rows });

		const { signal } = new AbortController();

		const answered = await logsInsights.runLogsInsightsQuery({ ...WEEK, queryString: "stats count(*) as events by event" }, { signal });

		assert.deepEqual(answered, rows);
		assert.deepEqual(logsInsights.runQueries, [{ ...WEEK, queryString: "stats count(*) as events by event" }]);
		assert.deepEqual(logsInsights.signals, [signal]);
	});

	it("answers a query nobody seeded with no rows", async () => {
		const logsInsights = initInMemoryLogsInsights();
		logsInsights.answerQuery({ queryString: "stats count(*) by event", rows: [[{ field: "event", value: "x" }]] });

		assert.deepEqual(
			await logsInsights.runLogsInsightsQuery({ ...WEEK, queryString: "stats count(*) by outcome" }, { signal: new AbortController().signal }),
			[],
		);
	});

	it("rejects a query seeded to fail with its error", async () => {
		const logsInsights = initInMemoryLogsInsights();
		logsInsights.failQuery({ queryString: "stats count(*) by event", error: new Error("Logs Insights query query-7 ended Timeout") });

		await assert.rejects(
			logsInsights.runLogsInsightsQuery({ ...WEEK, queryString: "stats count(*) by event" }, { signal: new AbortController().signal }),
			/Logs Insights query query-7 ended Timeout/,
		);
	});
});
