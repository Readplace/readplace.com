import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_EXCERPT_LENGTH } from "@packages/provider-contracts/article-summary";
import { render } from "@packages/web-shell";
import { truncateAtWordBoundary } from "../../../../providers/article-summary/article-summary.helpers";

const TEMPLATE = readFileSync(
	join(__dirname, "summary-ready.template.html"),
	"utf-8",
);

export interface SummaryReadyInput {
	summary: string;
	excerpt?: string;
	open: boolean;
	/** When present, the `<details>` carries `data-summary-toggle-url` so the
	 * summary-toggle beacon binds to it. Omitted on readers that don't record
	 * toggles (public /view, admin recrawl), where the `<details>` still toggles
	 * natively with no beacon. */
	summaryToggleUrl?: string;
	oob?: boolean;
}

// Strips a trailing ellipsis so it never doubles up with the "view more …" the
// template appends after the preview.
function buildPreview(input: { summary: string; excerpt?: string }): string {
	if (input.excerpt) return input.excerpt.replace(/…\s*$/u, "").trimEnd();
	const flattened = input.summary.replace(/\s+/g, " ").trim();
	return truncateAtWordBoundary(flattened, MAX_EXCERPT_LENGTH).replace(/…\s*$/u, "").trimEnd();
}

export function renderSummaryReady(input: SummaryReadyInput): string {
	return render(TEMPLATE, {
		...input,
		preview: buildPreview(input),
		oob: input.oob === true,
	});
}
