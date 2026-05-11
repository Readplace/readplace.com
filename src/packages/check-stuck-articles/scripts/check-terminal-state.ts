import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";
import { type StuckReason, classifyRow } from "./classify-row";

/**
 * The article-row attributes that participate in deciding whether an article
 * has reached a terminal-good state. Mirrors the projection used by the
 * canary's DDB scan (see `check-stuck-articles.ts`) so an unattested attribute
 * cannot accidentally influence the verdict.
 */
type ArticleStateFields = {
	summaryStatus: SummaryStatus | undefined;
	crawlStatus: CrawlStatus | undefined;
	summary: string | undefined;
};

type TerminalCheckResult = { terminal: true } | { terminal: false; message: string };

/**
 * Human-readable explanations for each reason code. Surface in CI logs so an
 * operator reading the workflow output understands which sub-state went off
 * the rails without having to cross-reference the classifier enum. The
 * "summary-ready-without-text" message intentionally names the writer-contract
 * violation rather than just restating the row state — the actionable detail
 * is that a writer dropped the summary text without flipping the status, not
 * that the row is currently inconsistent.
 */
const REASON_MESSAGES: Record<StuckReason, string> = {
	"summary-pending": "summaryStatus is 'pending' — summary worker never produced a terminal outcome",
	"summary-failed": "summaryStatus is 'failed' — summary worker recorded a non-recoverable failure",
	"summary-ready-without-text":
		"summaryStatus is 'ready' but the summary text is missing (writer-contract violation: a producer dropped 'summary' without resetting 'summaryStatus' to 'pending')",
	"crawl-pending": "crawlStatus is 'pending' — crawl worker never produced a terminal outcome",
	"crawl-failed": "crawlStatus is 'failed' — crawl worker recorded a non-recoverable failure",
	"legacy-stub":
		"legacy stub — row pre-dates the state machines and carries neither status attributes nor a backfilled summary",
};

/**
 * Decide whether an article row's combined crawl+summary state is terminal,
 * and if not, return a single human-readable sentence per non-terminal axis
 * suitable for logging in CI output. Both state machines are inspected — a
 * row is terminal only when BOTH are terminal AND the writer contract holds
 * (in particular, `summaryStatus='ready'` MUST be accompanied by a non-empty
 * `summary` attribute).
 *
 * Built on top of `classifyRow` so the canonical "is this row stuck?"
 * decision tree lives in one place; this function is the diagnostic
 * presentation layer.
 */
export function checkTerminalState(fields: ArticleStateFields): TerminalCheckResult {
	const reasons = classifyRow(fields);
	if (reasons.length === 0) return { terminal: true };
	const message = reasons.map((reason) => REASON_MESSAGES[reason]).join("; ");
	return { terminal: false, message };
}
