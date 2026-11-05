import { sanitizeArticleHtml, type ArticleBody } from "@packages/domain/article";
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

export function prepareReaderContent(input: {
	content: ArticleBody;
	appOrigin: string;
	url: string;
	section: ReaderSectionInput;
}): SectionPage {
	const retargeted = keepSameHostLinksInSamePage({
		html: input.content,
		appHost: new URL(input.appOrigin).host,
	});
	const anchored = anchorArticleSections(sanitizeArticleHtml(retargeted));
	return pageReaderSections({
		html: sanitizeArticleHtml(describeReaderTables(anchored)),
		section: input.section,
		split: readerSectionSplitFor(input.url),
		thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES,
	});
}
