import { GENERATE_SUMMARY_TIMEOUTS } from "./timeouts";

const VISIBILITIES = [
	["legacy standard queue", GENERATE_SUMMARY_TIMEOUTS.legacySqsVisibilitySeconds],
	["FIFO queue", GENERATE_SUMMARY_TIMEOUTS.sqsVisibilitySeconds],
] as const;

describe("GENERATE_SUMMARY_TIMEOUTS", () => {
	it("deepseek client aborts before the Lambda timeout", () => {
		const lambdaMs = GENERATE_SUMMARY_TIMEOUTS.lambdaSeconds * 1000;
		expect(GENERATE_SUMMARY_TIMEOUTS.deepseekMs).toBeLessThan(lambdaMs);
	});

	it("FIFO visibility timeout is at least six times the Lambda timeout, as AWS recommends for SQS event sources", () => {
		expect(GENERATE_SUMMARY_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			6 * GENERATE_SUMMARY_TIMEOUTS.lambdaSeconds,
		);
	});

	it("the summary claim outlives a running invocation, so a live run keeps its claim", () => {
		expect(GENERATE_SUMMARY_TIMEOUTS.claimTtlSeconds).toBeGreaterThanOrEqual(GENERATE_SUMMARY_TIMEOUTS.lambdaSeconds);
	});

	it.each(VISIBILITIES)("on the %s, the visibility outlives the Lambda and the claim expires by the next retry", (_queue, visibilitySeconds) => {
		expect(visibilitySeconds).toBeGreaterThanOrEqual(GENERATE_SUMMARY_TIMEOUTS.lambdaSeconds);
		expect(GENERATE_SUMMARY_TIMEOUTS.claimTtlSeconds).toBeLessThanOrEqual(visibilitySeconds);
	});
});
