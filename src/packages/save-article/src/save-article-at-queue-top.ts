import type { AllocateSavedAt } from "@packages/provider-contracts/article-store";
import type { ContentFreshnessResult } from "@packages/provider-contracts/article-freshness";
import type { SaveProvenance, SaveableUrl, SavedArticle } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { SaveArticleFromUrl } from "./save-article-from-url";

export interface SaveArticleAtQueueTopDependencies {
	allocateSavedAt: AllocateSavedAt;
	saveArticleFromUrl: SaveArticleFromUrl;
}

export type SaveArticleAtQueueTop = (params: {
	userId: UserId;
	url: SaveableUrl;
	freshness: ContentFreshnessResult;
	provenance: SaveProvenance;
}) => Promise<{
	saved: SavedArticle;
	canonicalUrl: string;
	createdUserArticle: boolean;
	wroteUserArticle: boolean;
}>;

export function initSaveArticleAtQueueTop(
	deps: SaveArticleAtQueueTopDependencies,
): SaveArticleAtQueueTop {
	return async (params) =>
		deps.saveArticleFromUrl({
			...params,
			savedAt: await deps.allocateSavedAt({ userId: params.userId }),
		});
}
