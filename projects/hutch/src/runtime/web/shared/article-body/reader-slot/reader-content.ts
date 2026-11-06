import {
	type ArticleBody,
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
};

const NO_HIGHLIGHTS: ReaderHighlights = {
	rows: [],
	canonicalContentHash: undefined,
};

const preparedWholeHtml = rememberLastCall({
	keyOf: (input: PrepareReaderContentInput) => [
		input.content,
		input.appOrigin,
		input.highlights,
	],
	compute: (input: PrepareReaderContentInput) => {
		const retargeted = keepSameHostLinksInSamePage({
			html: input.content,
			appHost: new URL(input.appOrigin).host,
		});
		const anchored = anchorArticleSections(sanitizeArticleHtml(retargeted));
		const marked = markHighlights({
			html: describeReaderTables(anchored),
			highlights: input.highlights ?? NO_HIGHLIGHTS,
		});
		return {
			html: sanitizeArticleHtml(marked.html),
			text: marked.text,
			states: marked.states,
		};
	},
});

export const prepareReaderContent = rememberLastCall({
	keyOf: (input: PrepareReaderContentInput) => [
		input.content,
		input.appOrigin,
		input.url,
		input.section.requested,
		input.section.readerPath,
		input.section.thresholdBytes,
		input.highlights,
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
		};
	},
});
