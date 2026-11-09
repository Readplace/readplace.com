export const SELECT_CONTENT_TIMEOUTS = {
	lambdaSeconds: 300,
	sqsVisibilitySeconds: 300,
	deepseekMs: 240_000,
	processingSqsVisibilitySeconds: 1800,
	processingJudgeClaimSeconds: 360,
} as const;
