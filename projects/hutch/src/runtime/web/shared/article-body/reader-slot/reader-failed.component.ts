import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { FULL_PAGE_CAPTURE_PHRASE } from "../../client-surface-phrases";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-failed.template.html"),
	"utf-8",
);

export type ReaderFailedVariant = "failed" | "unsupported" | "slow" | "blocked";

export interface ReaderFailedInput {
	url: string;
	/**
	 * Distinguishes the four states that all surface the same "your link is
	 * saved, open it on the source" page:
	 *   - `unsupported`: terminal — PDFs, images, archives, anything reader view can't render.
	 *   - `failed`: transient — the fetch errored.
	 *   - `blocked`: an origin edge refused our servers; a browser on the user's
	 *     own connection is the only thing that can still fetch it.
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
	failed: `We couldn't pull the article text. The site may be blocking automated fetches. Save it with ${FULL_PAGE_CAPTURE_PHRASE} instead.`,
	blocked: `The site blocked our servers from fetching it. Open it in your browser and we'll capture the page from there — ${FULL_PAGE_CAPTURE_PHRASE} do this in one tap.`,
	slow: "Reader view is taking longer than usual.",
};

export function renderReaderFailed(input: ReaderFailedInput): string {
	return render(TEMPLATE, {
		url: input.url,
		variant: input.variant,
		hostname: new URL(input.url).hostname,
		explanation: EXPLANATIONS[input.variant],
		showCapture: input.variant === "blocked",
		extensionInstallUrl: input.extensionInstallUrl,
		captureSurfaces: FULL_PAGE_CAPTURE_PHRASE,
		oob: input.oob === true,
	});
}
