import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import type { GeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { renderSummaryFailed } from "./summary-failed.component";
import { renderSummaryPending } from "./summary-pending.component";
import { renderSummaryReady } from "./summary-ready.component";
import { renderSummarySkipped } from "./summary-skipped.component";

export interface SummarySlotInput {
	crawl?: ArticleCrawl;
	summary: GeneratedSummary | undefined;
	summaryPollUrl?: string;
	summaryOpen?: boolean;
}

// When the crawl has failed there is no article to summarise; the
// reader-failed card already explains the problem so the slot stays hidden
// rather than competing with it. Inlined here (instead of routing through
// renderSummarySkipped) because the visible "skipped" card carries copy that
// would duplicate the reader-failed card.
const HIDDEN_SLOT_HTML =
	'<div class="article-body__summary-slot article-body__summary-slot--hidden" data-test-reader-summary data-summary-status="skipped"></div>';

export function renderSummarySlot(input: SummarySlotInput): string {
	if (input.crawl?.status === "failed") return HIDDEN_SLOT_HTML;
	const summary = input.summary ?? { status: "pending" };
	switch (summary.status) {
		case "ready":
			return renderSummaryReady({
				summary: summary.summary,
				open: input.summaryOpen === true,
			});
		case "pending":
			return renderSummaryPending({ pollUrl: input.summaryPollUrl });
		case "failed":
			return renderSummaryFailed({ reason: summary.reason });
		case "skipped":
			return renderSummarySkipped({ reason: summary.reason });
	}
}
