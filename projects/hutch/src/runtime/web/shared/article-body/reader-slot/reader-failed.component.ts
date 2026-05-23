import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../../render";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-failed.template.html"),
	"utf-8",
);

export type ReaderFailedVariant = "failed" | "unsupported" | "slow";

export interface ReaderFailedInput {
	url: string;
	/**
	 * Distinguishes the three states that all surface the same "your link is
	 * saved, open it on the source" page:
	 *   - `unsupported`: terminal — PDFs, images, archives, anything reader view can't render.
	 *   - `failed`: transient — site blocked us (Cloudflare etc.) or the fetch errored.
	 *   - `slow`: pending past the poll cap — worker still might land but the user shouldn't wait.
	 * Same template, the explanation line differs.
	 */
	variant: ReaderFailedVariant;
	/** Install URL for the browser extension; omit when the user already has it installed. */
	extensionInstallUrl?: string;
	oob?: boolean;
}

const EXPLANATIONS: Record<ReaderFailedVariant, string> = {
	unsupported:
		"There are some links that are not webpages which we yet don't show in the reader.",
	failed:
		"We couldn't pull the article text. The site may be blocking automated fetches. Use the browser extension to save it.",
	slow: "Reader view is taking longer than usual.",
};

export function renderReaderFailed(input: ReaderFailedInput): string {
	return render(TEMPLATE, {
		url: input.url,
		variant: input.variant,
		hostname: new URL(input.url).hostname,
		explanation: EXPLANATIONS[input.variant],
		extensionInstallUrl: input.extensionInstallUrl,
		oob: input.oob === true,
	});
}
