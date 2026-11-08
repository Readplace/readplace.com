export const GENERATE_SUMMARY_TIMEOUTS = {
	lambdaSeconds: 300,
	legacySqsVisibilitySeconds: 300,
	sqsVisibilitySeconds: 1800,
	claimTtlSeconds: 300,
	deepseekMs: 240_000,
} as const;
