import assert from "node:assert/strict";
import type { GetQueryResultsCommand, StartQueryCommand, StopQueryCommand } from "@aws-sdk/client-cloudwatch-logs";
import { initCloudWatchLogsInsights } from "./cloudwatch-logs-insights";

const LAST_WEEK = {
	logGroupNames: ["/readplace/analytics"],
	queryString: "filter event = \"starter_assigned\" | stats count(*) as events by arm",
	startTime: new Date("2026-10-11T00:00:00.000Z"),
	endTime: new Date("2026-10-18T00:00:00.000Z"),
};

function fakeLogsInsights(
	responses: unknown[],
	options: { maxWaitMs?: number; pollLatencyMs?: number; stopFailure?: Error } = {},
) {
	let clock = 0;
	const started: StartQueryCommand[] = [];
	const stopped: StopQueryCommand[] = [];
	const polled: GetQueryResultsCommand[] = [];
	const slept: number[] = [];
	const runQuery = initCloudWatchLogsInsights({
		startQuery: async (command) => {
			started.push(command);
			return { queryId: "query-7" };
		},
		getQueryResults: async (command) => {
			polled.push(command);
			clock += options.pollLatencyMs ?? 0;
			const next = responses.shift();
			assert(next, "the test supplied too few GetQueryResults responses");
			return next;
		},
		stopQuery: async (command) => {
			stopped.push(command);
			if (options.stopFailure) throw options.stopFailure;
			return { success: true };
		},
		sleep: async (ms) => {
			slept.push(ms);
			clock += ms;
		},
		now: () => clock,
		pollIntervalMs: 1000,
		maxWaitMs: options.maxWaitMs ?? 25_000,
	});
	return { runQuery, started, polled, stopped, slept };
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

		const rows = await logsInsights.runQuery(LAST_WEEK, { signal: new AbortController().signal });

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
		assert.deepEqual(logsInsights.stopped, []);
	});

	it("fails the request when the query ends in any status other than Complete", async () => {
		const logsInsights = fakeLogsInsights([{ status: "Running" }, { status: "Timeout" }]);

		await assert.rejects(
			logsInsights.runQuery(LAST_WEEK, { signal: new AbortController().signal }),
			/Logs Insights query query-7 ended Timeout/,
		);
		assert.deepEqual(logsInsights.stopped, []);
	});

	it("stops the query and fails the request once it has waited the deadline without completing", async () => {
		const logsInsights = fakeLogsInsights([{ status: "Scheduled" }, { status: "Running" }, { status: "Running" }], { maxWaitMs: 2000 });

		await assert.rejects(
			logsInsights.runQuery(LAST_WEEK, { signal: new AbortController().signal }),
			/Logs Insights query query-7 stopped: still Running after 2000 ms/,
		);
		assert.deepEqual(logsInsights.slept, [1000, 1000]);
		assert.deepEqual(logsInsights.stopped.map((command) => command.input), [{ queryId: "query-7" }]);
	});

	it("counts the time spent waiting on GetQueryResults towards the deadline, not just the sleeps", async () => {
		const logsInsights = fakeLogsInsights([{ status: "Running" }, { status: "Running" }], { maxWaitMs: 3000, pollLatencyMs: 1500 });

		await assert.rejects(
			logsInsights.runQuery(LAST_WEEK, { signal: new AbortController().signal }),
			/Logs Insights query query-7 stopped: still Running after 3000 ms/,
		);
		assert.deepEqual(logsInsights.slept, [1000]);
	});

	it("keeps the stop reason as the failure when StopQuery itself is rejected, carrying the rejection as its cause", async () => {
		const alreadyEnded = new Error("Query has already ended");
		const logsInsights = fakeLogsInsights([{ status: "Running" }], { maxWaitMs: 0, stopFailure: alreadyEnded });

		await assert.rejects(logsInsights.runQuery(LAST_WEEK, { signal: new AbortController().signal }), (error: Error) => {
			assert.match(error.message, /Logs Insights query query-7 stopped: still Running after 0 ms/);
			assert.equal(error.cause, alreadyEnded);
			return true;
		});
	});

	it("stops a running query instead of polling again once the request is aborted", async () => {
		const logsInsights = fakeLogsInsights([{ status: "Running" }]);
		const abort = new AbortController();
		abort.abort();

		await assert.rejects(logsInsights.runQuery(LAST_WEEK, { signal: abort.signal }), /Logs Insights query query-7 stopped: the request was aborted/);
		assert.deepEqual(logsInsights.slept, []);
		assert.deepEqual(logsInsights.stopped.map((command) => command.input), [{ queryId: "query-7" }]);
	});
});
