import { z } from "zod";

export function initArchiveHealthAws(deps: {
	runAws: (args: string[]) => Promise<string>;
	region: string;
	contentBucket: string;
	comparisonLogGroup: string;
}) {
	const readCompletionMessages = async (input: { saveAttemptId: string; startedAt: number }): Promise<string[]> => {
		const output = await deps.runAws([
			"logs", "filter-log-events", "--region", deps.region,
			"--log-group-name", deps.comparisonLogGroup,
			"--start-time", String(input.startedAt),
			"--filter-pattern", `"[ArchiveSaveAttempt] comparison completed" "${input.saveAttemptId}"`,
			"--query", "events[].message", "--output", "json",
		]);
		return z.array(z.string()).parse(JSON.parse(output));
	};

	const readEvaluation = async (location: string): Promise<string> => {
		return deps.runAws([
			"s3", "cp", `s3://${deps.contentBucket}/${location}`, "-", "--region", deps.region,
			"--no-progress", "--only-show-errors",
		]);
	};

	return { readCompletionMessages, readEvaluation };
}
