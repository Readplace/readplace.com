import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "summary-failed.template.html"),
	"utf-8",
);

export interface SummaryFailedInput {
	reason: string;
}

export function renderSummaryFailed(input: SummaryFailedInput): string {
	return render(TEMPLATE, { reason: input.reason });
}
