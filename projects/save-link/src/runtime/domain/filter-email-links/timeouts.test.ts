import { FILTER_EMAIL_LINKS_TIMEOUTS } from "./timeouts";

describe("FILTER_EMAIL_LINKS_TIMEOUTS", () => {
	it("deepseek client aborts before the Lambda timeout", () => {
		const lambdaMs = FILTER_EMAIL_LINKS_TIMEOUTS.lambdaSeconds * 1000;
		expect(FILTER_EMAIL_LINKS_TIMEOUTS.deepseekMs).toBeLessThan(lambdaMs);
	});

	it("SQS visibility timeout outlasts the Lambda timeout plus the receive-to-invoke guard", () => {
		expect(FILTER_EMAIL_LINKS_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			FILTER_EMAIL_LINKS_TIMEOUTS.lambdaSeconds + 60,
		);
	});
});
