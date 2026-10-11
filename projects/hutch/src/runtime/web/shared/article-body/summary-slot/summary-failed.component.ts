import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert } from "@packages/web-shell";

const TEMPLATE = readFileSync(
	join(__dirname, "summary-failed.template.html"),
	"utf-8",
);

export interface SummaryFailedInput {
	oob?: boolean;
}

export function renderSummaryFailed(input: SummaryFailedInput): string {
	return render(TEMPLATE, {
		oob: input.oob === true,
		alertHtml: renderAlert({
			key: "reader-summary-failed",
			content: {
				variant: "error",
				title: { text: "Summary unavailable", element: "p" },
				message: { text: "Readplace couldn't generate a summary for this article." },
			},
		}),
	});
}
