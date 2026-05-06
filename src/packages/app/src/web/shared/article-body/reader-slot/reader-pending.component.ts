import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-pending.template.html"),
	"utf-8",
);

export interface ReaderPendingInput {
	pollUrl?: string;
}

export function renderReaderPending(input: ReaderPendingInput): string {
	const message = input.pollUrl
		? "Fetching article"
		: "Still fetching — refresh to check again.";
	return render(TEMPLATE, { pollUrl: input.pollUrl, message });
}
