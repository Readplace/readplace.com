import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { renderHighlightPopovers } from "../highlight-popover/highlight-popover.component";
import type { HighlightFormScope } from "../highlights/highlight-note-dialog.component";
import { renderHighlightPreviews } from "../highlights/highlight-preview.component";
import {
	highlightsRailRowsFromStates,
	highlightsRailRowViews,
} from "../highlights-rail/highlights-rail.component";
import type { ReaderHighlightState, ReaderHighlights } from "./mark-highlights";
import { prepareReaderContent } from "./reader-content";
import type { ArticleBody } from "@packages/domain/article";
import type { ReaderSectionInput, SectionPage } from "./section-pages";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-ready.template.html"),
	"utf-8",
);

const PAGER_TEMPLATE = readFileSync(join(__dirname, "reader-section-pager.template.html"), "utf-8");

export interface ScopedReaderHighlights extends ReaderHighlights {
	scope: HighlightFormScope | undefined;
}

export interface ReaderReadyInput {
	content: ArticleBody;
	oob?: boolean;
	appOrigin: string;
	url: string;
	readerSection: ReaderSectionInput;
	highlights?: ScopedReaderHighlights;
}

interface RenderedReaderReady {
	html: string;
	states: readonly ReaderHighlightState[];
}

function pagerHtmlFor(page: SectionPage): string {
	if (page.kind === "whole") return "";
	return render(PAGER_TEMPLATE, page.pager).trim();
}

export function renderReaderReady(input: ReaderReadyInput): RenderedReaderReady {
	const page = prepareReaderContent({
		content: input.content,
		appOrigin: input.appOrigin,
		url: input.url,
		section: input.readerSection,
		highlights: input.highlights,
	});
	const rows = highlightsRailRowsFromStates(page.states);
	const scope = input.highlights?.scope;
	return {
		html: render(TEMPLATE, {
			content: page.html,
			pagerHtml: pagerHtmlFor(page),
			previewsHtml: renderHighlightPreviews(rows),
			panelsHtml:
				scope === undefined
					? ""
					: renderHighlightPopovers(highlightsRailRowViews({ rows, scope, openNote: undefined })),
			oob: input.oob === true,
		}),
		states: page.states,
	};
}
