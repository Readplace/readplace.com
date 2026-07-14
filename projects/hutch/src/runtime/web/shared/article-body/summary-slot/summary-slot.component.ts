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
	/* Tracking URL forwarded to the ready summary's `<details>` so the
	 * summary-toggle beacon can bind. Present only on the internal reader. */
	summaryToggleUrl?: string;
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

// The reader view is ready exactly when renderReaderSlot renders its ready
// view: content present AND the crawl `ready` (or a legacy `crawl === undefined`
// row). Content presence alone is not enough — renderReaderSlot's `pending`
// branch ignores content, and content-present-with-crawl-pending is reachable
// (e.g. an admin recrawl flips the crawl back to `pending` without dropping the
// already-published content), a state where the reader still shows its pending
// spinner. Gating on the crawl too keeps the summary deferred there instead of
// spinning a second, orphaned indicator beside the reader's.
function isReaderViewReady(
	crawl: ArticleCrawl | undefined,
	content: string | undefined,
): boolean {
	return !!content && (crawl === undefined || crawl.status === "ready");
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
				excerpt: summary.excerpt,
				open: input.summaryOpen === true,
				summaryToggleUrl: input.summaryToggleUrl,
				oob,
			});
		case "pending":
			return isReaderViewReady(input.crawl, input.content)
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
