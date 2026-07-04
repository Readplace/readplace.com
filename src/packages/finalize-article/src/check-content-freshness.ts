import type { CrawlArticle, CrawlArticleResult } from "@packages/crawl-article";
import type { ParseHtml } from "@packages/article-parser";
import type {
	ContentFreshnessResult,
	RefreshArticleIfStale,
} from "@packages/provider-contracts/article-freshness";
import type { FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type { FindArticleFreshness } from "@packages/provider-contracts/article-store";
import type { PublishRefreshArticleContent } from "@packages/provider-contracts/events";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import { calculateReadTime } from "@packages/domain/article";
import { decideTerminalAction } from "./decide-terminal-action";

export type { ContentFreshnessResult, RefreshArticleIfStale };

export function initRefreshArticleIfStale(deps: {
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	crawlArticle: CrawlArticle;
	parseHtml: ParseHtml;
	publishRefreshArticleContent: PublishRefreshArticleContent;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	now: () => Date;
	staleTtlMs: number;
}): { refreshArticleIfStale: RefreshArticleIfStale } {
	const refreshArticleIfStale: RefreshArticleIfStale = async (params) => {
		const freshness = await deps.findArticleFreshness(params.url);

		if (!freshness) {
			return { action: "new" };
		}

		const crawl = await deps.findArticleCrawlStatus(params.url);
		const action = decideTerminalAction(crawl);
		if (action === "skip") return { action: "skip" };

		if (freshness.contentFetchedAt) {
			const fetchedAt = new Date(freshness.contentFetchedAt).getTime();
			const now = deps.now().getTime();
			if (now - fetchedAt < deps.staleTtlMs) {
				return { action: "skip" };
			}
		}

		const result = await deps.crawlArticle({
			url: params.url,
			etag: freshness.etag,
			lastModified: freshness.lastModified,
			previousBodyHash: freshness.bodyHash,
		});

		if (result.status === "not-modified") {
			await deps.publishUpdateFetchTimestamp({
				url: params.url,
				contentFetchedAt: deps.now().toISOString(),
				bodyHash: freshness.bodyHash,
			});
			return { action: "unchanged" };
		}

		if (
			result.status === "failed" ||
			result.status === "not-found" ||
			result.status === "unsupported"
		) {
			return { action: "skip" };
		}

		return handleFetchedContent(params.url, result);
	};

	async function handleFetchedContent(
		url: string,
		result: CrawlArticleResult & { status: "fetched" },
	): Promise<ContentFreshnessResult> {
		const parsed = deps.parseHtml({
			url,
			html: result.html,
			thumbnailUrl: result.thumbnailUrl ?? null,
		});
		if (!parsed.ok) return { action: "skip" };

		await deps.publishRefreshArticleContent({
			url,
			html: result.html,
			metadata: {
				title: parsed.article.title,
				siteName: parsed.article.siteName,
				excerpt: parsed.article.excerpt,
				wordCount: parsed.article.wordCount,
				imageUrl: parsed.article.imageUrl,
			},
			estimatedReadTime: calculateReadTime(parsed.article.wordCount),
			etag: result.etag,
			lastModified: result.lastModified,
			contentFetchedAt: deps.now().toISOString(),
			bodyHash: result.bodyHash,
		});

		return { action: "refreshed", article: parsed };
	}

	return { refreshArticleIfStale };
}
