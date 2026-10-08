import { initArchiveHealthAws } from "./archive-health-aws";

it("correlates only this attempt's completion logs and reads the evaluation at the location it is given", async () => {
	const commands: string[][] = [];
	const aws = initArchiveHealthAws({
		region: "ap-southeast-2", contentBucket: "test-content", comparisonLogGroup: "/aws/lambda/select-most-complete-content-handler",
		runAws: async (args) => { commands.push(args); return args[0] === "logs" ? '["comparison evidence"]' : "<p>evaluated response</p>"; },
	});
	expect(await aws.readCompletionMessages({ match: "12c9f733-a806-4734-9d76-2d466e41d473", startedAt: 1791100800000 })).toEqual(["comparison evidence"]);
	expect(commands[0]).toEqual([
		"logs", "filter-log-events", "--region", "ap-southeast-2", "--log-group-name", "/aws/lambda/select-most-complete-content-handler",
		"--start-time", "1791100800000", "--filter-pattern", '"[ArchiveSaveAttempt] comparison completed" "12c9f733-a806-4734-9d76-2d466e41d473"',
		"--query", "events[].message", "--output", "json",
	]);
	expect(await aws.readEvaluation("articles/example/sources/tier-2.html.candidates/body/evaluation.html")).toBe("<p>evaluated response</p>");
	expect(commands[1]).toEqual([
		"s3", "cp", "s3://test-content/articles/example/sources/tier-2.html.candidates/body/evaluation.html", "-", "--region", "ap-southeast-2", "--no-progress", "--only-show-errors",
	]);
});
