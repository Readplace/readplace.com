import type { SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { computeArticleContentVersion } from "../../../shared/article-content-version";

export interface ReadlistCardEtagInput {
	article: SavedArticle;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
}

export function computeReadlistCardEtag(input: ReadlistCardEtagInput): string {
	const { article, crawl, summary } = input;
	return `W/"${article.id.value}:${article.status}:${computeArticleContentVersion({ article, crawl, summary })}"`;
}
