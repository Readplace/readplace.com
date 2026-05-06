import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../render";
import type { ProgressTick } from "@packages/domain/article";

const TEMPLATE = readFileSync(join(__dirname, "progress-bar.template.html"), "utf-8");

export interface ProgressBarInput {
	progress: ProgressTick | undefined;
}

function renderTemplate(args: {
	progress: ProgressTick | undefined;
	oob: boolean;
}): string {
	if (args.progress === undefined) {
		return render(TEMPLATE, {
			visibilityClass: "article-body__progress--hidden",
			stage: "",
			pct: 0,
			tickAt: "",
			oob: args.oob,
		});
	}
	return render(TEMPLATE, {
		visibilityClass: "article-body__progress--visible",
		stage: args.progress.stage,
		pct: args.progress.pct,
		tickAt: args.progress.tickAt,
		oob: args.oob,
	});
}

/**
 * Renders the unified progress bar. The element is always emitted so HTMX OOB
 * swaps targeting `#article-body-progress` always have something to replace,
 * and so the per-state class — not display:none on a missing element — drives
 * visibility. When `progress` is undefined the bar collapses to its hidden
 * state (post-crawl-ready+summary-complete or post-crawl-failed).
 */
export function renderProgressBar(input: ProgressBarInput): string {
	return renderTemplate({ progress: input.progress, oob: false });
}

/**
 * The same bar wrapped in an `hx-swap-oob` envelope for inclusion in slot
 * poll responses. HTMX pulls the element out of the response body, replaces
 * the live `#article-body-progress` element on the page, and discards the
 * rest before swapping the primary fragment into the slot. The OOB attribute
 * is rendered conditionally by the template so we never reparse our own
 * markup with a regex.
 */
export function renderProgressBarOob(input: ProgressBarInput): string {
	return renderTemplate({ progress: input.progress, oob: true });
}
