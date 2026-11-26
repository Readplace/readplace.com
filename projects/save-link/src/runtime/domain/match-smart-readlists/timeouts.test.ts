import { MATCH_SMART_READLISTS_MAX_RECEIVE_COUNT, MATCH_SMART_READLISTS_TIMEOUTS } from "./timeouts";

describe("MATCH_SMART_READLISTS_TIMEOUTS", () => {
	it("deepseek client aborts before the Lambda timeout", () => {
		const lambdaMs = MATCH_SMART_READLISTS_TIMEOUTS.lambdaSeconds * 1000;
		expect(MATCH_SMART_READLISTS_TIMEOUTS.deepseekMs).toBeLessThan(lambdaMs);
	});

	it("SQS visibility timeout outlasts the Lambda timeout plus the receive-to-invoke guard", () => {
		expect(MATCH_SMART_READLISTS_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			MATCH_SMART_READLISTS_TIMEOUTS.lambdaSeconds + 60,
		);
	});

	it("retries a failed match before dead-lettering it", () => {
		expect(MATCH_SMART_READLISTS_MAX_RECEIVE_COUNT).toBeGreaterThan(1);
	});
});
