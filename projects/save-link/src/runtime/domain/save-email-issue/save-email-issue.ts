import type { ArticleMetadata, Minutes, SaveProvenance } from "@packages/domain/article";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { SetArticleDisplayUrl } from "@packages/article-store";
import type { FindArticleCrawlStatus, MarkCrawlPending } from "@packages/provider-contracts/article-crawl";
import type { MarkSummaryPending } from "@packages/provider-contracts/article-summary";
import type { AllocateSavedAt, SaveArticle } from "@packages/provider-contracts/article-store";
import type { PublishQueueEntryCreated } from "@packages/provider-contracts/events";
import type { FileArticleIntoReadlist } from "@packages/save-article";

export type SaveEmailIssue = (params: {
	userId: UserId;
	url: string;
	displayUrl: string;
	metadata: ArticleMetadata;
	estimatedReadTime: Minutes;
	provenance: SaveProvenance;
	readlists: readonly ReadlistSlug[];
}) => Promise<{ contentPending: boolean }>;

export function initSaveEmailIssue(deps: {
	allocateSavedAt: AllocateSavedAt;
	saveArticle: SaveArticle;
	setDisplayUrl: SetArticleDisplayUrl;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	markSummaryPending: MarkSummaryPending;
	fileArticleIntoReadlist: FileArticleIntoReadlist;
	publishQueueEntryCreated: PublishQueueEntryCreated;
}): SaveEmailIssue {
	return async ({ userId, url, displayUrl, metadata, estimatedReadTime, provenance, readlists }) => {
		const contentPending = (await deps.findArticleCrawlStatus(url))?.status !== "ready";
		const { saved, createdUserArticle } = await deps.saveArticle({
			userId,
			url,
			metadata,
			estimatedReadTime,
			provenance,
			savedAt: await deps.allocateSavedAt({ userId }),
		});
		await deps.setDisplayUrl({ articleUrl: url, displayUrl });
		if (contentPending) {
			await deps.markCrawlPending({ url });
			await deps.markSummaryPending({ url });
		}
		for (const readlist of readlists) {
			await deps.fileArticleIntoReadlist({ userId, readlist, article: saved, provenance });
		}
		if (createdUserArticle) await deps.publishQueueEntryCreated({ url, userId });
		return { contentPending };
	};
}
