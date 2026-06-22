import { calculateReadTime } from "@packages/domain/article";
import type { ContentFreshnessResult, RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { MarkCrawlPending } from "@packages/provider-contracts/article-crawl";
import type { MarkSummaryPending } from "@packages/provider-contracts/article-summary";
import type { SaveArticle, UpdateArticleStatus } from "@packages/provider-contracts/article-store";
import type { PublishLinkSaved } from "@packages/provider-contracts/events";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { UserId } from "@packages/domain/user";
import type { SaveableUrl, SavedArticle } from "@packages/domain/article";

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

async function saveByFreshness(
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

export function initSaveArticleFromUrl(
	deps: SaveArticleFromUrlDependencies,
): (params: {
	userId: UserId;
	url: SaveableUrl;
	freshness: ContentFreshnessResult;
}) => Promise<{ saved: SavedArticle }> {
	return (params) => saveByFreshness(deps, params);
}
