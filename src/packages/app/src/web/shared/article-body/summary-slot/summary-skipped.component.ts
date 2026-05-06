import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";
import { messageForSkip } from "./summary-skip-messages";

const TEMPLATE = readFileSync(
	join(__dirname, "summary-skipped.template.html"),
	"utf-8",
);

export interface SummarySkippedInput {
	reason: string | undefined;
}

export function renderSummarySkipped(input: SummarySkippedInput): string {
	return render(TEMPLATE, {
		message: messageForSkip(input.reason),
		reasonCode: input.reason ?? "",
	});
}
