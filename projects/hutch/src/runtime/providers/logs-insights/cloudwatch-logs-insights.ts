import assert from "node:assert";
import { GetQueryResultsCommand, StartQueryCommand, StopQueryCommand } from "@aws-sdk/client-cloudwatch-logs";
import type { RunLogsInsightsQuery } from "@packages/provider-contracts/logs-insights";
import { z } from "zod";

export type StartLogsInsightsQuery = (command: StartQueryCommand) => Promise<{ queryId?: string }>;
export type GetLogsInsightsQueryResults = (command: GetQueryResultsCommand) => Promise<unknown>;
export type StopLogsInsightsQuery = (command: StopQueryCommand) => Promise<unknown>;

const QueryResultsSchema = z.object({
	status: z.string(),
	results: z
		.array(z.array(z.object({ field: z.string(), value: z.string().optional() })))
		.default([]),
});

const STILL_RUNNING = new Set(["Scheduled", "Running"]);
const RECORD_POINTER_FIELD = "@ptr";
const MAX_ROWS = 1000;

function toEpochSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

export function initCloudWatchLogsInsights(deps: {
	startQuery: StartLogsInsightsQuery;
	getQueryResults: GetLogsInsightsQueryResults;
	stopQuery: StopLogsInsightsQuery;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	pollIntervalMs: number;
	maxWaitMs: number;
}): RunLogsInsightsQuery {
	return async (query, { signal }) => {
		const deadline = deps.now() + deps.maxWaitMs;
		const { queryId } = await deps.startQuery(
			new StartQueryCommand({
				logGroupNames: [...query.logGroupNames],
				queryString: query.queryString,
				startTime: toEpochSeconds(query.startTime),
				endTime: toEpochSeconds(query.endTime),
				limit: MAX_ROWS,
			}),
		);
		assert(queryId, "StartQuery must return a queryId");

		const poll = async () =>
			QueryResultsSchema.parse(await deps.getQueryResults(new GetQueryResultsCommand({ queryId })));

		const stop = async (reason: string) => {
			const stopFailure = await deps.stopQuery(new StopQueryCommand({ queryId })).then(
				() => undefined,
				(error: unknown) => error,
			);
			throw new Error(`Logs Insights query ${queryId} stopped: ${reason}`, { cause: stopFailure });
		};

		let response = await poll();
		while (STILL_RUNNING.has(response.status)) {
			if (signal.aborted) await stop("the request was aborted");
			if (deps.now() >= deadline) await stop(`still ${response.status} after ${deps.maxWaitMs} ms`);
			await deps.sleep(deps.pollIntervalMs);
			response = await poll();
		}
		assert(response.status === "Complete", `Logs Insights query ${queryId} ended ${response.status}`);

		return response.results.map((row) =>
			row.flatMap(({ field, value }) =>
				field !== RECORD_POINTER_FIELD && value !== undefined ? [{ field, value }] : [],
			),
		);
	};
}
