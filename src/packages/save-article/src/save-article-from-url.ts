import { calculateReadTime } from "@packages/domain/article";
import type { ContentFreshnessResult, RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { MarkCrawlPending } from "@packages/provider-contracts/article-crawl";
import type { MarkSummaryPending } from "@packages/provider-contracts/article-summary";
import type { SaveArticle, UpdateArticleStatus } from "@packages/provider-contracts/article-store";
import type { PublishLinkQueued, PublishLinkSaved } from "@packages/provider-contracts/events";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { UserId } from "@packages/domain/user";
import type { SaveProvenance, SaveableUrl, SavedArticle } from "@packages/domain/article";

export interface SaveArticleFromUrlDependencies {
	saveArticle: SaveArticle;
	updateArticleStatus: UpdateArticleStatus;
	markCrawlPending: MarkCrawlPending;
	markSummaryPending: MarkSummaryPending;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	publishLinkSaved: PublishLinkSaved;
	publishLinkQueued: PublishLinkQueued;
	refreshArticleIfStale: RefreshArticleIfStale;
	/** Collapse an adopted terminal URL onto the article it aliases, so the save
	 * attaches to that article instead of minting a duplicate (and never lands on
	 * an inert alias row). */
	resolveCanonicalIdentity: (url: string) => Promise<string>;
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

export type SaveArticleFromUrl = (params: {
	userId: UserId;
	url: SaveableUrl;
	freshness: ContentFreshnessResult;
	provenance: SaveProvenance;
}) => Promise<{
	saved: SavedArticle;
	canonicalUrl: string;
	createdUserArticle: boolean;
}>;

async function saveByFreshness(
	deps: SaveArticleFromUrlDependencies,
	params: {
		userId: UserId;
		url: string;
		freshness: ContentFreshnessResult;
		provenance: SaveProvenance;
	},
): Promise<{ saved: SavedArticle; createdUserArticle: boolean }> {
	const { userId, url, freshness, provenance } = params;

	if (freshness.action === "new") {
		const hostname = new URL(url).hostname;
		const { saved, createdUserArticle } = await deps.saveArticle({
			userId,
			url,
			metadata: {
				title: `Article from ${hostname}`,
				siteName: hostname,
				excerpt: `Saved from ${hostname}.`,
				wordCount: 0,
			},
			estimatedReadTime: calculateReadTime(0),
			provenance,
		});
		await deps.markCrawlPending({ url });
		await deps.markSummaryPending({ url });
		const [unread] = await Promise.all([
			markUnreadIfRead(deps.updateArticleStatus, saved),
			deps.publishUpdateFetchTimestamp({
				url,
				contentFetchedAt: new Date().toISOString(),
			}),
			deps.publishLinkSaved({ url, userId }),
		]);
		return { saved: unread, createdUserArticle };
	}

	const { saved, createdUserArticle } = await deps.saveArticle({
		userId,
		url,
		metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
		estimatedReadTime: calculateReadTime(0),
		provenance,
	});

	if (freshness.action === "refreshed" && freshness.article.article.content) {
		await deps.markSummaryPending({ url });
		await deps.publishLinkSaved({ url, userId });
	}

	return {
		saved: await markUnreadIfRead(deps.updateArticleStatus, saved),
		createdUserArticle,
	};
}

export function initSaveArticleFromUrl(
	deps: SaveArticleFromUrlDependencies,
): SaveArticleFromUrl {
	return async (params) => {
		const url = await deps.resolveCanonicalIdentity(params.url);
		const result = await saveByFreshness(deps, {
			userId: params.userId,
			url,
			freshness: params.freshness,
			provenance: params.provenance,
		});
		// The row is committed, so the save is accepted on every freshness branch —
		// including the skip that publishes no LinkSaved. Carries the submitted URL,
		// not the canonical one a consumer never saw.
		await deps.publishLinkQueued({ url: params.url, userId: params.userId });
		return { ...result, canonicalUrl: url };
	};
}
