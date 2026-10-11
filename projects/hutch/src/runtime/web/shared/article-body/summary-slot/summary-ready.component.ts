import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plainText, render, renderTldrDisclosure } from "@packages/web-shell";

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

export function renderSummaryReady(input: SummaryReadyInput): string {
	return render(TEMPLATE, {
		oob: input.oob === true,
		disclosureHtml: renderTldrDisclosure({
			body: { text: plainText(input.summary) },
			excerpt: input.excerpt,
			open: input.open,
			toggleUrl: input.summaryToggleUrl,
		}),
	});
}
