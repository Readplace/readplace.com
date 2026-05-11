import type { CrawlArticle, CrawlArticleResult } from "@packages/crawl-article";
import type {
	ParseArticleResult,
	ParseHtml,
} from "../article-parser/article-parser.types";
import type { FindArticleCrawlStatus } from "../article-crawl/article-crawl.types";
import type { FindArticleFreshness } from "../article-store/article-store.types";
import type { PublishRefreshArticleContent } from "../events/publish-refresh-article-content.types";
import type { PublishUpdateFetchTimestamp } from "../events/publish-update-fetch-timestamp.types";
import { calculateReadTime } from "@packages/domain/article";

export type ContentFreshnessResult =
	| { action: "new" }
	| { action: "skip" }
	| { action: "unchanged" }
	| { action: "refreshed"; article: ParseArticleResult & { ok: true } };

export type RefreshArticleIfStale = (params: {
	url: string;
}) => Promise<ContentFreshnessResult>;

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
		// failed / unsupported are terminal: the operator owns recovery via
		// /admin/recrawl and the DLQ → email signal. Reader-side reprime is
		// gone (was: code-driven auto-heal on view). A row without a crawl
		// status row at all is a legacy stub — still nothing to refresh here
		// because no contentFetchedAt is recorded; let it fall through to the
		// stale-TTL check which already short-circuits when no timestamp exists.
		if (crawl?.status === "failed" || crawl?.status === "unsupported") {
			return { action: "skip" };
		}

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
		});

		if (result.status === "not-modified") {
			await deps.publishUpdateFetchTimestamp({
				url: params.url,
				contentFetchedAt: deps.now().toISOString(),
			});
			return { action: "unchanged" };
		}

		if (result.status === "failed" || result.status === "unsupported") {
			return { action: "skip" };
		}

		return handleFetchedContent(params.url, result);
	};

	async function handleFetchedContent(
		url: string,
		result: CrawlArticleResult & { status: "fetched" },
	): Promise<ContentFreshnessResult> {
		const parsed = deps.parseHtml({ url, html: result.html, thumbnailUrl: result.thumbnailUrl });
		if (!parsed.ok) return { action: "skip" };

		await deps.publishRefreshArticleContent({
			url,
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
		});

		return { action: "refreshed", article: parsed };
	}

	return { refreshArticleIfStale };
}
