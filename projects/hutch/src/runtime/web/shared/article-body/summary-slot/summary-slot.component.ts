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
	/* When true, the rendered slot carries `hx-swap-oob="outerHTML"` so HTMX
	 * splices it into a sibling poll response and replaces the live slot. The
	 * stable `id="article-body-summary-slot"` on every variant gives HTMX a
	 * target across crawl/summary state transitions. */
	oob?: boolean;
}

// When the crawl has failed there is no article to summarise; the
// reader-failed card already explains the problem so the slot stays hidden
// rather than competing with it. Inlined here (instead of routing through
// renderSummarySkipped) because the visible "skipped" card carries copy that
// would duplicate the reader-failed card. The `id` mirrors the variant
// templates so an OOB swap can still target this collapsed shape.
function renderHiddenSlot(oob: boolean): string {
	const oobAttr = oob ? ' hx-swap-oob="outerHTML"' : "";
	return `<div id="article-body-summary-slot" class="article-body__summary-slot article-body__summary-slot--hidden" data-test-reader-summary data-summary-status="skipped"${oobAttr}></div>`;
}

export function renderSummarySlot(input: SummarySlotInput): string {
	const oob = input.oob === true;
	if (input.crawl?.status === "failed") return renderHiddenSlot(oob);
	const summary = input.summary ?? { status: "pending" };
	switch (summary.status) {
		case "ready":
			return renderSummaryReady({
				summary: summary.summary,
				open: input.summaryOpen === true,
				oob,
			});
		case "pending":
			return renderSummaryPending({ pollUrl: input.summaryPollUrl, oob });
		case "failed":
			return renderSummaryFailed({ reason: summary.reason, oob });
		case "skipped":
			return renderSummarySkipped({ reason: summary.reason, oob });
	}
}
