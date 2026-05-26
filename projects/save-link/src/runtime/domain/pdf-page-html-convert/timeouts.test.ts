import { OCR_HTML_CONVERT_TIMEOUTS } from "./timeouts";

describe("OCR_HTML_CONVERT_TIMEOUTS", () => {
	it("DeepSeek SDK timeout fires before the Lambda timeout so the error surfaces as a DeepSeek client error", () => {
		const lambdaMs = OCR_HTML_CONVERT_TIMEOUTS.lambdaSeconds * 1000;
		expect(OCR_HTML_CONVERT_TIMEOUTS.deepseekMs).toBeLessThan(lambdaMs);
	});

	it("SQS visibility is at least as long as the Lambda timeout", () => {
		expect(OCR_HTML_CONVERT_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			OCR_HTML_CONVERT_TIMEOUTS.lambdaSeconds,
		);
	});
});
