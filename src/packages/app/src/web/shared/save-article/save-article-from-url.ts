import { calculateReadTime } from "@packages/domain/article";
import type { ContentFreshnessResult, RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type { MarkCrawlPending } from "@packages/test-fixtures/providers/article-crawl";
import type { MarkSummaryPending } from "@packages/test-fixtures/providers/article-summary";
import type { SaveArticle, UpdateArticleStatus } from "@packages/test-fixtures/providers/article-store";
import type { PublishLinkSaved } from "@packages/test-fixtures/providers/events";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import type { UserId } from "@packages/domain/user";
import type { SavedArticle } from "@packages/domain/article";

export interface SaveArticleFromUrlDependencies {
	saveArticle: SaveArticle;
	updateArticleStatus: UpdateArticleStatus;
	markCrawlPending: MarkCrawlPending;
	markSummaryPending: MarkSummaryPending;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	publishLinkSaved: PublishLinkSaved;
	refreshArticleIfStale: RefreshArticleIfStale;
}

async function markUnreadIfRead(
	updateArticleStatus: UpdateArticleStatus,
	saved: SavedArticle,
): Promise<SavedArticle> {
	if (saved.status === "read") {
		await updateArticleStatus(saved.id, saved.userId, "unread");
		return { ...saved, status: "unread", readAt: undefined };
	}
	return saved;
}

export async function saveArticleFromUrl(
	deps: SaveArticleFromUrlDependencies,
	params: { userId: UserId; url: string; freshness: ContentFreshnessResult },
): Promise<{ saved: SavedArticle }> {
	const { userId, url, freshness } = params;

	if (freshness.action === "new") {
		const hostname = new URL(url).hostname;
		const saved = await deps.saveArticle({
			userId,
			url,
			metadata: {
				title: `Article from ${hostname}`,
				siteName: hostname,
				excerpt: `Saved from ${hostname}.`,
				wordCount: 0,
			},
			estimatedReadTime: calculateReadTime(0),
		});
		await deps.markCrawlPending({ url });
		await deps.markSummaryPending({ url });
		await deps.publishUpdateFetchTimestamp({
			url,
			contentFetchedAt: new Date().toISOString(),
		});
		await deps.publishLinkSaved({ url, userId });
		return { saved: await markUnreadIfRead(deps.updateArticleStatus, saved) };
	}

	if (freshness.action === "reprime") {
		const saved = await deps.saveArticle({
			userId,
			url,
			metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0),
		});
		await deps.markCrawlPending({ url });
		await deps.markSummaryPending({ url });
		await deps.publishUpdateFetchTimestamp({
			url,
			contentFetchedAt: new Date().toISOString(),
		});
		await deps.publishLinkSaved({ url, userId });
		return { saved: await markUnreadIfRead(deps.updateArticleStatus, saved) };
	}

	const saved = await deps.saveArticle({
		userId,
		url,
		metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
		estimatedReadTime: calculateReadTime(0),
	});

	if (freshness.action === "refreshed" && freshness.article.article.content) {
		await deps.markSummaryPending({ url });
		await deps.publishLinkSaved({ url, userId });
	}

	return { saved: await markUnreadIfRead(deps.updateArticleStatus, saved) };
}
