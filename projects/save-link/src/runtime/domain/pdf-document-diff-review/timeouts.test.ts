import { OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS } from "./timeouts";

describe("OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS", () => {
	it("DeepSeek SDK timeout fires before the Lambda timeout so the error surfaces as a DeepSeek client error", () => {
		const lambdaMs = OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS.lambdaSeconds * 1000;
		expect(OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS.deepseekMs).toBeLessThan(lambdaMs);
	});

	it("SQS visibility budget exceeds the Lambda timeout so the orchestrator's queue tolerates jitter on the request/response round-trip", () => {
		expect(OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS.sqsVisibilitySeconds).toBeGreaterThanOrEqual(
			OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS.lambdaSeconds,
		);
	});
});
