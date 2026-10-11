import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert } from "@packages/web-shell";
import { messageForSkip } from "./summary-skip-messages";

const TEMPLATE = readFileSync(
	join(__dirname, "summary-skipped.template.html"),
	"utf-8",
);

export interface SummarySkippedInput {
	reason: string | undefined;
	oob?: boolean;
}

export function renderSummarySkipped(input: SummarySkippedInput): string {
	return render(TEMPLATE, {
		reasonCode: input.reason ?? "",
		oob: input.oob === true,
		alertHtml: renderAlert({
			key: "reader-summary-skipped",
			content: {
				variant: "info",
				title: { text: messageForSkip(input.reason), element: "p" },
			},
		}),
	});
}
