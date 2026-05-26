/* The diff-review Lambda runs once per document and sends every page's
 * cleaned text plus all stage-1 diff entries to DeepSeek in a single call.
 * Budget accordingly: 10 minutes of model wall-clock under a 15-minute
 * Lambda ceiling, with an SQS visibility 2x that to survive the
 * orchestrator's request/response round-trip plus any local jitter. The
 * Lambda is sync-invoked (no SQS attached directly), so the visibility
 * value is consumed by the comprehensive-crawl-command queue that fronts
 * the orchestrator. */
export const OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS = {
	lambdaSeconds: 900,
	sqsVisibilitySeconds: 1800,
	deepseekMs: 600_000,
} as const;
