import { calculateReadTime } from "@packages/domain/article";
import type { ContentFreshnessResult, RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type { MarkCrawlPending } from "@packages/test-fixtures/providers/article-crawl";
import type { MarkSummaryPending } from "@packages/test-fixtures/providers/article-summary";
import type { SaveArticle, UpdateArticleStatus } from "@packages/test-fixtures/providers/article-store";
import type { PublishLinkSaved } from "@packages/test-fixtures/providers/events";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
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

/** A save always lands the article back in the unread queue. The existing row
 * may be "read" (re-saving something already finished) or "deleted" (re-saving
 * something previously removed) — either way the user is asking to read it
 * again. saveArticle's `if_not_exists` upsert preserves the prior status, so
 * without this flip a re-saved read article would stay in Done and a re-saved
 * deleted article would stay hidden. */
async function markUnreadOnSave(
	updateArticleStatus: UpdateArticleStatus,
	saved: SavedArticle,
): Promise<SavedArticle> {
	if (saved.status !== "unread") {
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
		return { saved: await markUnreadOnSave(deps.updateArticleStatus, saved) };
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

	return { saved: await markUnreadOnSave(deps.updateArticleStatus, saved) };
}

export function saveArticleFromUrl(
	deps: SaveArticleFromUrlDependencies,
	params: { userId: UserId; url: SaveableUrl; freshness: ContentFreshnessResult },
): Promise<{ saved: SavedArticle }> {
	return saveByFreshness(deps, params);
}
