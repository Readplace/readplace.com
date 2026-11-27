import type { CrawlStatus, SummaryStatus } from "@packages/article-state-types";

export type StuckReason = "summary-pending" | "crawl-pending";

type ArticleStateFields = {
	summaryStatus: SummaryStatus | undefined;
	crawlStatus: CrawlStatus | undefined;
};

type TerminalCheckResult =
	| { terminal: true }
	| { terminal: false; message: string; reasons: StuckReason[] };

const REASON_MESSAGES: Record<StuckReason, string> = {
	"summary-pending": "summaryStatus is 'pending' — summary worker never produced a terminal outcome",
	"crawl-pending": "crawlStatus is 'pending' — crawl worker never produced a terminal outcome",
};

export function checkTerminalState(fields: ArticleStateFields): TerminalCheckResult {
	const reasons: StuckReason[] = [];
	if (fields.summaryStatus === "pending") {
		reasons.push("summary-pending");
	}
	if (fields.crawlStatus === "pending") {
		reasons.push("crawl-pending");
	}
	if (reasons.length === 0) return { terminal: true };
	const message = reasons.map((reason) => REASON_MESSAGES[reason]).join("; ");
	return { terminal: false, message, reasons };
}
