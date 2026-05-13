// Shared between the Deepseek client (runtime) and the Lambda (infra) so the
// client always aborts before the Lambda's own timeout kicks in — otherwise the
// Lambda timeout swallows the Deepseek error and we lose the underlying cause.
export const SELECT_CONTENT_TIMEOUTS = {
	lambdaSeconds: 300,
	sqsVisibilitySeconds: 300,
	deepseekMs: 240_000, // 60s headroom for post-selection S3/DynamoDB ops
} as const;
