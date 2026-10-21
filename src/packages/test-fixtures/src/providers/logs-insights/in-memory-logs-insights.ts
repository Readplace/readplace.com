import type {
	LogsInsightsQuery,
	LogsInsightsRow,
	RunLogsInsightsQuery,
} from "@packages/provider-contracts/logs-insights";

export function initInMemoryLogsInsights(): {
	runLogsInsightsQuery: RunLogsInsightsQuery;
	answerQuery: (answer: { queryString: string; rows: readonly LogsInsightsRow[] }) => void;
	runQueries: LogsInsightsQuery[];
} {
	const answers = new Map<string, readonly LogsInsightsRow[]>();
	const runQueries: LogsInsightsQuery[] = [];

	const runLogsInsightsQuery: RunLogsInsightsQuery = async (query) => {
		runQueries.push(query);
		return answers.get(query.queryString) ?? [];
	};

	const answerQuery = (answer: { queryString: string; rows: readonly LogsInsightsRow[] }) => {
		answers.set(answer.queryString, answer.rows);
	};

	return { runLogsInsightsQuery, answerQuery, runQueries };
}
