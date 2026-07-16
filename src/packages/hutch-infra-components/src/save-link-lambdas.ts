/**
 * Names passed to `new HutchLambda(...)` for the save-link project's async
 * worker Lambdas that emit structured error telemetry — the `parse-errors`
 * stream (via the observability dep bundle and the summary-generation-failed
 * handler) and `logError` ERROR lines. The analytics dashboard's "Recent
 * errors" widget queries the derived log groups, so this is the *single* place
 * each name is written: the save-link Pulumi infra names its Lambdas from
 * `SAVE_LINK_LAMBDA_NAMES` and the hutch dashboard derives its `SOURCE` clauses
 * from `SAVE_LINK_LOG_GROUPS`, so a rename here propagates to the Lambda *and*
 * the dashboard together rather than silently drifting (these two consumers
 * live in separate Pulumi projects, so a shared workspace package — not a
 * cross-project relative import — is the only safe place to hold the names).
 *
 * `HutchLambda` appends `-handler` to this name when it creates the
 * `aws.lambda.Function`, so the log group AWS auto-creates on first invocation
 * is `/aws/lambda/<name>-handler`.
 */
export const SAVE_LINK_LAMBDA_NAMES = {
	saveLinkCommand: "save-link-command",
	saveAnonymousLinkCommand: "save-anonymous-link-command",
	saveLinkRawHtmlCommand: "save-link-raw-html-command",
	saveLinkRawPdfCommand: "save-link-raw-pdf-command",
	comprehensiveCrawlCommand: "comprehensive-crawl-command",
	staleCheckRequested: "stale-check-requested",
	recrawlLinkInitiated: "recrawl-link-initiated",
	summaryGenerationFailed: "summary-generation-failed",
	selectMostCompleteContent: "select-most-complete-content",
	removeMyContentCommand: "remove-my-content-command",
	reselectAfterRemoval: "reselect-after-removal",
} as const;

type LogGroupName<T extends string> = `/aws/lambda/${T}-handler`;

export const SAVE_LINK_LOG_GROUPS = {
	saveLinkCommand: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.saveLinkCommand}-handler`,
	saveAnonymousLinkCommand: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.saveAnonymousLinkCommand}-handler`,
	saveLinkRawHtmlCommand: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.saveLinkRawHtmlCommand}-handler`,
	saveLinkRawPdfCommand: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.saveLinkRawPdfCommand}-handler`,
	comprehensiveCrawlCommand: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.comprehensiveCrawlCommand}-handler`,
	staleCheckRequested: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.staleCheckRequested}-handler`,
	recrawlLinkInitiated: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.recrawlLinkInitiated}-handler`,
	summaryGenerationFailed: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.summaryGenerationFailed}-handler`,
	selectMostCompleteContent: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.selectMostCompleteContent}-handler`,
	removeMyContentCommand: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.removeMyContentCommand}-handler`,
	reselectAfterRemoval: `/aws/lambda/${SAVE_LINK_LAMBDA_NAMES.reselectAfterRemoval}-handler`,
} as const satisfies {
	readonly [K in keyof typeof SAVE_LINK_LAMBDA_NAMES]: LogGroupName<(typeof SAVE_LINK_LAMBDA_NAMES)[K]>;
};
