import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { renderSummaryFailed } from "./summary-failed.component";
import { renderSummaryPending } from "./summary-pending.component";
import { renderSummaryReady } from "./summary-ready.component";
import { renderSummarySkipped } from "./summary-skipped.component";

export interface SummarySlotInput {
	crawl?: ArticleCrawl;
	summary: GeneratedSummary | undefined;
	summaryPollUrl?: string;
	summaryOpen?: boolean;
	/* The reader content. Gates the pending indicator: the summary pipeline is
	 * only triggered once the crawl publishes canonical content, so until the
	 * reader view is ready nothing is generating the summary and the indicator
	 * would sit stuck. */
	content?: string;
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

// While the reader view is still generating, the pending summary indicator
// would spin with nothing behind it (the summary pipeline can't start until the
// crawl publishes canonical content). This variant collapses the slot to an
// empty, display:none placeholder that keeps the htmx poll alive, so the moment
// the reader view is ready the next poll reveals the real "Generating summary"
// indicator. The stable `id` lets the cross-axis OOB swap still target it.
function renderDeferredSlot(pollUrl: string | undefined, oob: boolean): string {
	const oobAttr = oob ? ' hx-swap-oob="outerHTML"' : "";
	const pollAttrs = pollUrl
		? ` hx-get="${pollUrl}" hx-trigger="every 3s" hx-swap="outerHTML"`
		: "";
	return `<div id="article-body-summary-slot" class="article-body__summary-slot article-body__summary-slot--deferred" data-test-reader-summary data-summary-status="pending"${oobAttr}${pollAttrs}></div>`;
}

// Mirrors renderReaderSlot's ready condition (renderReaderReady fires when
// content is present and the crawl is a legacy row or has reached ready), so
// the summary indicator surfaces exactly when the reader view does.
function isReaderViewReady(
	crawl: ArticleCrawl | undefined,
	content: string | undefined,
): boolean {
	return !!content && (crawl === undefined || crawl.status === "ready");
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
			return isReaderViewReady(input.crawl, input.content)
				? renderSummaryPending({ pollUrl: input.summaryPollUrl, oob })
				: renderDeferredSlot(input.summaryPollUrl, oob);
		case "failed":
			return renderSummaryFailed({ reason: summary.reason, oob });
		case "skipped":
			return renderSummarySkipped({ reason: summary.reason, oob });
	}
}
