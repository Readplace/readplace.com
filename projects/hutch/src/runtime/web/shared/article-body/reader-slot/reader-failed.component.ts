import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-failed.template.html"),
	"utf-8",
);

export interface ReaderFailedInput {
	url: string;
	/** Install URL for the browser extension; omit when the user already has it installed. */
	extensionInstallUrl?: string;
}

export function renderReaderFailed(input: ReaderFailedInput): string {
	return render(TEMPLATE, {
		url: input.url,
		extensionInstallUrl: input.extensionInstallUrl,
	});
}
