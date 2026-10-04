import type { CrawlArticle, CrawlArticleResult } from "./crawl-article.types";

const ORIGIN_UNREACHABLE = {
	fetched: false,
	"not-modified": false,
	unsupported: false,
	failed: true,
	"not-found": true,
	blocked: true,
} satisfies Record<CrawlArticleResult["status"], boolean>;

export function initCaptureFallbackCrawl(deps: {
	crawlArticle: CrawlArticle;
	findContentSourceUrl: (url: string) => Promise<string | undefined>;
}): CrawlArticle {
	return async (params) => {
		const result = await deps.crawlArticle(params);
		if (!ORIGIN_UNREACHABLE[result.status]) return result;
		const captureUrl = await deps.findContentSourceUrl(params.url);
		if (captureUrl === undefined) return result;
		return deps.crawlArticle({
			url: captureUrl,
			fetchThumbnail: params.fetchThumbnail,
			onProgress: params.onProgress,
		});
	};
}
