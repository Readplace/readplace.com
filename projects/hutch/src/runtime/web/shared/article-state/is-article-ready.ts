import type { ArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";

export function isArticleReady(input: {
	crawl: ArticleCrawl | undefined;
	content: string | undefined;
}): boolean {
	if (input.content === undefined) return false;
	if (input.crawl === undefined) return true;
	return input.crawl.status === "ready";
}
