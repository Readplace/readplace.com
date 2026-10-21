import assert from "node:assert/strict";
import type { GetQueryResultsCommand, StartQueryCommand } from "@aws-sdk/client-cloudwatch-logs";
import { initCloudWatchLogsInsights } from "./cloudwatch-logs-insights";

const LAST_WEEK = {
	logGroupNames: ["/readplace/analytics"],
	queryString: "filter event = \"starter_assigned\" | stats count(*) as events by arm",
	startTime: new Date("2026-10-11T00:00:00.000Z"),
	endTime: new Date("2026-10-18T00:00:00.000Z"),
};

function fakeLogsInsights(responses: unknown[]) {
	const started: StartQueryCommand[] = [];
	const polled: GetQueryResultsCommand[] = [];
	const slept: number[] = [];
	const runQuery = initCloudWatchLogsInsights({
		startQuery: async (command) => {
			started.push(command);
			return { queryId: "query-7" };
		},
		getQueryResults: async (command) => {
			polled.push(command);
			const next = responses.shift();
			assert(next, "the test supplied too few GetQueryResults responses");
			return next;
		},
		sleep: async (ms) => {
			slept.push(ms);
		},
		pollIntervalMs: 1000,
	});
	return { runQuery, started, polled, slept };
}

describe("initCloudWatchLogsInsights", () => {
	it("starts the query over the window in epoch seconds, polls until it completes, and returns each row without @ptr or value-less cells", async () => {
		const logsInsights = fakeLogsInsights([
			{ status: "Scheduled" },
			{ status: "Running", results: [] },
			{
				status: "Complete",
				results: [
					[
						{ field: "arm", value: "treatment" },
						{ field: "reason" },
						{ field: "events", value: "12" },
						{ field: "@ptr", value: "CmQKKQolOTk5" },
					],
				],
			},
		]);

		const rows = await logsInsights.runQuery(LAST_WEEK);

		assert.deepEqual(rows, [[{ field: "arm", value: "treatment" }, { field: "events", value: "12" }]]);
		assert.deepEqual(
			logsInsights.started.map((command) => command.input),
			[{
				logGroupNames: ["/readplace/analytics"],
				queryString: LAST_WEEK.queryString,
				startTime: 1_791_676_800,
				endTime: 1_792_281_600,
				limit: 1000,
			}],
		);
		assert.deepEqual(logsInsights.polled.map((command) => command.input), [
			{ queryId: "query-7" },
			{ queryId: "query-7" },
			{ queryId: "query-7" },
		]);
		assert.deepEqual(logsInsights.slept, [1000, 1000]);
	});

	it("fails the request when the query ends in any status other than Complete", async () => {
		const logsInsights = fakeLogsInsights([{ status: "Running" }, { status: "Timeout" }]);

		await assert.rejects(logsInsights.runQuery(LAST_WEEK), /Logs Insights query query-7 ended Timeout/);
	});
});
