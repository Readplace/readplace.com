import type {
	LogsInsightsQuery,
	LogsInsightsRow,
	RunLogsInsightsQuery,
} from "@packages/provider-contracts/logs-insights";

export function initInMemoryLogsInsights(): {
	runLogsInsightsQuery: RunLogsInsightsQuery;
	answerQuery: (answer: { queryString: string; rows: readonly LogsInsightsRow[] }) => void;
	failQuery: (failure: { queryString: string; error: Error }) => void;
	runQueries: LogsInsightsQuery[];
	signals: AbortSignal[];
} {
	const answers = new Map<string, readonly LogsInsightsRow[]>();
	const failures = new Map<string, Error>();
	const runQueries: LogsInsightsQuery[] = [];
	const signals: AbortSignal[] = [];

	const runLogsInsightsQuery: RunLogsInsightsQuery = async (query, { signal }) => {
		runQueries.push(query);
		signals.push(signal);
		const failure = failures.get(query.queryString);
		if (failure) throw failure;
		return answers.get(query.queryString) ?? [];
	};

	const answerQuery = (answer: { queryString: string; rows: readonly LogsInsightsRow[] }) => {
		answers.set(answer.queryString, answer.rows);
	};

	const failQuery = (failure: { queryString: string; error: Error }) => {
		failures.set(failure.queryString, failure.error);
	};

	return { runLogsInsightsQuery, answerQuery, failQuery, runQueries, signals };
}
