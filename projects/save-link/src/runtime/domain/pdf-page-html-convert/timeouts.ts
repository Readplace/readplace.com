/* Mirrors `domain/pdf-page-llm-cleanup/timeouts.ts`: keep the DeepSeek SDK
 * timeout strictly below the Lambda timeout so a hung upstream surfaces as
 * a DeepSeek error rather than a Lambda timeout. The Lambda is sync-invoked
 * from the comprehensive-crawl orchestrator (not SQS-backed), so the
 * `sqsVisibilitySeconds` field is consumed by the orchestrator's own queue
 * visibility budget rather than a queue attached to this Lambda. */
export const OCR_HTML_CONVERT_TIMEOUTS = {
	lambdaSeconds: 300,
	sqsVisibilitySeconds: 300,
	deepseekMs: 240_000,
} as const;
