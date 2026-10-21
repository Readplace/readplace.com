export interface ExcludedIdentities {
	excludedVisitorIds: readonly string[];
	excludedUserIds: readonly string[];
}

export interface LogsInsightsQuery {
	logGroupNames: readonly string[];
	queryString: string;
	startTime: Date;
	endTime: Date;
}

export type LogsInsightsRow = readonly { field: string; value: string }[];

export type RunLogsInsightsQuery = (query: LogsInsightsQuery) => Promise<readonly LogsInsightsRow[]>;

export type ReadExcludedIdentities = () => Promise<ExcludedIdentities>;
