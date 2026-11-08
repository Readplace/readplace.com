import { z } from "zod";

export function initArchiveHealthAws(deps: {
	runAws: (args: string[]) => Promise<string>;
	region: string;
	contentBucket: string;
	comparisonLogGroups: readonly string[];
}) {
	const readCompletionMessages = async (input: { match: string; startedAt: number }): Promise<string[]> => {
		const messages: string[] = [];
		for (const logGroup of deps.comparisonLogGroups) {
			const output = await deps.runAws([
				"logs", "filter-log-events", "--region", deps.region,
				"--log-group-name", logGroup,
				"--start-time", String(input.startedAt),
				"--filter-pattern", `"[ArchiveSaveAttempt] comparison completed" "${input.match}"`,
				"--query", "events[].message", "--output", "json",
			]);
			messages.push(...z.array(z.string()).parse(JSON.parse(output)));
		}
		return messages;
	};

	const readEvaluation = async (location: string): Promise<string> => {
		return deps.runAws([
			"s3", "cp", `s3://${deps.contentBucket}/${location}`, "-", "--region", deps.region,
			"--no-progress", "--only-show-errors",
		]);
	};

	return { readCompletionMessages, readEvaluation };
}
