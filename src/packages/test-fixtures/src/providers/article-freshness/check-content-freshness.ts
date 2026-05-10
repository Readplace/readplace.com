import type { CrawlArticle, CrawlArticleResult } from "@packages/crawl-article";
import type {
	ParseArticleResult,
	ParseHtml,
} from "../article-parser/article-parser.types";
import type {
	FindArticleCrawlStatus,
	IncrementCrawlAutoHealAttempt,
} from "../article-crawl/article-crawl.types";
import type { FindArticleFreshness } from "../article-store/article-store.types";
import type { PublishRefreshArticleContent } from "../events/publish-refresh-article-content.types";
import type { PublishUpdateFetchTimestamp } from "../events/publish-update-fetch-timestamp.types";
import { calculateReadTime } from "@packages/domain/article";

export type ContentFreshnessResult =
	| { action: "new" }
	| { action: "reprime" }
	| { action: "skip" }
	| { action: "unchanged" }
	| { action: "refreshed"; article: ParseArticleResult & { ok: true } };

export type RefreshArticleIfStale = (params: {
	url: string;
}) => Promise<ContentFreshnessResult>;

// 3 initial attempts, then 1 retry per TTL window: a structurally-unparseable
// URL (e.g. a 100MB PDF the parser will never finish) gets 3 chances to ride
// out transient failures, then the cap kicks in. Once capped, the counter is
// not reset — only one retry is allowed per expired TTL window (the counter
// keeps growing: 4, 5, …). This is intentional: structurally-broken URLs
// waste less compute with a single periodic heartbeat retry than with 3 every
// window. The counter fully resets when the row is successfully promoted
// (promoteTierToCanonical clears it) or when an admin triggers a recrawl.
const AUTO_HEAL_MAX_ATTEMPTS = 3;
const AUTO_HEAL_TTL_MS = 24 * 60 * 60 * 1000;

export function initRefreshArticleIfStale(deps: {
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	incrementCrawlAutoHealAttempt: IncrementCrawlAutoHealAttempt;
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
		if (!crawl) {
			// Legacy stub (freshness row exists but no crawl status). Always
			// reprime — the worker has never run, so the cap doesn't apply
			// (we want it to run at least once to discover whether this URL
			// is parseable).
			return { action: "reprime" };
		}
		if (crawl.status === "failed") {
			const result = await deps.incrementCrawlAutoHealAttempt({
				url: params.url,
				nowIso: deps.now().toISOString(),
				maxAttempts: AUTO_HEAL_MAX_ATTEMPTS,
				ttlMs: AUTO_HEAL_TTL_MS,
			});
			return result === "capped" ? { action: "skip" } : { action: "reprime" };
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

		if (result.status === "failed") {
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
