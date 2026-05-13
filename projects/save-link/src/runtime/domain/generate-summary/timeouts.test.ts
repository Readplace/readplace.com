import { GENERATE_SUMMARY_TIMEOUTS } from "./timeouts";

describe("GENERATE_SUMMARY_TIMEOUTS", () => {
	it("deepseek client aborts before the Lambda timeout", () => {
		const lambdaMs = GENERATE_SUMMARY_TIMEOUTS.lambdaSeconds * 1000;
		expect(GENERATE_SUMMARY_TIMEOUTS.deepseekMs).toBeLessThan(lambdaMs);
	});

	it("SQS visibility timeout is at least as long as the Lambda timeout", () => {
		expect(GENERATE_SUMMARY_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			GENERATE_SUMMARY_TIMEOUTS.lambdaSeconds,
		);
	});
});
