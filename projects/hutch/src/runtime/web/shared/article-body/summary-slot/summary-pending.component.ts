import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { renderHiddenProgressBar, renderProgressBar } from "../progress-bar.component";

const TEMPLATE = readFileSync(
	join(__dirname, "summary-pending.template.html"),
	"utf-8",
);

const TITLE_ID = "article-body-summary-pending-title";

export type SummaryPendingInput =
	| { kind: "polling"; pollUrl: string; pct: number; oob?: boolean }
	| { kind: "exhausted"; oob?: boolean };

export function renderSummaryPending(input: SummaryPendingInput): string {
	const panel =
		input.kind === "polling"
			? {
					pollUrl: input.pollUrl,
					descriptionClass: "article-body__panel-text--hidden",
					progressHtml: renderProgressBar({ axis: "summary", pct: input.pct, labelledBy: TITLE_ID }),
				}
			: {
					descriptionClass: "article-body__panel-text--visible",
					progressHtml: renderHiddenProgressBar({ axis: "summary" }),
				};
	return render(TEMPLATE, { oob: input.oob === true, titleId: TITLE_ID, ...panel });
}
