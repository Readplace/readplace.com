import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { renderHiddenProgressBar, renderProgressBar } from "../progress-bar.component";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-pending.template.html"),
	"utf-8",
);

const READER_PENDING_TITLE = "Preparing your reader view";
export const READER_PENDING_DESCRIPTION =
	"Readplace is cleaning up this article for a focused, distraction-free reading experience.";
const READER_CAPTURING_TITLE = "Copying the page from your device";
const TITLE_ID = "article-body-reader-pending-title";

export type ReaderPendingInput =
	| {
			kind: "crawl";
			/** The next polling URL. Required: pending-without-poll is now handled
			 * by the slot dispatcher routing to `renderReaderFailed({ variant: "slow" })`. */
			pollUrl: string;
			pct: number;
			descriptions: readonly string[];
			oob?: boolean;
		}
	| { kind: "capture"; pollUrl: string; oob?: boolean };

export function renderReaderPending(input: ReaderPendingInput): string {
	const panel =
		input.kind === "crawl"
			? {
					title: READER_PENDING_TITLE,
					descriptions: input.descriptions,
					progressHtml: renderProgressBar({ axis: "reader", pct: input.pct, labelledBy: TITLE_ID }),
				}
			: {
					title: READER_CAPTURING_TITLE,
					descriptions: [],
					progressHtml: renderHiddenProgressBar({ axis: "reader" }),
				};
	return render(TEMPLATE, {
		pollUrl: input.pollUrl,
		oob: input.oob === true,
		titleId: TITLE_ID,
		...panel,
	});
}
