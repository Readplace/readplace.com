import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";
import { type StuckReason, classifyRow } from "./classify-row";

type ArticleStateFields = {
	summaryStatus: SummaryStatus | undefined;
	crawlStatus: CrawlStatus | undefined;
	aggregateTransitionName: string | undefined;
	summarySkippedReason: string | undefined;
};

type TerminalCheckResult = { terminal: true } | { terminal: false; message: string };

const REASON_MESSAGES: Record<StuckReason, string> = {
	"summary-pending": "summaryStatus is 'pending' — summary worker never produced a terminal outcome",
	"crawl-pending": "crawlStatus is 'pending' — crawl worker never produced a terminal outcome",
	"summary-pending-after-aggregate-migration":
		"summaryStatus is 'pending' after a Phase 2 aggregate transition wrote this row — the migration was supposed to flip both axes to terminal in one save; non-zero counts here falsify the Phase 2 hypothesis",
	"crawl-pending-after-aggregate-migration":
		"crawlStatus is 'pending' after a Phase 2 aggregate transition wrote this row — the migration was supposed to flip the crawl axis to terminal/ready in one save; non-zero counts here falsify the Phase 2 hypothesis",
	"summary-skipped-ai-unavailable":
		"summaryStatus is 'skipped' with reason 'ai-unavailable' — AI was down when summarisation ran; no auto-heal fires for skipped rows, recrawl via /admin/recrawl now that AI is back",
};

export function checkTerminalState(fields: ArticleStateFields): TerminalCheckResult {
	const reasons = classifyRow(fields);
	if (reasons.length === 0) return { terminal: true };
	const message = reasons.map((reason) => REASON_MESSAGES[reason]).join("; ");
	return { terminal: false, message };
}
