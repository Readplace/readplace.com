import type { AllocateSavedAt } from "@packages/provider-contracts/article-store";
import type { ResolvedFreshnessResult } from "@packages/provider-contracts/article-freshness";
import type { SaveAttemptId, SaveProvenance, SaveableUrl, SavedArticle } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { SaveArticleFromUrl } from "./save-article-from-url";

export interface SaveArticleAtReadlistTopDependencies {
	allocateSavedAt: AllocateSavedAt;
	saveArticleFromUrl: SaveArticleFromUrl;
}

export type SaveArticleAtReadlistTop = (params: {
	userId: UserId;
	url: SaveableUrl;
	freshness: ResolvedFreshnessResult;
	provenance: SaveProvenance;
	saveAttemptId: SaveAttemptId;
}) => Promise<{
	saved: SavedArticle;
	canonicalUrl: string;
	createdUserArticle: boolean;
	wroteUserArticle: boolean;
	resurfacedFromRead: boolean;
}>;

export function initSaveArticleAtReadlistTop(
	deps: SaveArticleAtReadlistTopDependencies,
): SaveArticleAtReadlistTop {
	return async (params) =>
		deps.saveArticleFromUrl({
			...params,
			savedAt: await deps.allocateSavedAt({ userId: params.userId }),
		});
}
