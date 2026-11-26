import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { highlightActionUrl } from "../../../pages/readlist/highlight-surface";
import { READLIST_PATH } from "../../../pages/readlist/readlist.url";
import {
	type HighlightShareInput,
	type HighlightSharePayload,
	highlightSharePayload,
	renderHighlightPopovers,
} from "../highlight-popover/highlight-popover.component";
import { highlightTextFragment } from "../highlight-popover/highlight-text-fragment";
import type { HighlightFormScope } from "../highlights/highlight-note-dialog.component";
import { renderHighlightPreviews } from "../highlights/highlight-preview.component";
import {
	highlightsRailRowsFromStates,
	highlightsRailRowViews,
} from "../highlights-rail/highlights-rail.component";
import type { ReaderHighlightState, ReaderHighlights } from "./mark-highlights";
import { prepareReaderContent } from "./reader-content";
import type { ArticleBody, HighlightId } from "@packages/domain/article";
import type { ReaderSectionInput, SectionPage } from "./section-pages";

const TEMPLATE = readFileSync(
	join(__dirname, "reader-ready.template.html"),
	"utf-8",
);

const PAGER_TEMPLATE = readFileSync(join(__dirname, "reader-section-pager.template.html"), "utf-8");

export interface ScopedReaderHighlights extends ReaderHighlights {
	scope: HighlightFormScope | undefined;
	share: HighlightShareInput | undefined;
}

export interface ReaderReadyInput {
	content: ArticleBody;
	oob?: boolean;
	appOrigin: string;
	url: string;
	readerSection: ReaderSectionInput;
	highlights?: ScopedReaderHighlights;
}

type PreparedPage = ReturnType<typeof prepareReaderContent>;

interface RenderedReaderReady {
	html: string;
	states: readonly ReaderHighlightState[];
}

function highlightShares(input: {
	share: HighlightShareInput;
	scope: HighlightFormScope;
	page: PreparedPage;
}): ReadonlyMap<HighlightId, HighlightSharePayload> {
	const { page } = input;
	const beaconUrl = highlightActionUrl({
		path: `${READLIST_PATH}/${input.scope.articleId}/highlights/shared`,
		readlist: [],
		surface: input.scope.surface,
	});
	const shares = new Map<HighlightId, HighlightSharePayload>();
	for (const [highlightId, place] of page.page.places) {
		const fragment =
			page.kind === "paged" ? undefined : highlightTextFragment({ pageText: page.page.text, place });
		shares.set(
			highlightId,
			highlightSharePayload({
				share: input.share,
				passage: page.page.text.slice(place.start, place.end).trim(),
				fragment,
				beaconUrl,
			}),
		);
	}
	return shares;
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
	const share = input.highlights?.share;
	return {
		html: render(TEMPLATE, {
			content: page.html,
			pagerHtml: pagerHtmlFor(page),
			previewsHtml: renderHighlightPreviews(rows),
			panelsHtml:
				scope === undefined
					? ""
					: renderHighlightPopovers({
							views: highlightsRailRowViews({ rows, scope, openNote: undefined }),
							shares: share === undefined ? undefined : highlightShares({ share, scope, page }),
						}),
			oob: input.oob === true,
		}),
		states: page.states,
	};
}
