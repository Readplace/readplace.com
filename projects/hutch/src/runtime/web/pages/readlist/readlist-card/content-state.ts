import { isNonArticleHost } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";

export type ContentState = "available" | "processing" | "unavailable";

export function contentStateOf(params: {
	url: string;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
}): ContentState {
	const { url, crawl, summary } = params;
	if (isNonArticleHost(url)) return "unavailable";
	if (crawl === undefined) return summary === undefined ? "processing" : "available";
	switch (crawl.status) {
		case "ready":
			return "available";
		case "pending":
			return "processing";
		case "failed":
		case "unsupported":
			return "unavailable";
	}
}
