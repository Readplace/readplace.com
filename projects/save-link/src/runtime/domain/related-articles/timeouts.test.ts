import { RELATED_ARTICLES_TIMEOUTS } from "./timeouts";

describe("RELATED_ARTICLES_TIMEOUTS", () => {
	it("two sequential calls plus store and event I/O fit within the Lambda timeout", () => {
		const lambdaMs = RELATED_ARTICLES_TIMEOUTS.lambdaSeconds * 1000;
		expect(2 * RELATED_ARTICLES_TIMEOUTS.deepseekMs + 30_000).toBeLessThan(lambdaMs);
	});

	it("SQS visibility timeout is at least as long as the Lambda timeout", () => {
		expect(RELATED_ARTICLES_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			RELATED_ARTICLES_TIMEOUTS.lambdaSeconds,
		);
	});
});
