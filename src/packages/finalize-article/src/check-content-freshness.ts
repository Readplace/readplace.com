import { type CrawlArticle, type CrawlArticleResult, resolveDocumentUrl } from "@packages/crawl-article";
import type {
	ContentFreshnessResult,
	RefreshArticleIfStale,
} from "@packages/provider-contracts/article-freshness";
import type { FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type { FindArticleFreshness } from "@packages/provider-contracts/article-store";
import type { PublishRefreshArticleContent } from "@packages/provider-contracts/events";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import { newSaveAttemptId, type SaveAttemptId } from "@packages/domain/article";
import type { FinalizeArticle } from "./finalize-article";
import { decideTerminalAction } from "./decide-terminal-action";

export type { ContentFreshnessResult, RefreshArticleIfStale };

export function initRefreshArticleIfStale(deps: {
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	crawlArticle: CrawlArticle;
	finalizeArticle: FinalizeArticle;
	publishRefreshArticleContent: PublishRefreshArticleContent;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	/** Collapse an adopted terminal URL onto the article it aliases before any
	 * freshness/crawl decision, so intake keys on the same identity a save does. */
	resolveCanonicalIdentity: (url: string) => Promise<{ url: string; originalUrl: string }>;
	now: () => Date;
	staleTtlMs: number;
}): { refreshArticleIfStale: RefreshArticleIfStale } {
	const refreshArticleIfStale: RefreshArticleIfStale = async (params) => {
		const { url, originalUrl } = await deps.resolveCanonicalIdentity(params.url);
		const freshness = await deps.findArticleFreshness(url);

		if (!freshness) {
			return { action: "new" };
		}

		const crawl = await deps.findArticleCrawlStatus(url);
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
			url: originalUrl,
			fetchThumbnail: true,
			etag: freshness.etag,
			lastModified: freshness.lastModified,
			previousBodyHash: freshness.bodyHash,
		});

		if (result.status === "not-modified") {
			await deps.publishUpdateFetchTimestamp({
				url,
				contentFetchedAt: deps.now().toISOString(),
				bodyHash: freshness.bodyHash,
			});
			return { action: "unchanged" };
		}

		if (
			result.status === "failed" ||
			result.status === "blocked" ||
			result.status === "not-found" ||
			result.status === "unsupported"
		) {
			return { action: "skip" };
		}

		return handleFetchedContent({ url, originalUrl, result, saveAttemptId: newSaveAttemptId() });
	};

	async function handleFetchedContent(input: {
		url: string;
		originalUrl: string;
		result: CrawlArticleResult & { status: "fetched" };
		saveAttemptId: SaveAttemptId;
	}): Promise<ContentFreshnessResult> {
		const { url, originalUrl, result, saveAttemptId } = input;
		const finalized = await deps.finalizeArticle({
			url: originalUrl,
			writeContext: { url, attemptId: saveAttemptId },
			documentUrl: resolveDocumentUrl({ requestedUrl: originalUrl, finalUrl: result.finalUrl }),
			html: result.html,
			resolvedThumbnail: result.thumbnail,
			...(result.mediaType === "plain-text" ? { mediaType: result.mediaType, plainText: result.plainText } : { mediaType: result.mediaType }),
		});
		if (!finalized.ok) return { action: "skip" };
		const { estimatedReadTime, ...metadata } = finalized.article.metadata;

		await deps.publishRefreshArticleContent({
			url,
			saveAttemptId,
			html: finalized.article.html,
			evaluationHtml: result.evaluationHtml ?? result.html,
			sourceOriginalUrl: originalUrl,
			sourceUrl: result.finalUrl ?? originalUrl,
			metadata,
			estimatedReadTime,
			etag: result.etag,
			lastModified: result.lastModified,
			contentFetchedAt: deps.now().toISOString(),
			bodyHash: result.bodyHash,
		});

		return {
			action: "refreshed",
			article: { ok: true, article: {
				title: metadata.title,
				siteName: metadata.siteName,
				excerpt: metadata.excerpt,
				wordCount: metadata.wordCount,
				imageUrl: metadata.imageUrl,
				content: finalized.article.html,
			} },
		};
	}

	return { refreshArticleIfStale };
}
