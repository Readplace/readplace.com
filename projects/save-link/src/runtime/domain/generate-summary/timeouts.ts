// Shared between the Deepseek client (runtime) and the Lambda (infra) so the
// client always aborts before the Lambda's own timeout kicks in — otherwise the
// Lambda timeout swallows the Deepseek error and we lose the underlying cause.
export const GENERATE_SUMMARY_TIMEOUTS = {
	lambdaSeconds: 300,
	sqsVisibilitySeconds: 300,
	deepseekMs: 240_000,
} as const;
