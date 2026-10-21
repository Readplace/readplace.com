import { sanitizeArticleHtml, type ArticleBody } from "@packages/domain/article";
import { keepSameHostLinksInSamePage } from "./same-host-links";
import { type ArticleSection, anchorArticleSections } from "./section-anchors";

export function prepareReaderContent(input: { content: ArticleBody; appOrigin: string }): {
	html: string;
	sections: readonly ArticleSection[];
} {
	const retargeted = keepSameHostLinksInSamePage({
		html: input.content,
		appHost: new URL(input.appOrigin).host,
	});
	const anchored = anchorArticleSections(sanitizeArticleHtml(retargeted));
	return { html: sanitizeArticleHtml(anchored.html), sections: anchored.sections };
}
