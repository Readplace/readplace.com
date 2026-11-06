import { sanitizeArticleHtml, type ArticleBody } from "@packages/domain/article";
import { rememberLastCall } from "./remember-last-call";
import { describeReaderTables } from "./reader-tables";
import { keepSameHostLinksInSamePage } from "./same-host-links";
import { anchorArticleSections } from "./section-anchors";
import {
	READER_SECTION_PAGE_THRESHOLD_BYTES,
	type ReaderSectionInput,
	type SectionPage,
	pageReaderSections,
	readerSectionSplitFor,
} from "./section-pages";

interface PrepareReaderContentInput {
	content: ArticleBody;
	appOrigin: string;
	url: string;
	section: ReaderSectionInput;
}

const preparedWholeHtml = rememberLastCall({
	keyOf: (input: PrepareReaderContentInput) => [input.content, input.appOrigin],
	compute: (input: PrepareReaderContentInput): string => {
		const retargeted = keepSameHostLinksInSamePage({
			html: input.content,
			appHost: new URL(input.appOrigin).host,
		});
		const anchored = anchorArticleSections(sanitizeArticleHtml(retargeted));
		return sanitizeArticleHtml(describeReaderTables(anchored));
	},
});

export const prepareReaderContent = rememberLastCall({
	keyOf: (input: PrepareReaderContentInput) => [
		input.content,
		input.appOrigin,
		input.url,
		input.section.requested,
		input.section.readerPath,
	],
	compute: (input: PrepareReaderContentInput): SectionPage =>
		pageReaderSections({
			html: preparedWholeHtml(input),
			section: input.section,
			split: readerSectionSplitFor(input.url),
			thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES,
		}),
});
