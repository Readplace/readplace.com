import {
	type ArticleBody,
	type HighlightId,
	sanitizeArticleHtml,
} from "@packages/domain/article";
import {
	markHighlights,
	type ReaderHighlightState,
	type ReaderHighlights,
} from "./mark-highlights";
import { describeReaderTables } from "./reader-tables";
import { rememberLastCall } from "./remember-last-call";
import { keepSameHostLinksInSamePage } from "./same-host-links";
import { anchorArticleSections } from "./section-anchors";
import {
	pageReaderSections,
	type ReaderSectionInput,
	readerSectionSplitFor,
	type SectionPage,
} from "./section-pages";

interface PrepareReaderContentInput {
	content: ArticleBody;
	appOrigin: string;
	url: string;
	section: ReaderSectionInput;
	highlights?: ReaderHighlights;
}

type PreparedReaderContent = SectionPage & {
	text: string;
	states: readonly ReaderHighlightState[];
	noteEnds: ReadonlySet<HighlightId>;
};

const NO_HIGHLIGHTS: ReaderHighlights = {
	rows: [],
	canonicalContentHash: undefined,
};

function highlightsToMark(highlights: ReaderHighlights | undefined): ReaderHighlights {
	return highlights === undefined || highlights.rows.length === 0 ? NO_HIGHLIGHTS : highlights;
}

const preparedWholeHtml = rememberLastCall({
	keyOf: (input: PrepareReaderContentInput) => [
		input.content,
		input.appOrigin,
		highlightsToMark(input.highlights),
	],
	compute: (input: PrepareReaderContentInput) => {
		const retargeted = keepSameHostLinksInSamePage({
			html: input.content,
			appHost: new URL(input.appOrigin).host,
		});
		const anchored = anchorArticleSections(sanitizeArticleHtml(retargeted));
		const marked = markHighlights({
			html: describeReaderTables(anchored),
			highlights: highlightsToMark(input.highlights),
		});
		return {
			html: sanitizeArticleHtml(marked.html),
			text: marked.text,
			states: marked.states,
			noteEnds: marked.noteEnds,
		};
	},
});

export const WHOLE_DOCUMENT_SECTION: ReaderSectionInput = { requested: undefined, readerPath: "/", thresholdBytes: Number.POSITIVE_INFINITY };

export const prepareReaderContent = rememberLastCall({
	keyOf: (input: PrepareReaderContentInput) => [
		input.content,
		input.appOrigin,
		input.url,
		input.section.requested,
		input.section.readerPath,
		input.section.thresholdBytes,
		highlightsToMark(input.highlights),
	],
	compute: (input: PrepareReaderContentInput): PreparedReaderContent => {
		const whole = preparedWholeHtml(input);
		return {
			...pageReaderSections({
				html: whole.html,
				section: input.section,
				split: readerSectionSplitFor(input.url),
			}),
			text: whole.text,
			states: whole.states,
			noteEnds: whole.noteEnds,
		};
	},
});
