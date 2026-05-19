import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-pending.template.html"),
	"utf-8",
);

export interface ReaderPendingInput {
	/** The next polling URL. Required: pending-without-poll is now handled
	 * by the slot dispatcher routing to `renderReaderFailed({ variant: "slow" })`. */
	pollUrl: string;
	oob?: boolean;
}

export function renderReaderPending(input: ReaderPendingInput): string {
	return render(TEMPLATE, { pollUrl: input.pollUrl, oob: input.oob === true });
}
