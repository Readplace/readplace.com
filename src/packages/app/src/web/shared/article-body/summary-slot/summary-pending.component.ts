import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "summary-pending.template.html"),
	"utf-8",
);

export interface SummaryPendingInput {
	pollUrl?: string;
}

export function renderSummaryPending(input: SummaryPendingInput): string {
	const message = input.pollUrl
		? "Generating summary"
		: "Still generating — refresh to check again.";
	return render(TEMPLATE, { pollUrl: input.pollUrl, message });
}
