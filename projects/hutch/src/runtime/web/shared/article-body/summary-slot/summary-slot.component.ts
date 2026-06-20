import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { render } from "@packages/web-shell";
import { renderSummaryFailed } from "./summary-failed.component";
import { renderSummaryPending } from "./summary-pending.component";
import { renderSummaryReady } from "./summary-ready.component";
import { renderSummarySkipped } from "./summary-skipped.component";

const COLLAPSED_TEMPLATE = readFileSync(
	join(__dirname, "summary-collapsed.template.html"),
	"utf-8",
);

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

// An empty, display:none slot that renders no card. Used both when the crawl
// has failed (the reader-failed card already carries the message, so a visible
// "skipped" card would duplicate it) and while the reader view is still
// generating (the summary pipeline has not started yet, so a pending indicator
// would spin with nothing behind it). The stable `id` keeps OOB swaps targeting
// it across state transitions; passing a pollUrl keeps the htmx poll alive so
// the deferred case promotes to the real indicator on the next poll. pollUrl is
// HTML-escaped by Handlebars, matching the visible pending slot.
function renderCollapsedSlot(input: {
	status: "skipped" | "pending";
	pollUrl?: string;
	oob: boolean;
}): string {
	return render(COLLAPSED_TEMPLATE, input);
}

// The reader view is ready exactly when canonical content is present: the
// pipeline makes content readable only once the crawl has published it (and
// legacy rows always have it), the same `if (content)` signal renderReaderSlot
// renders its ready view on. So the summary indicator surfaces precisely when
// the reader view does.
function isReaderViewReady(content: string | undefined): boolean {
	return !!content;
}

export function renderSummarySlot(input: SummarySlotInput): string {
	const oob = input.oob === true;
	if (input.crawl?.status === "failed")
		return renderCollapsedSlot({ status: "skipped", oob });
	const summary = input.summary ?? { status: "pending" };
	switch (summary.status) {
		case "ready":
			return renderSummaryReady({
				summary: summary.summary,
				open: input.summaryOpen === true,
				oob,
			});
		case "pending":
			return isReaderViewReady(input.content)
				? renderSummaryPending({ pollUrl: input.summaryPollUrl, oob })
				: renderCollapsedSlot({
						status: "pending",
						pollUrl: input.summaryPollUrl,
						oob,
					});
		case "failed":
			return renderSummaryFailed({ reason: summary.reason, oob });
		case "skipped":
			return renderSummarySkipped({ reason: summary.reason, oob });
	}
}
