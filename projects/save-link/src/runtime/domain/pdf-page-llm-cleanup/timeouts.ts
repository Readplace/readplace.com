/* Mirrors `domain/generate-summary/timeouts.ts`: keep the DeepSeek SDK timeout
 * strictly below the Lambda timeout so a hung upstream surfaces as a DeepSeek
 * error rather than a Lambda timeout, and let SQS visibility hold the message
 * past the Lambda's wall-clock so redrive sees it cleanly.
 *
 * The Lambda is sync-invoked from the comprehensive-crawl orchestrator (not
 * SQS-backed), so `sqsVisibilitySeconds` here is consumed by the orchestrator's
 * own queue visibility budget rather than a queue attached to this Lambda. We
 * still publish the value so the orchestrator can include it when sizing the
 * comprehensive-crawl-command queue. */
export const OCR_LLM_CLEANUP_TIMEOUTS = {
	lambdaSeconds: 300,
	sqsVisibilitySeconds: 300,
	deepseekMs: 240_000,
} as const;
