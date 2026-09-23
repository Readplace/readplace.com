import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";
import { type StuckReason, classifyRow } from "./classify-row";

type ArticleStateFields = {
	summaryStatus: SummaryStatus | undefined;
	crawlStatus: CrawlStatus | undefined;
	summarySkippedReason: string | undefined;
};

type TerminalCheckResult =
	| { terminal: true }
	| { terminal: false; message: string; reasons: StuckReason[] };

const REASON_MESSAGES: Record<StuckReason, string> = {
	"summary-pending": "summaryStatus is 'pending' — summary worker never produced a terminal outcome",
	"crawl-pending": "crawlStatus is 'pending' — crawl worker never produced a terminal outcome",
	"summary-skipped-ai-unavailable":
		"summaryStatus is 'skipped' with reason 'ai-unavailable' — AI was down when summarisation ran; no auto-heal fires for skipped rows, recrawl via /admin/recrawl now that AI is back",
};

export function checkTerminalState(fields: ArticleStateFields): TerminalCheckResult {
	const reasons = classifyRow(fields);
	if (reasons.length === 0) return { terminal: true };
	const message = reasons.map((reason) => REASON_MESSAGES[reason]).join("; ");
	return { terminal: false, message, reasons };
}
