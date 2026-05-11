import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-failed.template.html"),
	"utf-8",
);

export interface ReaderFailedInput {
	url: string;
	/**
	 * Distinguishes "we couldn't grab this article" (transient/operator-resolvable
	 * `failed`) from "this isn't a webpage we can save" (terminal `unsupported`,
	 * e.g. PDF/image origin). Same template, different copy on the title line.
	 */
	variant: "failed" | "unsupported";
	/** Install URL for the browser extension; omit when the user already has it installed. */
	extensionInstallUrl?: string;
}

export function renderReaderFailed(input: ReaderFailedInput): string {
	return render(TEMPLATE, {
		url: input.url,
		variant: input.variant,
		isUnsupported: input.variant === "unsupported",
		extensionInstallUrl: input.extensionInstallUrl,
	});
}
