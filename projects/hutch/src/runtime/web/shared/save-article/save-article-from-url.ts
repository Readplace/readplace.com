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

export function saveArticleFromUrl(
	deps: SaveArticleFromUrlDependencies,
	params: { userId: UserId; url: SaveableUrl; freshness: ContentFreshnessResult },
): Promise<{ saved: SavedArticle }> {
	return saveByFreshness(deps, params);
}

/** Back-compat shim for chrome-extension v1.0.66 (and earlier) which POSTs
 * non-saveable URLs to /queue without the Prefer: return=representation
 * header. The crawler can't fetch the URL, but old extensions expect a 201
 * with an article body — so we save a hostname-only stub via the same code
 * path that runs for valid URLs. Do NOT call this from new entry points;
 * route through validateSaveableUrl + saveArticleFromUrl instead. */
export function saveUnsaveableUrlStub(
	deps: SaveArticleFromUrlDependencies,
	params: { userId: UserId; url: string; freshness: ContentFreshnessResult },
): Promise<{ saved: SavedArticle }> {
	return saveByFreshness(deps, params);
}
