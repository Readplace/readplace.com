import { calculateReadTime } from "@packages/domain/article";
import type { MarkCrawlPending } from "@packages/test-fixtures/providers/article-crawl";
import type { MarkSummaryPending } from "@packages/test-fixtures/providers/article-summary";
import type { FindArticleByUrl, SaveArticle, UpdateArticleStatus } from "@packages/test-fixtures/providers/article-store";
import type { PublishLinkSaved } from "@packages/test-fixtures/providers/events";
import type { PublishStaleCheckRequested } from "@packages/test-fixtures/providers/events";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import type { UserId } from "@packages/domain/user";
import type { SaveableUrl, SavedArticle } from "@packages/domain/article";

export interface SaveArticleFromUrlDependencies {
	saveArticle: SaveArticle;
	findArticleByUrl: FindArticleByUrl;
	updateArticleStatus: UpdateArticleStatus;
	markCrawlPending: MarkCrawlPending;
	markSummaryPending: MarkSummaryPending;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	publishLinkSaved: PublishLinkSaved;
	publishStaleCheckRequested: PublishStaleCheckRequested;
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
	params: { userId: UserId; url: SaveableUrl },
): Promise<{ saved: SavedArticle }> {
	const { userId, url } = params;
	const existing = await deps.findArticleByUrl(url);

	if (!existing) {
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

	// Re-crawl of an already-cached article is delegated to the stale-check
	// Lambda so the save request never blocks on a remote fetch (mirrors /view).
	await deps.publishStaleCheckRequested({ url });

	return { saved: await markUnreadIfRead(deps.updateArticleStatus, saved) };
}
