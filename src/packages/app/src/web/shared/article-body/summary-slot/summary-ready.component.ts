import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "summary-ready.template.html"),
	"utf-8",
);

export interface SummaryReadyInput {
	summary: string;
	open: boolean;
}

export function renderSummaryReady(input: SummaryReadyInput): string {
	return render(TEMPLATE, input);
}
