import { SELECT_CONTENT_TIMEOUTS } from "./timeouts";

describe("SELECT_CONTENT_TIMEOUTS", () => {
	it("deepseek client aborts before the Lambda timeout", () => {
		const lambdaMs = SELECT_CONTENT_TIMEOUTS.lambdaSeconds * 1000;
		expect(SELECT_CONTENT_TIMEOUTS.deepseekMs).toBeLessThan(lambdaMs);
	});

	it("SQS visibility timeout is at least as long as the Lambda timeout", () => {
		expect(SELECT_CONTENT_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			SELECT_CONTENT_TIMEOUTS.lambdaSeconds,
		);
	});

	it("the processing worker's judge claim outlives its Lambda and expires before the next eligible FIFO retry", () => {
		expect(SELECT_CONTENT_TIMEOUTS.lambdaSeconds).toBeLessThan(SELECT_CONTENT_TIMEOUTS.processingJudgeClaimSeconds);
		expect(SELECT_CONTENT_TIMEOUTS.processingJudgeClaimSeconds).toBeLessThan(SELECT_CONTENT_TIMEOUTS.processingSqsVisibilitySeconds);
		expect(SELECT_CONTENT_TIMEOUTS.processingJudgeClaimSeconds).toBe(360);
		expect(SELECT_CONTENT_TIMEOUTS.processingSqsVisibilitySeconds).toBe(1800);
	});
});
