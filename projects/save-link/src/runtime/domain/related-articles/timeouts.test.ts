import { RELATED_ARTICLES_TIMEOUTS } from "./timeouts";

describe("RELATED_ARTICLES_TIMEOUTS", () => {
	it("deepseek client aborts before the Lambda timeout", () => {
		const lambdaMs = RELATED_ARTICLES_TIMEOUTS.lambdaSeconds * 1000;
		expect(RELATED_ARTICLES_TIMEOUTS.deepseekMs).toBeLessThan(lambdaMs);
	});

	it("SQS visibility timeout is at least as long as the Lambda timeout", () => {
		expect(RELATED_ARTICLES_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			RELATED_ARTICLES_TIMEOUTS.lambdaSeconds,
		);
	});
});
