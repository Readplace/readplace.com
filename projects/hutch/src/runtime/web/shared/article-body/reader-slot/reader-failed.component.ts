import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import { render } from "@packages/web-shell";
import { FULL_PAGE_CAPTURE_PHRASE } from "../../client-surface-phrases";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-failed.template.html"),
	"utf-8",
);

export type { ReaderFailedVariant };

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
	 *   - `not-found`: the origin answered 404/410 — nothing can fetch what is gone.
	 * Same template, the explanation line differs.
	 */
	variant: ReaderFailedVariant;
	/** Install URL for the browser extension; omit when the user already has it installed. */
	extensionInstallUrl?: string;
	capturePollUrl?: string;
	oob?: boolean;
}

const EXPLANATIONS: Record<ReaderFailedVariant, string> = {
	unsupported:
		"There are some links that are not webpages which we yet don't show in the reader.",
	failed: `We couldn't pull the article text. The site may be blocking automated fetches. Save it with ${FULL_PAGE_CAPTURE_PHRASE} instead.`,
	blocked: `The site blocked our servers from fetching it. Open it in your browser and we'll capture the page from there — ${FULL_PAGE_CAPTURE_PHRASE} do this in one tap.`,
	slow: "Reader view is taking longer than usual.",
	"origin-down": "The site itself was unreachable when we tried — its server was down, not blocking us. It may come back later.",
	"not-found": "The site says this page no longer exists at this address, so there is no article text to pull in.",
	"not-an-article": "This link isn't an article, so there's no reader view.",
};

const readItOnSource = (hostname: string) => `Read it on ${hostname}`;

const CTA_LABELS: Record<ReaderFailedVariant, (hostname: string) => string> = {
	unsupported: readItOnSource,
	failed: readItOnSource,
	blocked: readItOnSource,
	slow: readItOnSource,
	"origin-down": (hostname) => `Try it on ${hostname}`,
	"not-found": readItOnSource,
	"not-an-article": () => "View the link",
};

/* Every other variant can still be rescued by capturing the page from a client,
 * so the pitch is worth making. A page the origin has deleted cannot — pitching
 * a capture there sells a fix that does not exist. */
const CAPTURE_PITCH_VARIANTS: ReadonlySet<ReaderFailedVariant> = new Set([
	"failed",
	"unsupported",
	"slow",
	"blocked",
]);

export function renderReaderFailed(input: ReaderFailedInput): string {
	return render(TEMPLATE, {
		url: input.url,
		variant: input.variant,
		ctaLabel: CTA_LABELS[input.variant](new URL(input.url).hostname),
		explanation: EXPLANATIONS[input.variant],
		showCapture: input.variant === "blocked",
		capturePollUrl: input.capturePollUrl,
		extensionInstallUrl: CAPTURE_PITCH_VARIANTS.has(input.variant)
			? input.extensionInstallUrl
			: undefined,
		captureSurfaces: FULL_PAGE_CAPTURE_PHRASE,
		oob: input.oob === true,
	});
}
