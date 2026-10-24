import { sanitizeArticleHtml, type ArticleBody } from "@packages/domain/article";
import { describeReaderTables } from "./reader-tables";
import { keepSameHostLinksInSamePage } from "./same-host-links";
import { anchorArticleSections } from "./section-anchors";

export function prepareReaderContent(input: { content: ArticleBody; appOrigin: string }): { html: string } {
	const retargeted = keepSameHostLinksInSamePage({
		html: input.content,
		appHost: new URL(input.appOrigin).host,
	});
	const anchored = anchorArticleSections(sanitizeArticleHtml(retargeted));
	return { html: sanitizeArticleHtml(describeReaderTables(anchored)) };
}
