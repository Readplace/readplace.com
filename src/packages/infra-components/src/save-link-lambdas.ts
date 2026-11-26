/**
 * Names passed to `new Lambda(...)` for the save-link project's async
 * worker Lambdas that emit structured error telemetry — the `parse-errors`
 * stream (via the observability dep bundle and the summary-generation-failed
 * handler) and `logError` ERROR lines.
 *
 * `Lambda` appends `-handler` to this name when it creates the
 * `aws.lambda.Function`, so the log group AWS auto-creates on first invocation
 * is `/aws/lambda/<name>-handler`.
 */
export const SAVE_LINK_LAMBDA_NAMES = {
	submitLink: "submit-link",
	saveLinkCommand: "save-link-command",
	saveAnonymousLinkCommand: "save-anonymous-link-command",
	saveLinkRawHtmlCommand: "save-link-raw-html-command",
	saveLinkRawPdfCommand: "save-link-raw-pdf-command",
	comprehensiveCrawlCommand: "comprehensive-crawl-command",
	renderCrawlCommand: "render-crawl-command",
	staleCheckRequested: "stale-check-requested",
	recrawlLinkInitiated: "recrawl-link-initiated",
	summaryGenerationFailed: "summary-generation-failed",
	selectMostCompleteContent: "select-most-complete-content",
	selectArticleContent: "select-article-content",
	removeMyContentCommand: "remove-my-content-command",
	reselectAfterRemoval: "reselect-after-removal",
	filterEmailLinks: "filter-email-links",
	matchSmartReadlists: "match-smart-readlists",
} as const;
